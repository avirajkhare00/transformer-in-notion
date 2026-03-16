import {
  createTicTacToeBoard,
  formatMoveLabel,
  getTicTacToeOutcome,
} from "./logic/tictactoe.mjs";
import {
  analyzeTicTacToeWithModel,
  warmTicTacToeModel,
} from "./logic/tictactoe-model.mjs";
import {
  DEFAULT_PUZZLE,
  buildGivenMask,
  cloneSudokuBoard,
  formatSudokuCell,
  parseSudoku,
  solveSudokuWithTrace,
} from "./logic/sudoku.mjs";
import {
  buildSudokuExecutorArtifacts,
  buildTicTacToeExecutorArtifacts,
} from "./logic/executor.mjs";

const MAX_LOG_ITEMS = 7;

const tttState = {
  board: createTicTacToeBoard(),
  analysis: null,
  log: [],
  locked: false,
  modelReady: false,
  modelError: "",
  timeoutId: 0,
  requestId: 0,
};

const sudokuState = {
  initialBoard: parseSudoku(DEFAULT_PUZZLE),
  givenMask: [],
  board: [],
  result: null,
  log: [],
  emphasis: null,
  stepIndex: 0,
  timerId: 0,
  isAnimating: false,
};

const refs = {
  tttBoard: document.querySelector("#ttt-board"),
  tttStatus: document.querySelector("#ttt-status"),
  tttAnalysis: document.querySelector("#ttt-analysis"),
  tttLog: document.querySelector("#ttt-log"),
  tttPrompt: document.querySelector("#ttt-prompt"),
  tttProgram: document.querySelector("#ttt-program"),
  tttTrace: document.querySelector("#ttt-trace"),
  tttReset: document.querySelector("#ttt-reset"),
  tttAiFirst: document.querySelector("#ttt-ai-first"),
  sudokuBoard: document.querySelector("#sudoku-board"),
  sudokuStatus: document.querySelector("#sudoku-status"),
  sudokuStats: document.querySelector("#sudoku-stats"),
  sudokuLog: document.querySelector("#sudoku-log"),
  sudokuPrompt: document.querySelector("#sudoku-prompt"),
  sudokuProgram: document.querySelector("#sudoku-program"),
  sudokuTrace: document.querySelector("#sudoku-trace"),
  sudokuReset: document.querySelector("#sudoku-reset"),
  sudokuAnimate: document.querySelector("#sudoku-animate"),
  sudokuSolve: document.querySelector("#sudoku-solve"),
  tttCells: [],
  sudokuCells: [],
};

function init() {
  buildTicTacToeBoard();
  buildSudokuBoard();
  bindEvents();
  resetTicTacToe();
  resetSudoku();
  primeTicTacToeModel();
}

function bindEvents() {
  refs.tttReset.addEventListener("click", () => resetTicTacToe());
  refs.tttAiFirst.addEventListener("click", () => {
    resetTicTacToe();
    queueSolverMove(true);
  });
  refs.sudokuReset.addEventListener("click", () => resetSudoku());
  refs.sudokuAnimate.addEventListener("click", () => animateSudoku());
  refs.sudokuSolve.addEventListener("click", () => solveSudokuInstantly());
}

function buildTicTacToeBoard() {
  for (let index = 0; index < 9; index += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ttt-cell";
    button.dataset.index = String(index);
    button.setAttribute("aria-label", `Tic-tac-toe cell ${formatMoveLabel(index)}`);
    button.addEventListener("click", onTicTacToeCellClick);
    refs.tttBoard.append(button);
    refs.tttCells.push(button);
  }
}

function buildSudokuBoard() {
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const cell = document.createElement("div");
      const dividerClasses = [
        "sudoku-cell",
        col === 2 || col === 5 ? "block-right" : "",
        row === 2 || row === 5 ? "block-bottom" : "",
      ]
        .filter(Boolean)
        .join(" ");
      cell.className = dividerClasses;
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      refs.sudokuBoard.append(cell);
      refs.sudokuCells.push(cell);
    }
  }
}

function onTicTacToeCellClick(event) {
  const index = Number(event.currentTarget.dataset.index);
  const outcome = getTicTacToeOutcome(tttState.board);
  if (tttState.locked || outcome.isDone || tttState.board[index]) {
    return;
  }

  tttState.board[index] = "X";
  tttState.analysis = null;
  pushTicTacToeLog(`You placed X on ${formatMoveLabel(index)}.`);
  renderTicTacToe();

  const nextOutcome = getTicTacToeOutcome(tttState.board);
  if (!nextOutcome.isDone) {
    queueSolverMove(false);
  }
}

function resetTicTacToe() {
  window.clearTimeout(tttState.timeoutId);
  tttState.requestId += 1;
  tttState.board = createTicTacToeBoard();
  tttState.analysis = null;
  tttState.locked = false;
  tttState.log = [];
  pushTicTacToeLog(
    tttState.modelReady
      ? "Fresh board loaded. You play X against local weights."
      : "Fresh board loaded. Loading local transformer weights."
  );
  renderTicTacToe();
}

async function queueSolverMove(isOpening) {
  const outcome = getTicTacToeOutcome(tttState.board);
  if (outcome.isDone) {
    return;
  }

  tttState.locked = true;
  tttState.analysis = null;
  renderTicTacToe();

  const requestId = ++tttState.requestId;

  try {
    if (!tttState.modelReady) {
      await primeTicTacToeModel();
    }
  } catch (error) {
    if (requestId !== tttState.requestId) {
      return;
    }
    tttState.locked = false;
    tttState.modelError = error instanceof Error ? error.message : "Model load failed.";
    pushTicTacToeLog("Local transformer failed to load.");
    renderTicTacToe();
    return;
  }

  const analysis = await analyzeTicTacToeWithModel(tttState.board);
  if (requestId !== tttState.requestId) {
    return;
  }

  tttState.analysis = analysis;
  renderTicTacToe();

  const { bestMove, options } = tttState.analysis;
  if (bestMove == null) {
    tttState.locked = false;
    renderTicTacToe();
    return;
  }

  const summary = options[0] ? `${(options[0].score * 100).toFixed(1)}%` : "0.0%";
  pushTicTacToeLog(
    `Transformer liked ${formatMoveLabel(bestMove)} at ${summary} confidence.`
  );
  renderTicTacToe();

  tttState.timeoutId = window.setTimeout(() => {
    if (requestId !== tttState.requestId) {
      return;
    }
    tttState.board[bestMove] = "O";
    tttState.locked = false;
    pushTicTacToeLog(
      `${isOpening ? "Transformer opens" : "Transformer replies"} with O on ${formatMoveLabel(bestMove)}.`
    );
    renderTicTacToe();
  }, 420);
}

function pushTicTacToeLog(message) {
  tttState.log.push(message);
  if (tttState.log.length > MAX_LOG_ITEMS) {
    tttState.log.shift();
  }
}

function renderTicTacToe() {
  const outcome = getTicTacToeOutcome(tttState.board);

  refs.tttCells.forEach((cell, index) => {
    const value = tttState.board[index];
    cell.textContent = value;
    cell.classList.toggle("is-x", value === "X");
    cell.classList.toggle("is-o", value === "O");
    cell.classList.toggle("is-win", outcome.line.includes(index));
    cell.disabled = tttState.locked || Boolean(value) || outcome.isDone;
  });

  refs.tttStatus.textContent = getTicTacToeStatus(outcome);
  renderTicTacToeAnalysis();
  renderTicTacToeArtifacts();
  renderList(refs.tttLog, tttState.log);
}

function getTicTacToeStatus(outcome) {
  if (tttState.modelError) {
    return "Local transformer failed to load.";
  }
  if (outcome.winner === "X") {
    return "You found the winning line.";
  }
  if (outcome.winner === "O") {
    return "Local transformer found a winning line.";
  }
  if (outcome.isDraw) {
    return "The board ended in a draw.";
  }
  if (tttState.locked) {
    return tttState.modelReady
      ? "Local transformer is evaluating the board."
      : "Loading local transformer weights.";
  }
  if (!tttState.modelReady) {
    return "Loading local transformer weights.";
  }
  return "Your turn. Aim for a fork.";
}

function renderTicTacToeAnalysis() {
  refs.tttAnalysis.innerHTML = "";

  if (!tttState.analysis || !tttState.analysis.options.length) {
    const placeholder = document.createElement("p");
    placeholder.className = "empty-state";
    placeholder.textContent = "The solver fills this panel after it starts thinking.";
    refs.tttAnalysis.append(placeholder);
    return;
  }

  tttState.analysis.options.forEach((option, index) => {
    const row = document.createElement("div");
    row.className = "analysis-row";
    if (index === 0) {
      row.classList.add("is-best");
    }

    const move = document.createElement("span");
    move.className = "analysis-move";
    move.textContent = formatMoveLabel(option.move);

    const badge = document.createElement("span");
    badge.className = `analysis-badge ${labelClass(option.score)}`;
    badge.textContent = option.label;

    const score = document.createElement("span");
    score.textContent = `${(option.score * 100).toFixed(1)}%`;

    row.append(move, badge, score);
    refs.tttAnalysis.append(row);
  });
}

function labelClass(score) {
  if (score >= 0.75) {
    return "badge-win";
  }
  if (score <= 0.35) {
    return "badge-loss";
  }
  return "badge-draw";
}

function renderTicTacToeArtifacts() {
  const artifacts = buildTicTacToeExecutorArtifacts(
    tttState.board,
    tttState.analysis,
    tttState.locked
  );
  refs.tttPrompt.textContent = artifacts.prompt;
  refs.tttProgram.textContent = artifacts.program;
  refs.tttTrace.textContent = artifacts.trace;
}

function resetSudoku() {
  stopSudokuAnimation();
  sudokuState.givenMask = buildGivenMask(sudokuState.initialBoard);
  sudokuState.board = cloneSudokuBoard(sudokuState.initialBoard);
  sudokuState.result = solveSudokuWithTrace(sudokuState.initialBoard);
  sudokuState.log = [];
  sudokuState.emphasis = null;
  sudokuState.stepIndex = 0;
  pushSudokuLog("Demo puzzle loaded. Animate the search or jump to the final grid.");
  renderSudoku();
}

function animateSudoku() {
  stopSudokuAnimation();
  sudokuState.board = cloneSudokuBoard(sudokuState.initialBoard);
  sudokuState.log = [];
  sudokuState.emphasis = null;
  sudokuState.stepIndex = 0;
  sudokuState.isAnimating = true;
  pushSudokuLog("Tracing the solver from the first open cell.");
  renderSudoku();

  sudokuState.timerId = window.setInterval(() => {
    const event = sudokuState.result.trace[sudokuState.stepIndex];
    if (!event) {
      stopSudokuAnimation(true);
      return;
    }

    applySudokuTraceEvent(event);
    sudokuState.stepIndex += 1;
    renderSudoku();

    if (sudokuState.stepIndex >= sudokuState.result.trace.length) {
      stopSudokuAnimation(true);
    }
  }, 38);
}

function stopSudokuAnimation(markSolved = false) {
  window.clearInterval(sudokuState.timerId);
  sudokuState.timerId = 0;
  sudokuState.isAnimating = false;

  if (markSolved) {
    sudokuState.board = cloneSudokuBoard(sudokuState.result.solution);
    sudokuState.emphasis = null;
    pushSudokuLog(
      `Solved after ${sudokuState.result.stats.placements} placements and ${sudokuState.result.stats.backtracks} backtracks.`
    );
    renderSudoku();
  }
}

function solveSudokuInstantly() {
  stopSudokuAnimation();
  sudokuState.board = cloneSudokuBoard(sudokuState.result.solution);
  sudokuState.emphasis = null;
  sudokuState.stepIndex = sudokuState.result.trace.length;
  sudokuState.log = [];
  pushSudokuLog("Solved instantly.");
  pushSudokuLog(
    `Placements: ${sudokuState.result.stats.placements}. Backtracks: ${sudokuState.result.stats.backtracks}.`
  );
  renderSudoku();
}

function pushSudokuLog(message) {
  sudokuState.log.push(message);
  if (sudokuState.log.length > MAX_LOG_ITEMS) {
    sudokuState.log.shift();
  }
}

function applySudokuTraceEvent(event) {
  if (event.type === "focus") {
    sudokuState.emphasis = { row: event.row, col: event.col, type: "focus" };
    pushSudokuLog(
      `Focus ${formatSudokuCell(event.row, event.col)} -> [${event.candidates.join(", ")}]`
    );
    return;
  }

  if (event.type === "place") {
    sudokuState.board[event.row][event.col] = event.value;
    sudokuState.emphasis = { row: event.row, col: event.col, type: "place" };
    pushSudokuLog(`Place ${event.value} at ${formatSudokuCell(event.row, event.col)}.`);
    return;
  }

  if (event.type === "backtrack") {
    sudokuState.board[event.row][event.col] = 0;
    sudokuState.emphasis = { row: event.row, col: event.col, type: "backtrack" };
    pushSudokuLog(
      `Backtrack ${formatSudokuCell(event.row, event.col)} and remove ${event.value}.`
    );
  }
}

function renderSudoku() {
  refs.sudokuCells.forEach((cell) => {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const value = sudokuState.board[row][col];
    const emphasis =
      sudokuState.emphasis &&
      sudokuState.emphasis.row === row &&
      sudokuState.emphasis.col === col
        ? sudokuState.emphasis.type
        : "";

    cell.textContent = value ? String(value) : "";
    cell.classList.toggle("is-given", sudokuState.givenMask[row][col]);
    cell.classList.toggle("is-live", Boolean(value) && !sudokuState.givenMask[row][col]);
    cell.classList.toggle("is-focus", emphasis === "focus");
    cell.classList.toggle("is-place", emphasis === "place");
    cell.classList.toggle("is-backtrack", emphasis === "backtrack");
  });

  refs.sudokuStatus.textContent = getSudokuStatus();
  refs.sudokuAnimate.disabled = sudokuState.isAnimating;
  refs.sudokuSolve.disabled = sudokuState.isAnimating;
  renderSudokuStats();
  renderSudokuArtifacts();
  renderList(refs.sudokuLog, sudokuState.log);
}

function getSudokuStatus() {
  if (sudokuState.isAnimating) {
    return `Solver trace ${sudokuState.stepIndex + 1} / ${sudokuState.result.trace.length}`;
  }

  if (sudokuState.stepIndex >= sudokuState.result.trace.length) {
    return "Puzzle solved. The whole trace stays browser-side.";
  }

  return "Ready to animate a full solve.";
}

function renderSudokuStats() {
  const items = [
    {
      label: "Placements",
      value: sudokuState.result.stats.placements,
    },
    {
      label: "Backtracks",
      value: sudokuState.result.stats.backtracks,
    },
    {
      label: "Trace events",
      value: sudokuState.result.trace.length,
    },
    {
      label: "Progress",
      value: `${Math.min(sudokuState.stepIndex, sudokuState.result.trace.length)} / ${sudokuState.result.trace.length}`,
    },
  ];

  refs.sudokuStats.innerHTML = "";
  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `
      <span class="stat-label">${item.label}</span>
      <span class="stat-value">${item.value}</span>
    `;
    refs.sudokuStats.append(card);
  });
}

function renderSudokuArtifacts() {
  const artifacts = buildSudokuExecutorArtifacts(
    sudokuState.initialBoard,
    sudokuState.result,
    sudokuState.stepIndex
  );
  refs.sudokuPrompt.textContent = artifacts.prompt;
  refs.sudokuProgram.textContent = artifacts.program;
  refs.sudokuTrace.textContent = artifacts.trace;
}

function renderList(node, items) {
  node.innerHTML = "";
  [...items].reverse().forEach((item) => {
    const entry = document.createElement("li");
    entry.textContent = item;
    node.append(entry);
  });
}

async function primeTicTacToeModel() {
  if (tttState.modelReady) {
    return;
  }

  try {
    await warmTicTacToeModel();
    tttState.modelReady = true;
    tttState.modelError = "";
    if (!tttState.log.length) {
      pushTicTacToeLog("Local transformer ready.");
    }
    renderTicTacToe();
  } catch (error) {
    tttState.modelReady = false;
    tttState.modelError = error instanceof Error ? error.message : "Model load failed.";
    renderTicTacToe();
    throw error;
  }
}

init();

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
} from "./logic/sudoku.mjs";
import { solveSudokuWithWasm, warmSudokuExecutor } from "./logic/sudoku-wasm.mjs";
import {
  buildSudokuExecutorArtifacts,
  buildTicTacToeExecutorArtifacts,
} from "./logic/executor.mjs";

const MAX_TTT_LOG_ITEMS = 24;
const MAX_SUDOKU_LOG_ITEMS = 180;
const SUDOKU_PRESETS = [
  {
    id: "browser-demo",
    label: "Browser demo",
    puzzle: DEFAULT_PUZZLE,
  },
  {
    id: "classic-easy",
    label: "Classic easy",
    puzzle:
      "530070000600195000098000060800060003400803001700020006060000280000419005000080079",
  },
  {
    id: "sparse-hard",
    label: "Sparse hard",
    puzzle:
      "800000000003600000070090200050007000000045700000100030001000068008500010090000400",
  },
];

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
  puzzle: DEFAULT_PUZZLE,
  initialBoard: parseSudoku(DEFAULT_PUZZLE),
  givenMask: [],
  board: [],
  result: null,
  log: [],
  loadMessage: "",
  emphasis: null,
  stepIndex: 0,
  timerId: 0,
  isAnimating: false,
  isLoading: false,
  executorReady: false,
  executorError: "",
  requestId: 0,
};

const refs = {
  tttBoard: document.querySelector("#ttt-board"),
  tttStatus: document.querySelector("#ttt-status"),
  tttAnalysis: document.querySelector("#ttt-analysis"),
  tttLog: document.querySelector("#ttt-log"),
  tttPrompt: document.querySelector("#ttt-prompt"),
  tttTool: document.querySelector("#ttt-tool"),
  tttProgram: document.querySelector("#ttt-program"),
  tttTrace: document.querySelector("#ttt-trace"),
  tttReset: document.querySelector("#ttt-reset"),
  tttAiFirst: document.querySelector("#ttt-ai-first"),
  sudokuBoard: document.querySelector("#sudoku-board"),
  sudokuStatus: document.querySelector("#sudoku-status"),
  sudokuStats: document.querySelector("#sudoku-stats"),
  sudokuLog: document.querySelector("#sudoku-log"),
  sudokuPrompt: document.querySelector("#sudoku-prompt"),
  sudokuTool: document.querySelector("#sudoku-tool"),
  sudokuProgram: document.querySelector("#sudoku-program"),
  sudokuTrace: document.querySelector("#sudoku-trace"),
  sudokuReset: document.querySelector("#sudoku-reset"),
  sudokuAnimate: document.querySelector("#sudoku-animate"),
  sudokuSolve: document.querySelector("#sudoku-solve"),
  sudokuPreset: document.querySelector("#sudoku-preset"),
  sudokuInput: document.querySelector("#sudoku-input"),
  sudokuLoad: document.querySelector("#sudoku-load"),
  tttCells: [],
  sudokuCells: [],
};

function init() {
  if (hasTicTacToeUI()) {
    initTicTacToe();
  }

  if (hasSudokuUI()) {
    initSudoku();
  }
}

function hasTicTacToeUI() {
  return Boolean(
    refs.tttBoard &&
      refs.tttStatus &&
      refs.tttAnalysis &&
      refs.tttLog &&
      refs.tttPrompt &&
      refs.tttTool &&
      refs.tttProgram &&
      refs.tttTrace &&
      refs.tttReset &&
      refs.tttAiFirst
  );
}

function hasSudokuUI() {
  return Boolean(
    refs.sudokuBoard &&
      refs.sudokuStatus &&
      refs.sudokuStats &&
      refs.sudokuLog &&
      refs.sudokuPrompt &&
      refs.sudokuTool &&
      refs.sudokuProgram &&
      refs.sudokuTrace &&
      refs.sudokuReset &&
      refs.sudokuAnimate &&
      refs.sudokuSolve &&
      refs.sudokuPreset &&
      refs.sudokuInput &&
      refs.sudokuLoad
  );
}

function initTicTacToe() {
  buildTicTacToeBoard();
  bindTicTacToeEvents();
  resetTicTacToe();
  primeTicTacToeModel();
}

function initSudoku() {
  buildSudokuBoard();
  buildSudokuPresetMenu();
  syncSudokuInput(DEFAULT_PUZZLE);
  selectSudokuPresetForPuzzle(DEFAULT_PUZZLE);
  bindSudokuEvents();
  resetSudoku();
}

function bindTicTacToeEvents() {
  refs.tttReset.addEventListener("click", () => resetTicTacToe());
  refs.tttAiFirst.addEventListener("click", () => {
    resetTicTacToe();
    queueSolverMove(true);
  });
}

function bindSudokuEvents() {
  refs.sudokuReset.addEventListener("click", () => resetSudoku());
  refs.sudokuAnimate.addEventListener("click", () => animateSudoku());
  refs.sudokuSolve.addEventListener("click", () => solveSudokuInstantly());
  refs.sudokuPreset.addEventListener("change", onSudokuPresetChange);
  refs.sudokuLoad.addEventListener("click", onSudokuLoadClick);
  refs.sudokuInput.addEventListener("input", () => {
    refs.sudokuPreset.value = "custom";
  });
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

function buildSudokuPresetMenu() {
  refs.sudokuPreset.innerHTML = "";

  const customOption = document.createElement("option");
  customOption.value = "custom";
  customOption.textContent = "Bring your own";
  refs.sudokuPreset.append(customOption);

  SUDOKU_PRESETS.forEach((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    refs.sudokuPreset.append(option);
  });
}

function normalizeSudokuPuzzleText(text) {
  return text.replace(/[^0-9.]/g, "").replace(/\./g, "0");
}

function formatSudokuPuzzleText(puzzle) {
  const normalized = normalizeSudokuPuzzleText(puzzle).replace(/0/g, ".");
  const rows = [];
  for (let row = 0; row < 9; row += 1) {
    rows.push(normalized.slice(row * 9, row * 9 + 9));
  }
  return rows.join("\n");
}

function syncSudokuInput(puzzle) {
  refs.sudokuInput.value = formatSudokuPuzzleText(puzzle);
}

function selectSudokuPresetForPuzzle(puzzle) {
  const normalized = normalizeSudokuPuzzleText(puzzle);
  const match = SUDOKU_PRESETS.find((preset) => preset.puzzle === normalized);
  refs.sudokuPreset.value = match ? match.id : "custom";
}

function findSudokuPreset(id) {
  return SUDOKU_PRESETS.find((preset) => preset.id === id) ?? null;
}

function applySudokuPuzzle(rawPuzzle, loadMessage) {
  try {
    const normalized = normalizeSudokuPuzzleText(rawPuzzle);
    const board = parseSudoku(normalized);
    sudokuState.puzzle = normalized;
    sudokuState.initialBoard = board;
    sudokuState.loadMessage = loadMessage;
    syncSudokuInput(normalized);
    selectSudokuPresetForPuzzle(normalized);
    resetSudoku();
  } catch (error) {
    sudokuState.executorError = "";
    pushSudokuLog(
      error instanceof Error ? error.message : "Sudoku input must contain exactly 81 cells."
    );
    renderSudoku();
  }
}

function onSudokuPresetChange() {
  if (refs.sudokuPreset.value === "custom") {
    return;
  }
  const preset = findSudokuPreset(refs.sudokuPreset.value);
  if (!preset) {
    return;
  }
  applySudokuPuzzle(preset.puzzle, `Loaded preset: ${preset.label}.`);
}

function onSudokuLoadClick() {
  const preset = findSudokuPreset(refs.sudokuPreset.value);
  applySudokuPuzzle(
    refs.sudokuInput.value,
    preset ? `Loaded preset: ${preset.label}.` : "Loaded custom puzzle."
  );
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
  if (tttState.log.length > MAX_TTT_LOG_ITEMS) {
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
    return tttState.modelError;
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
    placeholder.textContent =
      "The local transformer fills this panel after it starts thinking.";
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
  renderToolCall(refs.tttTool, artifacts.tool);
  refs.tttProgram.textContent = artifacts.program;
  refs.tttTrace.textContent = artifacts.trace;
}

async function resetSudoku() {
  const requestId = ++sudokuState.requestId;
  stopSudokuAnimation();
  sudokuState.givenMask = buildGivenMask(sudokuState.initialBoard);
  sudokuState.board = cloneSudokuBoard(sudokuState.initialBoard);
  sudokuState.result = null;
  sudokuState.log = [];
  const loadMessage = sudokuState.loadMessage;
  sudokuState.loadMessage = "";
  sudokuState.emphasis = null;
  sudokuState.stepIndex = 0;
  sudokuState.isLoading = true;
  sudokuState.executorError = "";
  pushSudokuLog(
    sudokuState.executorReady
      ? "Puzzle loaded. Running the browser-side WASM executor."
      : "Puzzle loaded. Loading the browser-side WASM executor."
  );
  if (loadMessage) {
    pushSudokuLog(loadMessage);
  }
  renderSudoku();

  try {
    if (!sudokuState.executorReady) {
      await warmSudokuExecutor();
      if (requestId !== sudokuState.requestId) {
        return;
      }
      sudokuState.executorReady = true;
    }

    const result = await solveSudokuWithWasm(sudokuState.puzzle);
    if (requestId !== sudokuState.requestId) {
      return;
    }

    sudokuState.result = result;
    sudokuState.isLoading = false;
    pushSudokuLog(
      `WASM executor traced ${result.trace.length} events before reaching the solved grid.`
    );
    renderSudoku();
  } catch (error) {
    if (requestId !== sudokuState.requestId) {
      return;
    }
    sudokuState.isLoading = false;
    sudokuState.executorReady = false;
    sudokuState.executorError = error instanceof Error ? error.message : "WASM executor failed.";
    pushSudokuLog(sudokuState.executorError);
    renderSudoku();
  }
}

function animateSudoku() {
  if (!sudokuState.result || sudokuState.isLoading) {
    return;
  }
  stopSudokuAnimation();
  sudokuState.board = cloneSudokuBoard(sudokuState.initialBoard);
  sudokuState.log = [];
  sudokuState.emphasis = null;
  sudokuState.stepIndex = 0;
  sudokuState.isAnimating = true;
  pushSudokuLog("Tracing the WASM executor from the first open cell.");
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

  if (markSolved && sudokuState.result) {
    sudokuState.board = cloneSudokuBoard(sudokuState.result.solution);
    sudokuState.emphasis = null;
    pushSudokuLog(
      `Solved after ${sudokuState.result.stats.placements} placements and ${sudokuState.result.stats.backtracks} backtracks in WASM.`
    );
    renderSudoku();
  }
}

function solveSudokuInstantly() {
  if (!sudokuState.result || sudokuState.isLoading) {
    return;
  }
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
  if (sudokuState.log.length > MAX_SUDOKU_LOG_ITEMS) {
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
  refs.sudokuAnimate.disabled =
    sudokuState.isAnimating || sudokuState.isLoading || !sudokuState.result;
  refs.sudokuSolve.disabled =
    sudokuState.isAnimating || sudokuState.isLoading || !sudokuState.result;
  renderSudokuStats();
  renderSudokuArtifacts();
  renderList(refs.sudokuLog, sudokuState.log);
}

function getSudokuStatus() {
  if (sudokuState.executorError) {
    return sudokuState.executorError;
  }
  if (sudokuState.isLoading) {
    return sudokuState.executorReady
      ? "Browser-side WASM executor is solving the puzzle."
      : "Loading browser-side WASM executor.";
  }
  if (sudokuState.isAnimating) {
    return `WASM trace ${sudokuState.stepIndex + 1} / ${sudokuState.result.trace.length}`;
  }

  if (sudokuState.result && sudokuState.stepIndex >= sudokuState.result.trace.length) {
    return "Puzzle solved. The whole WASM trace stays browser-side.";
  }

  return "Ready to animate a full WASM solve.";
}

function renderSudokuStats() {
  if (!sudokuState.result) {
    refs.sudokuStats.innerHTML = "";
    const placeholder = document.createElement("p");
    placeholder.className = "empty-state";
    placeholder.textContent = sudokuState.isLoading
      ? "The WASM executor is preparing the full search trace."
      : "Sudoku stats appear after the WASM executor loads.";
    refs.sudokuStats.append(placeholder);
    return;
  }

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
  renderToolCall(refs.sudokuTool, artifacts.tool);
  refs.sudokuProgram.textContent = artifacts.program;
  refs.sudokuTrace.textContent = artifacts.trace;
}

function renderToolCall(node, tool) {
  node.innerHTML = "";

  const head = document.createElement("div");
  head.className = "tool-call-head";

  const name = document.createElement("span");
  name.className = "tool-call-name";
  name.textContent = tool.name;

  const badge = document.createElement("span");
  badge.className = "tool-call-badge";
  badge.textContent = tool.badge;

  head.append(name, badge);

  const grid = document.createElement("div");
  grid.className = "tool-call-grid";

  const rows = [
    ["Runtime", tool.runtime],
    ["Artifact", tool.artifact],
    ["Call", tool.call],
  ];

  rows.forEach(([label, value]) => {
    const row = document.createElement("div");
    row.className = "tool-call-row";

    const key = document.createElement("span");
    key.className = "tool-call-key";
    key.textContent = label;

    const text = document.createElement("span");
    text.className = "tool-call-value";
    text.textContent = value;

    row.append(key, text);
    grid.append(row);
  });

  node.append(head, grid);
}

function renderList(node, items) {
  node.innerHTML = "";
  items.forEach((item) => {
    const entry = document.createElement("li");
    entry.textContent = item;
    node.append(entry);
  });
  node.scrollTop = node.scrollHeight;
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

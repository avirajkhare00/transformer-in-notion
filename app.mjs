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
import { HARD_SUDOKU_PRESETS } from "./logic/sudoku-hard.mjs";
import {
  benchmarkSudokuDeterministic,
  solveSudokuWithWasm,
  warmSudokuExecutor,
} from "./logic/sudoku-wasm.mjs";
import {
  buildSudokuExecutorArtifacts,
  buildTicTacToeExecutorArtifacts,
} from "./logic/executor.mjs";

const MAX_TTT_LOG_ITEMS = 24;
const MAX_SUDOKU_LOG_ITEMS = 180;
const LEGACY_SUDOKU_PRESET_ALIASES = Object.freeze({
  "sparse-hard": "inkala-2012",
});
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
  ...HARD_SUDOKU_PRESETS,
];
const SUDOKU_REPLAY_MODES = Object.freeze({
  normal: {
    chunkSize: 1,
    intervalMs: 38,
    intro: "Tracing the WASM executor from the first open cell.",
    statusVerb: "Replaying",
  },
  fast: {
    chunkSize: 64,
    intervalMs: 4,
    intro: "Fast replaying the WASM executor trace.",
    statusVerb: "Fast replaying",
  },
});

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
  solveClockId: 0,
  solveStartedAt: 0,
  solveElapsedMs: 0,
  isAnimating: false,
  isLoading: false,
  executorReady: false,
  executorError: "",
  baselineTiming: null,
  baselinePending: false,
  baselineError: "",
  replayMode: "normal",
  requestId: 0,
};
const sudokuModelState = {
  worker: null,
  isRunning: false,
  error: "",
  status: "Guided model is idle.",
  phase: "idle",
  tokenCount: 0,
  predictionCount: 0,
  branchCount: 0,
  averageConfidence: null,
  accuracy: null,
  valuePredictionCount: 0,
  valueAverageConfidence: null,
  valueAccuracy: null,
  tokensPerSecond: 0,
  elapsedMs: 0,
  traceLength: 0,
  referenceTraceLength: 0,
  guidedStats: null,
  referenceStats: null,
  runId: 0,
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
  sudokuFast: document.querySelector("#sudoku-fast"),
  sudokuSolve: document.querySelector("#sudoku-solve"),
  sudokuPreset: document.querySelector("#sudoku-preset"),
  sudokuInput: document.querySelector("#sudoku-input"),
  sudokuLoad: document.querySelector("#sudoku-load"),
  sudokuModelRun: document.querySelector("#sudoku-model-run"),
  sudokuModelStatus: document.querySelector("#sudoku-model-status"),
  sudokuModelStats: document.querySelector("#sudoku-model-stats"),
  sudokuFlow: document.querySelector("#sudoku-flow"),
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
      refs.sudokuFast &&
      refs.sudokuSolve &&
      refs.sudokuPreset &&
      refs.sudokuInput &&
      refs.sudokuLoad &&
      refs.sudokuModelRun &&
      refs.sudokuModelStatus &&
      refs.sudokuModelStats &&
      refs.sudokuFlow
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
  const initialPreset = getSudokuPresetFromLocation();
  const initialPuzzle = initialPreset ? initialPreset.puzzle : DEFAULT_PUZZLE;
  sudokuState.puzzle = initialPuzzle;
  sudokuState.initialBoard = parseSudoku(initialPuzzle);
  sudokuState.loadMessage = initialPreset
    ? `Loaded preset: ${initialPreset.label}.`
    : "";
  syncSudokuInput(initialPuzzle);
  selectSudokuPresetForPuzzle(initialPuzzle);
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
  refs.sudokuFast.addEventListener("click", () => animateSudoku("fast"));
  refs.sudokuSolve.addEventListener("click", () => solveSudokuInstantly());
  refs.sudokuModelRun.addEventListener("click", () => runSudokuModelTrace());
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

function findSudokuPresetByPuzzle(puzzle) {
  const normalized = normalizeSudokuPuzzleText(puzzle);
  return SUDOKU_PRESETS.find((preset) => preset.puzzle === normalized) ?? null;
}

function describeSudokuPreset(puzzle) {
  const preset = findSudokuPresetByPuzzle(puzzle);
  if (!preset) {
    return {
      cardLabel: "Preset",
      value: "Custom puzzle",
      prefix: "Custom puzzle",
    };
  }

  const isHard = HARD_SUDOKU_PRESETS.some((candidate) => candidate.id === preset.id);
  return {
    cardLabel: isHard ? "Hard preset" : "Preset",
    value: preset.label,
    prefix: isHard ? `Hard preset: ${preset.label}` : `Preset: ${preset.label}`,
  };
}

function formatSudokuDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "—";
  }
  if (ms < 1000) {
    return `${ms.toFixed(ms < 100 ? 1 : 0)} ms`;
  }
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatSudokuPercent(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatSudokuTokenRate(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "—";
  }
  return `${Math.round(value)} tok/s`;
}

function formatSudokuBacktrackComparison(guidedBacktracks, referenceBacktracks) {
  if (
    !Number.isFinite(guidedBacktracks) ||
    !Number.isFinite(referenceBacktracks)
  ) {
    return "—";
  }

  if (guidedBacktracks === referenceBacktracks) {
    return "same";
  }

  const delta = referenceBacktracks - guidedBacktracks;
  if (delta > 0) {
    return `${delta} fewer`;
  }
  return `${Math.abs(delta)} more`;
}

function countSudokuClues(board) {
  return board.flat().filter(Boolean).length;
}

function formatSudokuSpeedComparison(wasmMs, baselineMs) {
  if (
    !Number.isFinite(wasmMs) ||
    wasmMs <= 0 ||
    !Number.isFinite(baselineMs) ||
    baselineMs <= 0
  ) {
    return "pending";
  }

  const ratio = baselineMs / wasmMs;
  if (ratio >= 1) {
    return `${ratio.toFixed(ratio >= 10 ? 0 : 1)}x faster`;
  }

  const slower = wasmMs / baselineMs;
  return `${slower.toFixed(slower >= 10 ? 0 : 1)}x slower`;
}

function formatSudokuReplayValue() {
  if (!sudokuState.result) {
    return "—";
  }

  const total = sudokuState.result.trace.length;
  const current = Math.min(sudokuState.stepIndex, total);

  if (sudokuState.isAnimating) {
    return `${current} / ${total}`;
  }

  if (current === 0) {
    return `ready · 0 / ${total}`;
  }

  if (current >= total) {
    return `complete · ${total} / ${total}`;
  }

  return `${current} / ${total}`;
}

function getCurrentSudokuSolveMs() {
  if (sudokuState.isLoading && sudokuState.solveStartedAt) {
    return performance.now() - sudokuState.solveStartedAt;
  }
  return sudokuState.solveElapsedMs;
}

function startSudokuSolveClock() {
  stopSudokuSolveClock();
  sudokuState.solveStartedAt = performance.now();
  sudokuState.solveElapsedMs = 0;
  sudokuState.solveClockId = window.setInterval(() => {
    renderSudoku();
  }, 80);
}

function stopSudokuSolveClock(finalElapsedMs = null) {
  window.clearInterval(sudokuState.solveClockId);
  sudokuState.solveClockId = 0;

  if (Number.isFinite(finalElapsedMs)) {
    sudokuState.solveElapsedMs = finalElapsedMs;
  } else if (sudokuState.solveStartedAt) {
    sudokuState.solveElapsedMs = performance.now() - sudokuState.solveStartedAt;
  }

  sudokuState.solveStartedAt = 0;
}

function terminateSudokuModelWorker() {
  if (sudokuModelState.worker) {
    sudokuModelState.worker.terminate();
    sudokuModelState.worker = null;
  }
}

function resetSudokuModelState(status = "Guided model is idle.") {
  terminateSudokuModelWorker();
  sudokuModelState.isRunning = false;
  sudokuModelState.error = "";
  sudokuModelState.status = status;
  sudokuModelState.phase = "idle";
  sudokuModelState.tokenCount = 0;
  sudokuModelState.predictionCount = 0;
  sudokuModelState.branchCount = 0;
  sudokuModelState.averageConfidence = null;
  sudokuModelState.accuracy = null;
  sudokuModelState.valuePredictionCount = 0;
  sudokuModelState.valueAverageConfidence = null;
  sudokuModelState.valueAccuracy = null;
  sudokuModelState.tokensPerSecond = 0;
  sudokuModelState.elapsedMs = 0;
  sudokuModelState.traceLength = 0;
  sudokuModelState.referenceTraceLength = 0;
  sudokuModelState.guidedStats = null;
  sudokuModelState.referenceStats = null;
}

function syncSudokuInput(puzzle) {
  refs.sudokuInput.value = formatSudokuPuzzleText(puzzle);
}

function selectSudokuPresetForPuzzle(puzzle) {
  const match = findSudokuPresetByPuzzle(puzzle);
  refs.sudokuPreset.value = match ? match.id : "custom";
}

function findSudokuPreset(id) {
  const canonicalId = LEGACY_SUDOKU_PRESET_ALIASES[id] ?? id;
  return SUDOKU_PRESETS.find((preset) => preset.id === canonicalId) ?? null;
}

function getSudokuPresetFromLocation() {
  const url = new URL(window.location.href);
  const presetId = url.searchParams.get("preset");
  if (!presetId) {
    return null;
  }
  return findSudokuPreset(presetId);
}

function syncSudokuPresetInLocation(puzzle) {
  const url = new URL(window.location.href);
  const normalized = normalizeSudokuPuzzleText(puzzle);
  const match = SUDOKU_PRESETS.find((preset) => preset.puzzle === normalized);

  if (match) {
    url.searchParams.set("preset", match.id);
  } else {
    url.searchParams.delete("preset");
  }

  window.history.replaceState({}, "", url);
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
    syncSudokuPresetInLocation(normalized);
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
  stopSudokuSolveClock();
  resetSudokuModelState("Guided model is idle.");
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
  sudokuState.solveElapsedMs = 0;
  sudokuState.baselineTiming = null;
  sudokuState.baselinePending = false;
  sudokuState.baselineError = "";
  sudokuState.replayMode = "normal";
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

    startSudokuSolveClock();
    const result = await solveSudokuWithWasm(sudokuState.puzzle);
    if (requestId !== sudokuState.requestId) {
      return;
    }

    stopSudokuSolveClock(result.elapsedMs);
    sudokuState.result = result;
    sudokuState.isLoading = false;
    pushSudokuLog(
      `WASM executor traced ${result.trace.length} events in ${formatSudokuDuration(result.elapsedMs)} before reaching the solved grid.`
    );
    renderSudoku();
    void queueSudokuDeterministicBaseline(requestId);
  } catch (error) {
    if (requestId !== sudokuState.requestId) {
      return;
    }
    stopSudokuSolveClock();
    sudokuState.isLoading = false;
    sudokuState.executorReady = false;
    sudokuState.executorError = error instanceof Error ? error.message : "WASM executor failed.";
    pushSudokuLog(sudokuState.executorError);
    renderSudoku();
  }
}

async function queueSudokuDeterministicBaseline(requestId) {
  sudokuState.baselinePending = true;
  sudokuState.baselineError = "";
  renderSudoku();

  try {
    const result = await benchmarkSudokuDeterministic(sudokuState.puzzle, "mrv");
    if (requestId !== sudokuState.requestId) {
      return;
    }

    sudokuState.baselineTiming = result;
    sudokuState.baselinePending = false;
    pushSudokuLog(
      `Best deterministic baseline (MRV JS) finished in ${formatSudokuDuration(result.elapsedMs)}.`
    );
    renderSudoku();
  } catch (error) {
    if (requestId !== sudokuState.requestId) {
      return;
    }

    sudokuState.baselinePending = false;
    sudokuState.baselineError =
      error instanceof Error ? error.message : "Deterministic benchmark failed.";
    pushSudokuLog(sudokuState.baselineError);
    renderSudoku();
  }
}

function updateSudokuModelMetrics(payload) {
  if (Number.isFinite(payload.tokenCount)) {
    sudokuModelState.tokenCount = payload.tokenCount;
  }
  if (Number.isFinite(payload.predictionCount)) {
    sudokuModelState.predictionCount = payload.predictionCount;
  }
  if (Number.isFinite(payload.branchCount)) {
    sudokuModelState.branchCount = payload.branchCount;
  }
  if (Number.isFinite(payload.averageConfidence)) {
    sudokuModelState.averageConfidence = payload.averageConfidence;
  }
  if (Number.isFinite(payload.accuracy)) {
    sudokuModelState.accuracy = payload.accuracy;
  }
  if (Number.isFinite(payload.valuePredictionCount)) {
    sudokuModelState.valuePredictionCount = payload.valuePredictionCount;
  }
  if (Number.isFinite(payload.valueAverageConfidence)) {
    sudokuModelState.valueAverageConfidence = payload.valueAverageConfidence;
  }
  if (Number.isFinite(payload.valueAccuracy)) {
    sudokuModelState.valueAccuracy = payload.valueAccuracy;
  }
  if (Number.isFinite(payload.tokensPerSecond)) {
    sudokuModelState.tokensPerSecond = payload.tokensPerSecond;
  }
  if (Number.isFinite(payload.elapsedMs)) {
    sudokuModelState.elapsedMs = payload.elapsedMs;
  }
  if (Number.isFinite(payload.traceLength)) {
    sudokuModelState.traceLength = payload.traceLength;
  }
  if (Number.isFinite(payload.referenceTraceLength)) {
    sudokuModelState.referenceTraceLength = payload.referenceTraceLength;
  }
  if (payload.guidedStats) {
    sudokuModelState.guidedStats = payload.guidedStats;
  }
  if (payload.referenceStats) {
    sudokuModelState.referenceStats = payload.referenceStats;
  }
}

function handleSudokuModelMessage(runId, message) {
  const { data } = message;
  if (runId !== sudokuModelState.runId || !data) {
    return;
  }

  if (data.type === "start") {
    sudokuModelState.status = `Reference solve ready. Guided branch ranking will compare against ${data.traceLength} exact events.`;
    sudokuModelState.referenceTraceLength =
      data.referenceTraceLength ?? sudokuModelState.referenceTraceLength;
    sudokuModelState.referenceStats = data.referenceStats ?? sudokuModelState.referenceStats;
    if (Array.isArray(data.initialBoard)) {
      sudokuState.board = cloneSudokuBoard(data.initialBoard);
      sudokuState.emphasis = null;
      sudokuState.log = [];
      pushSudokuLog("Guided solve started. Streaming model-ranked branch decisions.");
    }
    renderSudoku();
    return;
  }

  if (data.type === "progress") {
    sudokuModelState.phase = data.phase ?? sudokuModelState.phase;
    sudokuModelState.status = data.message ?? "Running local guided solve.";
    renderSudoku();
    return;
  }

  if (data.type === "event-batch") {
    updateSudokuModelMetrics(data);
    if (Array.isArray(data.events)) {
      data.events.forEach((event) => applySudokuTraceEvent(event));
    }
    sudokuModelState.status =
      data.branchCount
        ? `Ranked ${data.branchCount} guided branch decisions.`
        : sudokuModelState.status;
    renderSudoku();
    return;
  }

  if (data.type === "done") {
    updateSudokuModelMetrics(data);
    sudokuModelState.isRunning = false;
    sudokuModelState.phase = "done";
    sudokuModelState.status = `Guided solve finished after ${sudokuModelState.branchCount} ranked branch decisions at ${formatSudokuTokenRate(sudokuModelState.tokensPerSecond)}.`;
    if (Array.isArray(data.solution)) {
      sudokuState.board = cloneSudokuBoard(data.solution);
      sudokuState.emphasis = null;
      if (sudokuState.result) {
        sudokuState.stepIndex = sudokuState.result.trace.length;
      }
      pushSudokuLog(
        `Guided solve committed the final board with ${data.guidedStats?.backtracks ?? "—"} backtracks.`
      );
    }
    terminateSudokuModelWorker();
    renderSudoku();
    return;
  }

  if (data.type === "error") {
    sudokuModelState.isRunning = false;
    sudokuModelState.error = data.message ?? "Guided model solve failed.";
    sudokuModelState.status = sudokuModelState.error;
    sudokuModelState.phase = "error";
    terminateSudokuModelWorker();
    renderSudoku();
  }
}

function runSudokuModelTrace() {
  if (sudokuState.isLoading || !sudokuState.result || sudokuModelState.isRunning) {
    return;
  }

  resetSudokuModelState("Warming local guided model.");
  sudokuModelState.isRunning = true;
  sudokuModelState.phase = "warm-models";
  sudokuModelState.runId += 1;
  const runId = sudokuModelState.runId;
  const worker = new Worker(new URL("./soduku/model-worker.mjs", import.meta.url), {
    type: "module",
  });
  sudokuModelState.worker = worker;

  worker.onmessage = (message) => {
    handleSudokuModelMessage(runId, message);
  };
  worker.onerror = (error) => {
    if (runId !== sudokuModelState.runId) {
      return;
    }
    sudokuModelState.isRunning = false;
    sudokuModelState.error = error.message || "Model worker failed.";
    sudokuModelState.status = sudokuModelState.error;
    sudokuModelState.phase = "error";
    terminateSudokuModelWorker();
    renderSudoku();
  };
  worker.postMessage({
    type: "run",
    puzzle: sudokuState.puzzle,
  });
  renderSudoku();
}

function animateSudoku(mode = "normal") {
  if (!sudokuState.result || sudokuState.isLoading) {
    return;
  }

  const replayMode = SUDOKU_REPLAY_MODES[mode] ?? SUDOKU_REPLAY_MODES.normal;
  stopSudokuAnimation();
  sudokuState.board = cloneSudokuBoard(sudokuState.initialBoard);
  sudokuState.log = [];
  sudokuState.emphasis = null;
  sudokuState.stepIndex = 0;
  sudokuState.isAnimating = true;
  sudokuState.replayMode = mode in SUDOKU_REPLAY_MODES ? mode : "normal";
  pushSudokuLog(replayMode.intro);
  renderSudoku();

  sudokuState.timerId = window.setInterval(() => {
    let processed = 0;

    while (
      processed < replayMode.chunkSize &&
      sudokuState.stepIndex < sudokuState.result.trace.length
    ) {
      const event = sudokuState.result.trace[sudokuState.stepIndex];
      if (!event) {
        stopSudokuAnimation(true);
        return;
      }

      applySudokuTraceEvent(event);
      sudokuState.stepIndex += 1;
      processed += 1;
    }

    renderSudoku();

    if (sudokuState.stepIndex >= sudokuState.result.trace.length) {
      stopSudokuAnimation(true);
    }
  }, replayMode.intervalMs);
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

  sudokuState.replayMode = "normal";
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
  refs.sudokuFast.disabled =
    sudokuState.isAnimating || sudokuState.isLoading || !sudokuState.result;
  refs.sudokuSolve.disabled =
    sudokuState.isAnimating || sudokuState.isLoading || !sudokuState.result;
  refs.sudokuModelRun.disabled =
    sudokuState.isLoading || !sudokuState.result || sudokuModelState.isRunning;
  refs.sudokuModelRun.textContent = sudokuModelState.isRunning
    ? "Running guided solve…"
    : "Run guided model";
  renderSudokuStats();
  renderSudokuModelStats();
  renderSudokuFlow();
  renderSudokuArtifacts();
  renderList(refs.sudokuLog, sudokuState.log);
}

function getSudokuStatus() {
  const preset = describeSudokuPreset(sudokuState.puzzle).prefix;
  const replayMode = SUDOKU_REPLAY_MODES[sudokuState.replayMode] ?? SUDOKU_REPLAY_MODES.normal;
  if (sudokuState.executorError) {
    return sudokuState.executorError;
  }
  if (sudokuState.isLoading) {
    return sudokuState.executorReady
      ? `${preset}. Browser-side WASM executor is solving the puzzle.`
      : `${preset}. Loading browser-side WASM executor.`;
  }
  if (sudokuState.isAnimating) {
    return `${replayMode.statusVerb} WASM trace ${Math.min(sudokuState.stepIndex, sudokuState.result.trace.length)} / ${sudokuState.result.trace.length}.`;
  }

  if (sudokuState.result && sudokuState.stepIndex >= sudokuState.result.trace.length) {
    return `${preset}. Puzzle solved. The whole WASM trace stays browser-side.`;
  }

  return `${preset}. Ready to animate a full WASM solve.`;
}

function renderSudokuStats() {
  const preset = describeSudokuPreset(sudokuState.puzzle);
  const items = [
    {
      label: preset.cardLabel,
      value: preset.value,
    },
    {
      label: "WASM solve",
      value: sudokuState.isLoading
        ? sudokuState.solveStartedAt
          ? `${formatSudokuDuration(getCurrentSudokuSolveMs())} …`
          : "warming…"
        : formatSudokuDuration(sudokuState.solveElapsedMs),
    },
    {
      label: "Best deterministic",
      value: sudokuState.baselinePending
        ? "measuring…"
        : sudokuState.baselineTiming
          ? formatSudokuDuration(sudokuState.baselineTiming.elapsedMs)
          : sudokuState.baselineError
            ? "failed"
            : "pending",
    },
    {
      label: "vs MRV JS",
      value: sudokuState.baselinePending
        ? "measuring…"
        : formatSudokuSpeedComparison(
            sudokuState.solveElapsedMs,
            sudokuState.baselineTiming?.elapsedMs ?? NaN
          ),
    },
  ];

  if (!sudokuState.result && !sudokuState.isLoading) {
    refs.sudokuStats.innerHTML = "";
    const placeholder = document.createElement("p");
    placeholder.className = "empty-state";
    placeholder.textContent = "Sudoku stats appear after the WASM executor loads.";
    refs.sudokuStats.append(placeholder);
    return;
  }

  if (sudokuState.result) {
    items.push(
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
        label: "Replay",
        value: formatSudokuReplayValue(),
      }
    );
  }

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

function renderSudokuModelStats() {
  refs.sudokuModelStatus.textContent = sudokuModelState.status;

  const items = [
    {
      label: "Engine",
      value: "local value transformer + verifier",
    },
    {
      label: "Output",
      value: "ranked PLACE candidates",
    },
    {
      label: "Tokens",
      value: sudokuModelState.tokenCount || "—",
    },
    {
      label: "Branch calls",
      value: sudokuModelState.branchCount || "—",
    },
    {
      label: "Avg top-1 conf",
      value: formatSudokuPercent(sudokuModelState.valueAverageConfidence),
    },
    {
      label: "tok/s",
      value: formatSudokuTokenRate(sudokuModelState.tokensPerSecond),
    },
    {
      label: "Guided placements",
      value: sudokuModelState.guidedStats?.placements ?? "—",
    },
    {
      label: "Guided backtracks",
      value: sudokuModelState.guidedStats?.backtracks ?? "—",
    },
    {
      label: "vs ref backtracks",
      value: formatSudokuBacktrackComparison(
        sudokuModelState.guidedStats?.backtracks,
        sudokuModelState.referenceStats?.backtracks
      ),
    },
    {
      label: "Reference BTs",
      value: sudokuModelState.referenceStats?.backtracks ?? "—",
    },
    {
      label: "Elapsed",
      value: formatSudokuDuration(sudokuModelState.elapsedMs),
    },
    {
      label: "Guided trace",
      value: sudokuModelState.traceLength || "—",
    },
    {
      label: "Reference trace",
      value: sudokuModelState.referenceTraceLength || "—",
    },
  ];

  refs.sudokuModelStats.innerHTML = "";
  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `
      <span class="stat-label">${item.label}</span>
      <span class="stat-value">${item.value}</span>
    `;
    refs.sudokuModelStats.append(card);
  });
}

function renderSudokuFlow() {
  const clueCount = countSudokuClues(sudokuState.initialBoard);
  const preset = describeSudokuPreset(sudokuState.puzzle).value;
  const traceLength = sudokuState.result?.trace.length ?? sudokuModelState.traceLength;
  const replayMode = SUDOKU_REPLAY_MODES[sudokuState.replayMode] ?? SUDOKU_REPLAY_MODES.normal;
  const replayDetail = sudokuState.isAnimating
    ? `${replayMode.statusVerb.toLowerCase()} ${Math.min(sudokuState.stepIndex, traceLength || 0)} / ${traceLength || "—"}`
    : sudokuState.result && sudokuState.stepIndex >= sudokuState.result.trace.length
      ? `complete · ${sudokuState.result.trace.length} / ${sudokuState.result.trace.length}`
      : traceLength
        ? `ready · 0 / ${traceLength}`
        : "waiting for solve";

  const nodes = [
    {
      title: "Board state",
      badge: "input",
      detail: `${preset} · ${clueCount} clues`,
      active: sudokuState.isLoading,
    },
    {
      title: "Local transformer",
      badge: sudokuModelState.isRunning ? "active" : "model",
      detail: sudokuModelState.isRunning
        ? sudokuModelState.status
        : sudokuModelState.branchCount
          ? `${formatSudokuTokenRate(sudokuModelState.tokensPerSecond)} · ${sudokuModelState.branchCount} ranked branch calls`
          : "Ranks legal PLACE values at ambiguous branch points",
      active: sudokuModelState.isRunning,
    },
    {
      title: "PSVM ops",
      badge: "ops",
      detail: "FOCUS_NEXT · PLACE(value order) · UNDO",
      active: sudokuModelState.isRunning,
    },
    {
      title: "Exact verifier",
      badge: sudokuModelState.isRunning ? "active" : "exact",
      detail: sudokuModelState.guidedStats
        ? `${sudokuModelState.guidedStats.backtracks} guided backtracks with deterministic legality`
        : "Keeps legality, placement, and backtracking deterministic",
      active: sudokuModelState.isRunning,
    },
    {
      title: "Compare",
      badge: sudokuState.isAnimating ? "live" : "trace",
      detail: sudokuModelState.traceLength
        ? `guided ${sudokuModelState.traceLength} · ref ${sudokuModelState.referenceTraceLength || "—"}`
        : replayDetail,
      active: sudokuState.isAnimating || sudokuModelState.isRunning,
    },
  ];

  refs.sudokuFlow.innerHTML = "";
  nodes.forEach((node, index) => {
    const card = document.createElement("div");
    card.className = `flow-node${node.active ? " is-active" : ""}`;
    card.innerHTML = `
      <div class="flow-node-head">
        <span class="flow-node-title">${node.title}</span>
        <span class="flow-badge${node.active ? " is-active" : ""}">${node.badge}</span>
      </div>
      <p class="flow-node-body">${node.detail}</p>
    `;
    refs.sudokuFlow.append(card);

    if (index < nodes.length - 1) {
      const arrow = document.createElement("span");
      arrow.className = "flow-arrow";
      arrow.textContent = "→";
      refs.sudokuFlow.append(arrow);
    }
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

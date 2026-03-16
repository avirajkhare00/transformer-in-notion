import { buildGivenMask, parseSudoku } from "./logic/sudoku.mjs";
import { HARD_SUDOKU_PRESETS } from "./logic/sudoku-hard.mjs";

const MODEL_PRESETS = [
  ...HARD_SUDOKU_PRESETS,
  {
    id: "browser-demo",
    label: "Browser demo",
    puzzle:
      "300200000000107000706030500070009080900020004010800050009040301000702000000008006",
  },
];

const DEFAULT_PRESET =
  MODEL_PRESETS.find((preset) => preset.id === "ai-escargot") ?? MODEL_PRESETS[0];

const state = {
  puzzle: DEFAULT_PRESET.puzzle,
  board: parseSudoku(DEFAULT_PRESET.puzzle),
  givenMask: [],
  log: [],
  run: null,
  traceLength: null,
  isRunning: false,
};

const refs = {
  board: document.querySelector("#model-board"),
  status: document.querySelector("#model-status"),
  preset: document.querySelector("#model-preset"),
  input: document.querySelector("#model-input"),
  load: document.querySelector("#model-load"),
  run: document.querySelector("#model-run"),
  stats: document.querySelector("#model-stats"),
  log: document.querySelector("#model-log"),
  cells: [],
};

let worker = null;

function init() {
  buildBoard();
  buildPresetMenu();
  const preset = getPresetFromLocation() ?? DEFAULT_PRESET;
  applyPuzzle(preset.puzzle);
  refs.run.addEventListener("click", () => startRun());
  refs.load.addEventListener("click", () => onLoadPuzzle());
  refs.preset.addEventListener("change", () => onPresetChange());
  refs.input.addEventListener("input", () => {
    refs.preset.value = "custom";
  });
  render();
}

function buildBoard() {
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const cell = document.createElement("div");
      const classes = [
        "sudoku-cell",
        col === 2 || col === 5 ? "block-right" : "",
        row === 2 || row === 5 ? "block-bottom" : "",
      ]
        .filter(Boolean)
        .join(" ");
      cell.className = classes;
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      refs.board.append(cell);
      refs.cells.push(cell);
    }
  }
}

function buildPresetMenu() {
  refs.preset.innerHTML = "";
  const customOption = document.createElement("option");
  customOption.value = "custom";
  customOption.textContent = "Bring your own";
  refs.preset.append(customOption);

  MODEL_PRESETS.forEach((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    refs.preset.append(option);
  });
}

function normalizePuzzleText(text) {
  return text.replace(/[^0-9.]/g, "").replace(/\./g, "0");
}

function formatPuzzleText(puzzle) {
  const normalized = normalizePuzzleText(puzzle).replace(/0/g, ".");
  const rows = [];
  for (let row = 0; row < 9; row += 1) {
    rows.push(normalized.slice(row * 9, row * 9 + 9));
  }
  return rows.join("\n");
}

function findPreset(id) {
  return MODEL_PRESETS.find((preset) => preset.id === id) ?? null;
}

function findPresetByPuzzle(puzzle) {
  const normalized = normalizePuzzleText(puzzle);
  return MODEL_PRESETS.find((preset) => preset.puzzle === normalized) ?? null;
}

function describePreset(puzzle) {
  const preset = findPresetByPuzzle(puzzle);
  if (!preset) {
    return { label: "Preset", value: "Custom puzzle" };
  }

  const isHard = HARD_SUDOKU_PRESETS.some((candidate) => candidate.id === preset.id);
  return {
    label: isHard ? "Hard preset" : "Preset",
    value: preset.label,
  };
}

function getPresetFromLocation() {
  const url = new URL(window.location.href);
  const presetId = url.searchParams.get("preset");
  return presetId ? findPreset(presetId) : null;
}

function syncPresetInLocation(puzzle) {
  const url = new URL(window.location.href);
  const preset = findPresetByPuzzle(puzzle);
  if (preset) {
    url.searchParams.set("preset", preset.id);
  } else {
    url.searchParams.delete("preset");
  }
  window.history.replaceState({}, "", url);
}

function formatRate(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "—";
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} tok/s`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "—";
  }
  if (ms < 1000) {
    return `${ms.toFixed(ms < 100 ? 1 : 0)} ms`;
  }
  return `${(ms / 1000).toFixed(2)} s`;
}

function stopWorker() {
  if (!worker) {
    return;
  }
  worker.terminate();
  worker = null;
}

function pushLog(message) {
  state.log.push(message);
  if (state.log.length > 220) {
    state.log.shift();
  }
}

function pushLogs(lines) {
  lines.forEach((line) => pushLog(line));
}

function applyPuzzle(rawPuzzle) {
  const normalized = normalizePuzzleText(rawPuzzle);
  state.puzzle = normalized;
  state.board = parseSudoku(normalized);
  state.givenMask = buildGivenMask(state.board);
  state.log = [];
  state.run = null;
  state.traceLength = null;
  refs.input.value = formatPuzzleText(normalized);
  refs.preset.value = findPresetByPuzzle(normalized)?.id ?? "custom";
  syncPresetInLocation(normalized);
  pushLog(`Ready to probe ${describePreset(normalized).value}.`);
  render();
}

function onPresetChange() {
  if (refs.preset.value === "custom") {
    return;
  }
  const preset = findPreset(refs.preset.value);
  if (preset) {
    applyPuzzle(preset.puzzle);
  }
}

function onLoadPuzzle() {
  try {
    applyPuzzle(refs.input.value);
  } catch (error) {
    state.log = [];
    pushLog(error instanceof Error ? error.message : "Sudoku input must contain 81 cells.");
    render();
  }
}

function startRun() {
  stopWorker();
  state.isRunning = true;
  state.run = null;
  state.log = [];
  pushLog(
    `Running local transformer trace-token probe on ${describePreset(state.puzzle).value}.`
  );
  render();

  worker = new Worker(new URL("./soduku/model-worker.mjs", import.meta.url), {
    type: "module",
  });

  worker.onmessage = ({ data }) => {
    if (data.type === "start") {
      state.board = data.initialBoard;
      state.givenMask = buildGivenMask(data.initialBoard);
      state.traceLength = data.traceLength;
      pushLog(`Teacher trace length ${data.traceLength}. Strategy ${data.strategy}.`);
      render();
      return;
    }

    if (data.type === "event-batch") {
      state.board = data.snapshot;
      state.run = {
        tokenCount: data.tokenCount,
        predictionCount: data.predictionCount,
        averageConfidence: data.averageConfidence,
        accuracy: data.accuracy,
        valuePredictionCount: data.valuePredictionCount,
        valueAverageConfidence: data.valueAverageConfidence,
        valueAccuracy: data.valueAccuracy,
        tokensPerSecond: data.tokensPerSecond,
        elapsedMs: data.elapsedMs,
        traceLength: state.traceLength,
      };
      pushLogs(data.lines ?? []);
      render();
      return;
    }

    if (data.type === "done") {
      state.isRunning = false;
      state.board = data.solution;
      state.run = {
        tokenCount: data.tokenCount,
        predictionCount: data.predictionCount,
        averageConfidence: data.averageConfidence,
        accuracy: data.accuracy,
        valuePredictionCount: data.valuePredictionCount,
        valueAverageConfidence: data.valueAverageConfidence,
        valueAccuracy: data.valueAccuracy,
        tokensPerSecond: data.tokensPerSecond,
        elapsedMs: data.elapsedMs,
        traceLength: data.traceLength,
      };
      state.traceLength = data.traceLength;
      pushLog(
        `Done. ${data.tokenCount} trace-token predictions in ${data.elapsedMs} ms. ` +
          `Op accuracy ${formatPercent(data.accuracy)}. ` +
          `PLACE value accuracy ${formatPercent(data.valueAccuracy)}.`
      );
      stopWorker();
      render();
      return;
    }

    if (data.type === "error") {
      state.isRunning = false;
      pushLog(data.message);
      stopWorker();
      render();
    }
  };

  worker.postMessage({
    type: "run",
    puzzle: state.puzzle,
  });
}

function renderBoard() {
  refs.cells.forEach((cell) => {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const value = state.board[row][col];
    cell.textContent = value ? String(value) : "";
    cell.classList.toggle("is-given", state.givenMask[row][col]);
    cell.classList.toggle("is-live", Boolean(value) && !state.givenMask[row][col]);
    cell.classList.toggle("is-focus", false);
    cell.classList.toggle("is-place", false);
    cell.classList.toggle("is-backtrack", false);
  });
}

function renderStatus() {
  if (state.isRunning && state.run) {
    refs.status.textContent =
      `Model is replaying batched trace tokens at ${formatRate(state.run.tokensPerSecond)}. ` +
      `Op accuracy ${formatPercent(state.run.accuracy)}. ` +
      `PLACE value accuracy ${formatPercent(state.run.valueAccuracy)} so far.`;
    return;
  }

  if (state.isRunning) {
    refs.status.textContent = "Loading local Sudoku trace-token models.";
    return;
  }

  if (state.run) {
    refs.status.textContent =
      `Finished ${state.run.tokenCount} trace-token predictions at ${formatRate(state.run.tokensPerSecond)}. ` +
      `Op accuracy ${formatPercent(state.run.accuracy)}. ` +
      `PLACE value accuracy ${formatPercent(state.run.valueAccuracy)}.`;
    return;
  }

  refs.status.textContent =
    `Ready to run the trace-token models on ${describePreset(state.puzzle).value}.`;
}

function renderStats() {
  refs.stats.innerHTML = "";

  const preset = describePreset(state.puzzle);
  const cards = [
    [preset.label, preset.value],
    ["Engine", "local transformers"],
    ["Output", "op + PLACE value"],
  ];

  if (state.run) {
    cards.push(
      ["Tokens", state.run.tokenCount],
      ["Op predictions", state.run.predictionCount],
      ["Op top-1", formatPercent(state.run.accuracy)],
      ["Op confidence", formatPercent(state.run.averageConfidence)],
      ["PLACE values", state.run.valuePredictionCount],
      ["PLACE top-1", formatPercent(state.run.valueAccuracy)],
      ["PLACE conf", formatPercent(state.run.valueAverageConfidence)],
      ["tok/s", formatRate(state.run.tokensPerSecond)],
      ["Elapsed", formatDuration(state.run.elapsedMs)],
      ["Teacher trace", state.run.traceLength]
    );
  } else if (state.traceLength) {
    cards.push(["Teacher trace", state.traceLength]);
  }

  cards.forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `
      <span class="stat-label">${label}</span>
      <span class="stat-value">${value}</span>
    `;
    refs.stats.append(card);
  });
}

function renderLog() {
  refs.log.innerHTML = "";
  state.log.forEach((line) => {
    const entry = document.createElement("li");
    entry.textContent = line;
    refs.log.append(entry);
  });
  refs.log.scrollTop = refs.log.scrollHeight;
}

function render() {
  refs.run.disabled = state.isRunning;
  refs.load.disabled = state.isRunning;
  refs.preset.disabled = state.isRunning;
  refs.input.disabled = state.isRunning;
  renderBoard();
  renderStatus();
  renderStats();
  renderLog();
}

init();

import {
  DEFAULT_PUZZLE,
  buildGivenMask,
  parseSudoku,
} from "./logic/sudoku.mjs";
import { HARD_SUDOKU_PRESETS } from "./logic/sudoku-hard.mjs";
import { benchmarkSudokuWasm } from "./logic/sudoku-wasm.mjs";

const BENCHMARK_RUNS = 100;
const BENCHMARK_PRESETS = [
  ...HARD_SUDOKU_PRESETS,
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

const DEFAULT_PRESET =
  BENCHMARK_PRESETS.find((preset) => preset.id === "ai-escargot") ?? BENCHMARK_PRESETS[0];

const state = {
  puzzle: DEFAULT_PRESET.puzzle,
  board: parseSudoku(DEFAULT_PRESET.puzzle),
  givenMask: [],
  benchmark: null,
  status: "",
  error: "",
  isRunning: false,
  requestId: 0,
};

const refs = {
  board: document.querySelector("#benchmark-board"),
  status: document.querySelector("#benchmark-status"),
  preset: document.querySelector("#benchmark-preset"),
  input: document.querySelector("#benchmark-input"),
  load: document.querySelector("#benchmark-load"),
  run: document.querySelector("#benchmark-run"),
  stats: document.querySelector("#benchmark-stats"),
  samples: document.querySelector("#benchmark-samples"),
  cells: [],
};

function init() {
  buildBoard();
  buildPresetMenu();
  const preset = getPresetFromLocation() ?? DEFAULT_PRESET;
  applyPuzzle(preset.puzzle);
  refs.run.addEventListener("click", () => runBenchmark());
  refs.load.addEventListener("click", () => onLoadPuzzle());
  refs.preset.addEventListener("change", () => onPresetChange());
  refs.input.addEventListener("input", () => {
    refs.preset.value = "custom";
  });
  void runBenchmark();
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

  BENCHMARK_PRESETS.forEach((preset) => {
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
  return BENCHMARK_PRESETS.find((preset) => preset.id === id) ?? null;
}

function findPresetByPuzzle(puzzle) {
  const normalized = normalizePuzzleText(puzzle);
  return BENCHMARK_PRESETS.find((preset) => preset.puzzle === normalized) ?? null;
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

function describePreset(puzzle) {
  const preset = findPresetByPuzzle(puzzle);
  if (!preset) {
    return {
      label: "Preset",
      value: "Custom puzzle",
    };
  }

  const isHard = HARD_SUDOKU_PRESETS.some((candidate) => candidate.id === preset.id);
  return {
    label: isHard ? "Hard preset" : "Preset",
    value: preset.label,
  };
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

function applyPuzzle(rawPuzzle) {
  const normalized = normalizePuzzleText(rawPuzzle);
  const board = parseSudoku(normalized);
  state.puzzle = normalized;
  state.board = board;
  state.givenMask = buildGivenMask(board);
  state.benchmark = null;
  state.error = "";
  state.status = `Ready to benchmark ${describePreset(normalized).value} with ${BENCHMARK_RUNS} WASM solves.`;
  refs.input.value = formatPuzzleText(normalized);
  refs.preset.value = findPresetByPuzzle(normalized)?.id ?? "custom";
  syncPresetInLocation(normalized);
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
    state.error = error instanceof Error ? error.message : "Sudoku input must contain 81 cells.";
    state.status = state.error;
    render();
  }
}

async function runBenchmark() {
  const requestId = ++state.requestId;
  state.isRunning = true;
  state.error = "";
  state.benchmark = null;
  state.status = `Benchmarking ${describePreset(state.puzzle).value} with ${BENCHMARK_RUNS} WASM solves in an isolated worker.`;
  render();

  try {
    const result = await benchmarkSudokuWasm(state.puzzle, BENCHMARK_RUNS);
    if (requestId !== state.requestId) {
      return;
    }

    state.isRunning = false;
    state.benchmark = result;
    state.status =
      `Finished ${result.runs} WASM solves. Cold solve ${formatDuration(result.firstSolveMs)}. ` +
      `Warm median ${formatDuration(result.warm.medianMs)}.`;
    render();
  } catch (error) {
    if (requestId !== state.requestId) {
      return;
    }

    state.isRunning = false;
    state.error = error instanceof Error ? error.message : "WASM benchmark failed.";
    state.status = state.error;
    render();
  }
}

function render() {
  refs.cells.forEach((cell) => {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const value = state.board[row][col];
    cell.textContent = value ? String(value) : "";
    cell.classList.toggle("is-given", state.givenMask[row][col]);
    cell.classList.toggle("is-live", false);
    cell.classList.toggle("is-focus", false);
    cell.classList.toggle("is-place", false);
    cell.classList.toggle("is-backtrack", false);
  });

  refs.status.textContent = state.status;
  refs.run.disabled = state.isRunning;
  refs.load.disabled = state.isRunning;
  refs.preset.disabled = state.isRunning;
  refs.input.disabled = state.isRunning;
  renderStats();
  renderSamples();
}

function renderStats() {
  refs.stats.innerHTML = "";

  if (!state.benchmark) {
    const placeholder = document.createElement("p");
    placeholder.className = "empty-state";
    placeholder.textContent = state.isRunning
      ? `Running ${BENCHMARK_RUNS} isolated WASM solves…`
      : "Run the benchmark to collect cold and warm WASM timings.";
    refs.stats.append(placeholder);
    return;
  }

  const preset = describePreset(state.puzzle);
  const items = [
    [preset.label, preset.value],
    ["Runs", state.benchmark.runs],
    ["Instantiate", formatDuration(state.benchmark.instantiateMs)],
    ["Cold solve", formatDuration(state.benchmark.firstSolveMs)],
    ["Warm median", formatDuration(state.benchmark.warm.medianMs)],
    ["Warm mean", formatDuration(state.benchmark.warm.meanMs)],
    ["Warm p95", formatDuration(state.benchmark.warm.p95Ms)],
    ["Warm min", formatDuration(state.benchmark.warm.minMs)],
    ["Warm max", formatDuration(state.benchmark.warm.maxMs)],
    ["Trace events", state.benchmark.traceLength],
    ["Placements", state.benchmark.placements],
    ["Backtracks", state.benchmark.backtracks],
  ];

  items.forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `
      <span class="stat-label">${label}</span>
      <span class="stat-value">${value}</span>
    `;
    refs.stats.append(card);
  });
}

function renderSamples() {
  if (!state.benchmark) {
    refs.samples.textContent = state.isRunning
      ? "Preparing 100-run sample list…"
      : "No benchmark samples yet.";
    return;
  }

  refs.samples.textContent = state.benchmark.samplesMs
    .map((value, index) => `run ${String(index + 1).padStart(3, "0")}  ${value.toFixed(3)} ms`)
    .join("\n");
}

init();

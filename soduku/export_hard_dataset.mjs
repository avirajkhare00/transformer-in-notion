import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { HARD_SUDOKU_PRESETS } from "../logic/sudoku-hard.mjs";
import {
  cloneSudokuBoard,
  countFilledSudokuCells,
  parseSudoku,
  solveSudokuWithTrace,
} from "../logic/sudoku.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const OP_LABELS = Object.freeze(["FOCUS_NEXT", "PLACE", "UNDO"]);
const DEFAULT_OUTPUT = resolve(__dirname, "training/hard-op-dataset.json");
const DEFAULT_HISTORY_WINDOW = 8;
const DEFAULT_LIMIT_PER_PUZZLE = 20_000;
const DEFAULT_EVAL_PUZZLES = ["ai-escargot"];

function parseArgs(argv) {
  let output = DEFAULT_OUTPUT;
  let historyWindow = DEFAULT_HISTORY_WINDOW;
  let limitPerPuzzle = DEFAULT_LIMIT_PER_PUZZLE;
  let evalPuzzles = [...DEFAULT_EVAL_PUZZLES];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output" && argv[index + 1]) {
      output = resolve(process.cwd(), argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--history-window" && argv[index + 1]) {
      historyWindow = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--limit-per-puzzle" && argv[index + 1]) {
      limitPerPuzzle = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--eval-puzzles" && argv[index + 1]) {
      evalPuzzles = argv[index + 1]
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      index += 1;
    }
  }

  if (!Number.isInteger(historyWindow) || historyWindow < 1) {
    throw new Error("--history-window must be a positive integer.");
  }
  if (!Number.isInteger(limitPerPuzzle) || limitPerPuzzle < 0) {
    throw new Error("--limit-per-puzzle must be a non-negative integer.");
  }
  if (evalPuzzles.length === 0) {
    throw new Error("--eval-puzzles must include at least one puzzle id.");
  }

  return {
    output,
    historyWindow,
    limitPerPuzzle,
    evalPuzzles: new Set(evalPuzzles),
  };
}

function eventToOp(event) {
  switch (event.type) {
    case "focus":
      return "FOCUS_NEXT";
    case "place":
      return "PLACE";
    case "backtrack":
      return "UNDO";
    default:
      throw new Error(`Unsupported Sudoku trace event: ${event.type}`);
  }
}

function takeEvenlyDistributedSamples(samples, limit) {
  if (limit === 0 || samples.length <= limit) {
    return samples;
  }

  const selected = [];
  const stride = samples.length / limit;
  for (let index = 0; index < limit; index += 1) {
    selected.push(samples[Math.floor(index * stride)]);
  }
  return selected;
}

function buildContext({ board, focus, historyOps, historyWindow, strategy }) {
  const history =
    historyOps.length === 0
      ? "START"
      : historyOps.slice(-historyWindow).join(" ");
  const boardTokens = board
    .flat()
    .map((value) => (value === 0 ? "." : String(value)))
    .join(" ");
  const focusRow = focus ? String(focus.row + 1) : "none";
  const focusCol = focus ? String(focus.col + 1) : "none";
  const candidateTokens =
    focus && focus.candidates.length > 0 ? focus.candidates.join(" ") : "none";

  return [
    `strategy ${strategy}`,
    `board ${boardTokens}`,
    `filled ${countFilledSudokuCells(board)}`,
    `focus_row ${focusRow}`,
    `focus_col ${focusCol}`,
    `cands ${candidateTokens}`,
    `history ${history}`,
  ].join(" ");
}

function applyEvent(board, event, focus) {
  switch (event.type) {
    case "focus":
      return {
        row: event.row,
        col: event.col,
        candidates: [...event.candidates],
      };
    case "place":
      board[event.row][event.col] = event.value;
      return focus;
    case "backtrack":
      board[event.row][event.col] = 0;
      return focus;
    default:
      throw new Error(`Unsupported Sudoku trace event: ${event.type}`);
  }
}

function buildSamplesForPreset(preset, options) {
  const startBoard = parseSudoku(preset.puzzle);
  const result = solveSudokuWithTrace(startBoard, { strategy: "mrv" });
  const board = cloneSudokuBoard(startBoard);
  const historyOps = [];
  let focus = null;
  const samples = [];

  for (let traceIndex = 0; traceIndex < result.trace.length; traceIndex += 1) {
    const event = result.trace[traceIndex];
    const nextOp = eventToOp(event);
    const label = OP_LABELS.indexOf(nextOp);
    if (label < 0) {
      throw new Error(`Unknown Sudoku op label: ${nextOp}`);
    }

    samples.push({
      context: buildContext({
        board,
        focus,
        historyOps,
        historyWindow: options.historyWindow,
        strategy: result.strategy,
      }),
      nextOp,
      label,
      split: options.evalPuzzles.has(preset.id) ? "eval" : "train",
      puzzleId: preset.id,
      puzzleLabel: preset.label,
      traceIndex,
      depth: event.depth ?? 0,
      row: typeof event.row === "number" ? event.row : null,
      col: typeof event.col === "number" ? event.col : null,
      value: typeof event.value === "number" ? event.value : null,
    });

    focus = applyEvent(board, event, focus);
    historyOps.push(nextOp);
  }

  return {
    result,
    samples: takeEvenlyDistributedSamples(samples, options.limitPerPuzzle),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const samples = [];
  const byPuzzle = {};

  for (const preset of HARD_SUDOKU_PRESETS) {
    const { result, samples: puzzleSamples } = buildSamplesForPreset(preset, options);
    byPuzzle[preset.id] = {
      label: preset.label,
      split: options.evalPuzzles.has(preset.id) ? "eval" : "train",
      sampleCount: puzzleSamples.length,
      fullTraceLength: result.trace.length,
      strategy: result.strategy,
      stats: result.stats,
    };
    samples.push(...puzzleSamples);
  }

  const payload = {
    generator: "soduku/export_hard_dataset.mjs",
    opLabels: OP_LABELS,
    historyWindow: options.historyWindow,
    limitPerPuzzle: options.limitPerPuzzle,
    evalPuzzleIds: [...options.evalPuzzles],
    trainPuzzleIds: HARD_SUDOKU_PRESETS.map((preset) => preset.id).filter(
      (id) => !options.evalPuzzles.has(id),
    ),
    byPuzzle,
    sampleCount: samples.length,
    samples,
  };

  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, JSON.stringify(payload, null, 2));
  console.log(
    `Wrote ${samples.length} hard Sudoku next-op samples to ${options.output}.`,
  );
}

main();

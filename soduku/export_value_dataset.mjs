import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { HARD_SUDOKU_PRESETS } from "../logic/sudoku-hard.mjs";
import {
  cloneSudokuBoard,
  parseSudoku,
  solveSudokuWithTrace,
} from "../logic/sudoku.mjs";
import {
  HARD_OP_HISTORY_WINDOW,
  applyHardTraceEvent,
  buildHardOpContext,
} from "./hard-op-context.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const VALUE_LABELS = Object.freeze(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
const DEFAULT_OUTPUT = resolve(__dirname, "training/hard-value-dataset.json");
const DEFAULT_LIMIT_PER_PUZZLE = 20_000;
const DEFAULT_EVAL_PUZZLES = ["ai-escargot"];

function parseArgs(argv) {
  let output = DEFAULT_OUTPUT;
  let historyWindow = HARD_OP_HISTORY_WINDOW;
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

function pruneFocusFrames(focusFrames, depth) {
  for (const key of [...focusFrames.keys()]) {
    if (key > depth) {
      focusFrames.delete(key);
    }
  }
}

function buildSamplesForPreset(preset, options) {
  const startBoard = parseSudoku(preset.puzzle);
  const result = solveSudokuWithTrace(startBoard, { strategy: "mrv" });
  const board = cloneSudokuBoard(startBoard);
  const historyOps = [];
  const focusFrames = new Map();
  const samples = [];

  for (let traceIndex = 0; traceIndex < result.trace.length; traceIndex += 1) {
    const event = result.trace[traceIndex];
    const focus =
      typeof event.depth === "number" ? (focusFrames.get(event.depth) ?? null) : null;

    if (event.type === "place") {
      if (!focus) {
        throw new Error("Encountered PLACE event without an active focus.");
      }
      if (focus.row !== event.row || focus.col !== event.col) {
        throw new Error("PLACE event row/col does not match the active focus.");
      }

      const state = buildHardOpContext({
        board,
        focus,
        historyOps,
        historyWindow: options.historyWindow,
        strategy: result.strategy,
      });

      samples.push({
        ...state,
        nextValue: String(event.value),
        label: event.value - 1,
        split: options.evalPuzzles.has(preset.id) ? "eval" : "train",
        puzzleId: preset.id,
        puzzleLabel: preset.label,
        traceIndex,
        depth: event.depth ?? 0,
        row: event.row,
        col: event.col,
        value: event.value,
        candidates: [...focus.candidates],
      });
    }

    applyHardTraceEvent(board, event, focus);
    if (event.type === "focus") {
      pruneFocusFrames(focusFrames, event.depth);
      focusFrames.set(event.depth, {
        row: event.row,
        col: event.col,
        candidates: [...event.candidates],
      });
    }
    if (event.type === "backtrack") {
      pruneFocusFrames(focusFrames, event.depth);
    }
    if (event.type === "focus") {
      historyOps.push("FOCUS_NEXT");
    } else if (event.type === "place") {
      historyOps.push("PLACE");
    } else if (event.type === "backtrack") {
      historyOps.push("UNDO");
    }
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
    generator: "soduku/export_value_dataset.mjs",
    format: "structured-state-v1",
    valueLabels: VALUE_LABELS,
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
  console.log(`Wrote ${samples.length} hard Sudoku PLACE-value samples to ${options.output}.`);
}

main();

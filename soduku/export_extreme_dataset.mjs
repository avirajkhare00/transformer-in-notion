import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  cloneSudokuBoard,
  parseSudoku,
  solveSudokuWithTrace,
} from "../logic/sudoku.mjs";
import {
  HARD_OP_HISTORY_WINDOW,
  HARD_OP_LABELS,
  applyHardTraceEvent,
  buildHardOpContext,
} from "./hard-op-context.mjs";
import { streamExtremeSudokuCsv } from "./extreme-csv.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const VALUE_LABELS = Object.freeze(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
const DEFAULT_INPUT = resolve(__dirname, "train_data/train.csv");
const DEFAULT_OUTPUT_DIR = resolve(__dirname, "training/extreme");
const DEFAULT_EVAL_PERCENT = 5;
const DEFAULT_MIN_RATING = 0;
const DEFAULT_STATUS_EVERY = 100;

function parseArgs(argv) {
  let input = DEFAULT_INPUT;
  let outputDir = DEFAULT_OUTPUT_DIR;
  let evalPercent = DEFAULT_EVAL_PERCENT;
  let historyWindow = HARD_OP_HISTORY_WINDOW;
  let limitPuzzles = 0;
  let minRating = DEFAULT_MIN_RATING;
  let statusEvery = DEFAULT_STATUS_EVERY;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input" && argv[index + 1]) {
      input = resolve(process.cwd(), argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--output-dir" && argv[index + 1]) {
      outputDir = resolve(process.cwd(), argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--eval-percent" && argv[index + 1]) {
      evalPercent = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--history-window" && argv[index + 1]) {
      historyWindow = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--limit-puzzles" && argv[index + 1]) {
      limitPuzzles = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--min-rating" && argv[index + 1]) {
      minRating = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--status-every" && argv[index + 1]) {
      statusEvery = Number(argv[index + 1]);
      index += 1;
    }
  }

  if (!Number.isInteger(historyWindow) || historyWindow < 1) {
    throw new Error("--history-window must be a positive integer.");
  }
  if (!Number.isInteger(limitPuzzles) || limitPuzzles < 0) {
    throw new Error("--limit-puzzles must be a non-negative integer.");
  }
  if (!Number.isFinite(evalPercent) || evalPercent < 0 || evalPercent > 100) {
    throw new Error("--eval-percent must be between 0 and 100.");
  }
  if (!Number.isFinite(minRating)) {
    throw new Error("--min-rating must be numeric.");
  }
  if (!Number.isInteger(statusEvery) || statusEvery < 1) {
    throw new Error("--status-every must be a positive integer.");
  }

  return {
    input,
    outputDir,
    evalPercent,
    historyWindow,
    limitPuzzles,
    minRating,
    statusEvery,
  };
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function splitForPuzzle(question, evalPercent) {
  if (evalPercent === 0) {
    return "train";
  }
  return fnv1a(question) % 100 < evalPercent ? "eval" : "train";
}

function boardToString(board) {
  return board.flat().join("");
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

function pruneFocusFrames(focusFrames, depth) {
  for (const key of [...focusFrames.keys()]) {
    if (key > depth) {
      focusFrames.delete(key);
    }
  }
}

function buildManifest({
  generator,
  input,
  historyWindow,
  evalPercent,
  minRating,
  limitPuzzles,
  splitCounts,
  sampleCounts,
  labels,
  trainPath,
  evalPath,
}) {
  return {
    generator,
    sourceCsv: input,
    format: "structured-state-v1-jsonl",
    historyWindow,
    evalPercent,
    minRating,
    limitPuzzles,
    puzzleCounts: splitCounts,
    sampleCounts,
    labels,
    trainPath,
    evalPath,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(options.outputDir, { recursive: true });

  const opTrainPath = resolve(options.outputDir, "extreme-op-train.jsonl");
  const opEvalPath = resolve(options.outputDir, "extreme-op-eval.jsonl");
  const valueTrainPath = resolve(options.outputDir, "extreme-value-train.jsonl");
  const valueEvalPath = resolve(options.outputDir, "extreme-value-eval.jsonl");

  const opTrain = createWriteStream(opTrainPath, { encoding: "utf8" });
  const opEval = createWriteStream(opEvalPath, { encoding: "utf8" });
  const valueTrain = createWriteStream(valueTrainPath, { encoding: "utf8" });
  const valueEval = createWriteStream(valueEvalPath, { encoding: "utf8" });

  const splitCounts = {
    trainPuzzles: 0,
    evalPuzzles: 0,
  };
  const sampleCounts = {
    trainOpSamples: 0,
    evalOpSamples: 0,
    trainValueSamples: 0,
    evalValueSamples: 0,
    skippedPuzzles: 0,
    solutionMismatches: 0,
    invalidRows: 0,
    processedRows: 0,
  };

  try {
    for await (const row of streamExtremeSudokuCsv(options.input)) {
      if (options.limitPuzzles && sampleCounts.processedRows >= options.limitPuzzles) {
        break;
      }
      if (!Number.isFinite(row.rating) || row.rating < options.minRating) {
        continue;
      }
      if (row.question.length !== 81 || row.answer.length !== 81) {
        sampleCounts.invalidRows += 1;
        continue;
      }

      sampleCounts.processedRows += 1;
      const split = splitForPuzzle(row.question, options.evalPercent);
      if (split === "eval") {
        splitCounts.evalPuzzles += 1;
      } else {
        splitCounts.trainPuzzles += 1;
      }

      let result;
      let startBoard;
      try {
        startBoard = parseSudoku(row.question);
        result = solveSudokuWithTrace(startBoard, { strategy: "mrv" });
      } catch (error) {
        sampleCounts.invalidRows += 1;
        continue;
      }

      if (!result.solved || boardToString(result.solution) !== row.answer) {
        sampleCounts.solutionMismatches += 1;
        continue;
      }

      const puzzleId = `${row.source}:${row.rowIndex}`;
      const opWriter = split === "eval" ? opEval : opTrain;
      const valueWriter = split === "eval" ? valueEval : valueTrain;

      {
        const board = cloneSudokuBoard(startBoard);
        const historyOps = [];
        let focus = null;

        for (let traceIndex = 0; traceIndex < result.trace.length; traceIndex += 1) {
          const event = result.trace[traceIndex];
          const nextOp = eventToOp(event);
          const label = HARD_OP_LABELS.indexOf(nextOp);
          const state = buildHardOpContext({
            board,
            focus,
            historyOps,
            historyWindow: options.historyWindow,
            strategy: result.strategy,
          });

          opWriter.write(
            `${JSON.stringify({
              ...state,
              nextOp,
              label,
              split,
              puzzleId,
              source: row.source,
              rating: row.rating,
              traceIndex,
            })}\n`,
          );
          if (split === "eval") {
            sampleCounts.evalOpSamples += 1;
          } else {
            sampleCounts.trainOpSamples += 1;
          }

          focus = applyHardTraceEvent(board, event, focus);
          historyOps.push(nextOp);
        }
      }

      {
        const board = cloneSudokuBoard(startBoard);
        const historyOps = [];
        const focusFrames = new Map();

        for (let traceIndex = 0; traceIndex < result.trace.length; traceIndex += 1) {
          const event = result.trace[traceIndex];
          const focus =
            typeof event.depth === "number" ? (focusFrames.get(event.depth) ?? null) : null;

          if (event.type === "place") {
            if (!focus || focus.row !== event.row || focus.col !== event.col) {
              sampleCounts.invalidRows += 1;
              break;
            }

            const state = buildHardOpContext({
              board,
              focus,
              historyOps,
              historyWindow: options.historyWindow,
              strategy: result.strategy,
            });

            valueWriter.write(
              `${JSON.stringify({
                ...state,
                nextValue: String(event.value),
                label: event.value - 1,
                split,
                puzzleId,
                source: row.source,
                rating: row.rating,
                traceIndex,
                row: event.row,
                col: event.col,
                value: event.value,
                depth: event.depth ?? 0,
              })}\n`,
            );
            if (split === "eval") {
              sampleCounts.evalValueSamples += 1;
            } else {
              sampleCounts.trainValueSamples += 1;
            }
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
      }

      if (sampleCounts.processedRows % options.statusEvery === 0) {
        console.log(
          `processed ${sampleCounts.processedRows} puzzles · op=${sampleCounts.trainOpSamples + sampleCounts.evalOpSamples} · value=${sampleCounts.trainValueSamples + sampleCounts.evalValueSamples}`,
        );
      }
    }
  } finally {
    await Promise.all([
      new Promise((resolveStream) => opTrain.end(resolveStream)),
      new Promise((resolveStream) => opEval.end(resolveStream)),
      new Promise((resolveStream) => valueTrain.end(resolveStream)),
      new Promise((resolveStream) => valueEval.end(resolveStream)),
    ]);
  }

  const opManifest = buildManifest({
    generator: "soduku/export_extreme_dataset.mjs",
    input: options.input,
    historyWindow: options.historyWindow,
    evalPercent: options.evalPercent,
    minRating: options.minRating,
    limitPuzzles: options.limitPuzzles,
    splitCounts,
    sampleCounts,
    labels: HARD_OP_LABELS,
    trainPath: relative(options.outputDir, opTrainPath),
    evalPath: relative(options.outputDir, opEvalPath),
  });

  const valueManifest = buildManifest({
    generator: "soduku/export_extreme_dataset.mjs",
    input: options.input,
    historyWindow: options.historyWindow,
    evalPercent: options.evalPercent,
    minRating: options.minRating,
    limitPuzzles: options.limitPuzzles,
    splitCounts,
    sampleCounts,
    labels: VALUE_LABELS,
    trainPath: relative(options.outputDir, valueTrainPath),
    evalPath: relative(options.outputDir, valueEvalPath),
  });

  writeFileSync(
    resolve(options.outputDir, "extreme-op-manifest.json"),
    JSON.stringify(opManifest, null, 2),
  );
  writeFileSync(
    resolve(options.outputDir, "extreme-value-manifest.json"),
    JSON.stringify(valueManifest, null, 2),
  );

  console.log(
    `Wrote streamed extreme manifests to ${options.outputDir} using ${sampleCounts.processedRows} puzzles.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

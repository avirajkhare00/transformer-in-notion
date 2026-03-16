import { cloneSudokuBoard, parseSudoku, solveSudokuWithTrace } from "../logic/sudoku.mjs";
import {
  HARD_OP_HISTORY_WINDOW,
  applyHardTraceEvent,
  buildHardOpContext,
  eventToHardOp,
} from "./hard-op-context.mjs";
import { predictHardSudokuNextOps, warmHardSudokuModel } from "./model.mjs";
import {
  predictHardSudokuPlaceValues,
  warmHardSudokuValueModel,
} from "./value-model.mjs";

const EMIT_EVERY = 256;
const BUILD_PROGRESS_EVERY = 512;
const OP_BATCH_SIZE = 128;
const VALUE_BATCH_SIZE = 128;

function formatOpSummary(predictions, expectedOp) {
  const top = predictions[0];
  const correct = top?.op === expectedOp;
  const head = top ? `${top.op} ${(top.score * 100).toFixed(1)}%` : "no prediction";
  const tail = predictions
    .slice(1)
    .map((prediction) => `${prediction.op} ${(prediction.score * 100).toFixed(1)}%`)
    .join(" · ");

  return [
    `[op ${head}]`,
    `expected ${expectedOp}`,
    correct ? "match" : "miss",
    tail ? `alts ${tail}` : "",
  ]
    .filter(Boolean)
    .join("  ");
}

function formatValueSummary(valueProbe) {
  if (!valueProbe) {
    return "";
  }

  const top = valueProbe.predictions[0];
  const head = top ? `${top.value} ${(top.score * 100).toFixed(1)}%` : "no prediction";
  const tail = valueProbe.predictions
    .slice(1)
    .map((prediction) => `${prediction.value} ${(prediction.score * 100).toFixed(1)}%`)
    .join(" · ");

  return [
    `[value ${head}]`,
    `expected ${valueProbe.expectedValue}`,
    valueProbe.correct ? "match" : "miss",
    tail ? `alts ${tail}` : "",
  ]
    .filter(Boolean)
    .join("  ");
}

function formatPredictionLine(step, expectedOp, predictions, valueProbe = null) {
  return [
    `#${String(step).padStart(3, "0")}`,
    formatOpSummary(predictions, expectedOp),
    formatValueSummary(valueProbe),
  ]
    .filter(Boolean)
    .join("  ");
}

function summarizeRate(totalTokens, elapsedMs) {
  return elapsedMs > 0 ? totalTokens / (elapsedMs / 1000) : 0;
}

async function yieldToBrowser() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function postProgress({ phase, completed = null, total = null, message }) {
  self.postMessage({
    type: "progress",
    phase,
    completed,
    total,
    message,
  });
}

function pruneFocusFrames(focusFrames, depth) {
  for (const key of [...focusFrames.keys()]) {
    if (key > depth) {
      focusFrames.delete(key);
    }
  }
}

function filterLegalValuePredictions(predictions, focus) {
  if (!focus || !Array.isArray(focus.candidates) || focus.candidates.length === 0) {
    return predictions;
  }

  const legal = predictions.filter((prediction) => focus.candidates.includes(prediction.value));
  return legal.length > 0 ? legal : predictions;
}

async function buildTeacherContexts(initialBoard, result, onProgress = null) {
  let board = cloneSudokuBoard(initialBoard);
  let focus = null;
  const focusFrames = new Map();
  const historyOps = [];
  const opContexts = [];
  const opExpected = [];
  const valueTasks = [];
  const total = result.trace.length;

  for (let traceIndex = 0; traceIndex < total; traceIndex += 1) {
    const event = result.trace[traceIndex];
    const expectedOp = eventToHardOp(event);
    const scopedFocus =
      typeof event.depth === "number" ? (focusFrames.get(event.depth) ?? null) : null;

    opContexts.push(
      buildHardOpContext({
        board,
        focus,
        historyOps,
        historyWindow: HARD_OP_HISTORY_WINDOW,
        strategy: result.strategy,
      })
    );
    opExpected.push(expectedOp);

    if (event.type === "place" && scopedFocus) {
      valueTasks.push({
        traceIndex,
        expectedValue: event.value,
        focus: scopedFocus,
        context: buildHardOpContext({
          board,
          focus: scopedFocus,
          historyOps,
          historyWindow: HARD_OP_HISTORY_WINDOW,
          strategy: result.strategy,
        }),
      });
    }

    focus = applyHardTraceEvent(board, event, focus);
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
    historyOps.push(expectedOp);

    const completed = traceIndex + 1;
    if (
      typeof onProgress === "function" &&
      (completed % BUILD_PROGRESS_EVERY === 0 || completed === total)
    ) {
      onProgress({
        completed,
        total,
        valueTaskCount: valueTasks.length,
      });
      await yieldToBrowser();
    }
  }

  return {
    opContexts,
    opExpected,
    valueTasks,
  };
}

async function scoreTeacherTrace(initialBoard, result) {
  postProgress({
    phase: "build-contexts",
    completed: 0,
    total: result.trace.length,
    message: `Building reference contexts 0 / ${result.trace.length}.`,
  });
  const { opContexts, valueTasks } = await buildTeacherContexts(initialBoard, result, ({
    completed,
    total,
  }) => {
    postProgress({
      phase: "build-contexts",
      completed,
      total,
      message: `Building reference contexts ${completed} / ${total}.`,
    });
  });

  postProgress({
    phase: "score-ops",
    completed: 0,
    total: opContexts.length,
    message: `Scoring op tokens 0 / ${opContexts.length}.`,
  });
  const opPredictions = await predictHardSudokuNextOps(opContexts, 3, OP_BATCH_SIZE, ({
    completed,
    total,
  }) => {
    postProgress({
      phase: "score-ops",
      completed,
      total,
      message: `Scoring op tokens ${completed} / ${total}.`,
    });
  });

  const valueContexts = valueTasks.map((task) => task.context);
  postProgress({
    phase: "score-values",
    completed: 0,
    total: valueContexts.length,
    message: `Scoring PLACE values 0 / ${valueContexts.length}.`,
  });
  const valuePredictions = await predictHardSudokuPlaceValues(
    valueContexts,
    9,
    VALUE_BATCH_SIZE,
    ({ completed, total }) => {
      postProgress({
        phase: "score-values",
        completed,
        total,
        message: `Scoring PLACE values ${completed} / ${total}.`,
      });
    }
  );

  const valueProbesByIndex = new Map();
  valueTasks.forEach((task, index) => {
    const filtered = filterLegalValuePredictions(valuePredictions[index] ?? [], task.focus).slice(0, 3);
    const top = filtered[0] ?? null;
    valueProbesByIndex.set(task.traceIndex, {
      expectedValue: task.expectedValue,
      predictions: filtered,
      correct: top?.value === task.expectedValue,
    });
  });

  return {
    opPredictions,
    valueProbesByIndex,
  };
}

function postReplayBatch({
  board,
  lines,
  tokenCount,
  predictionCount,
  averageConfidence,
  accuracy,
  valuePredictionCount,
  valueAverageConfidence,
  valueAccuracy,
  tokensPerSecond,
  elapsedMs,
  traceLength,
}) {
  self.postMessage({
    type: "event-batch",
    snapshot: cloneSudokuBoard(board),
    lines,
    tokenCount,
    predictionCount,
    averageConfidence,
    accuracy,
    valuePredictionCount,
    valueAverageConfidence,
    valueAccuracy,
    tokensPerSecond,
    elapsedMs,
    traceLength,
  });
}

async function runModelTrace(puzzle) {
  const startedAt = performance.now();
  const initialBoard = parseSudoku(puzzle);
  const result = solveSudokuWithTrace(initialBoard, { strategy: "mrv" });
  if (!result.solved) {
    throw new Error("Deterministic reference trace failed to solve the puzzle.");
  }

  self.postMessage({
    type: "start",
    initialBoard,
    strategy: result.strategy,
    traceLength: result.trace.length,
  });

  postProgress({
    phase: "warm-models",
    completed: 0,
    total: 2,
    message: "Loading local op model.",
  });
  await warmHardSudokuModel();
  postProgress({
    phase: "warm-models",
    completed: 1,
    total: 2,
    message: "Loading local PLACE-value model.",
  });
  await warmHardSudokuValueModel();
  postProgress({
    phase: "warm-models",
    completed: 2,
    total: 2,
    message: "Local transformer models are warm.",
  });
  const scored = await scoreTeacherTrace(initialBoard, result);
  postProgress({
    phase: "replay",
    completed: 0,
    total: result.trace.length,
    message: `Replaying scored trace 0 / ${result.trace.length}.`,
  });

  let board = cloneSudokuBoard(initialBoard);
  let focus = null;
  let totalTokenCount = 0;
  let opPredictionCount = 0;
  let opConfidenceSum = 0;
  let opCorrectCount = 0;
  let valuePredictionCount = 0;
  let valueConfidenceSum = 0;
  let valueCorrectCount = 0;
  let pendingLines = [];

  for (let traceIndex = 0; traceIndex < result.trace.length; traceIndex += 1) {
    const event = result.trace[traceIndex];
    const expectedOp = eventToHardOp(event);
    const opPredictions = scored.opPredictions[traceIndex] ?? [];
    const topOp = opPredictions[0] ?? null;
    const valueProbe = scored.valueProbesByIndex.get(traceIndex) ?? null;

    opPredictionCount += 1;
    totalTokenCount += 1;
    if (topOp) {
      opConfidenceSum += topOp.score;
      if (topOp.op === expectedOp) {
        opCorrectCount += 1;
      }
    }

    if (valueProbe) {
      valuePredictionCount += 1;
      totalTokenCount += 1;
      const topValue = valueProbe.predictions[0] ?? null;
      if (topValue) {
        valueConfidenceSum += topValue.score;
        if (topValue.value === valueProbe.expectedValue) {
          valueCorrectCount += 1;
        }
      }
    }

    focus = applyHardTraceEvent(board, event, focus);
    pendingLines.push(
      formatPredictionLine(traceIndex + 1, expectedOp, opPredictions, valueProbe)
    );

    const shouldEmit =
      pendingLines.length >= EMIT_EVERY || traceIndex === result.trace.length - 1;
    if (shouldEmit) {
      const elapsedMs = performance.now() - startedAt;
      postProgress({
        phase: "replay",
        completed: traceIndex + 1,
        total: result.trace.length,
        message: `Replaying scored trace ${traceIndex + 1} / ${result.trace.length}.`,
      });
      postReplayBatch({
        board,
        lines: pendingLines,
        tokenCount: totalTokenCount,
        predictionCount: opPredictionCount,
        averageConfidence: opPredictionCount > 0 ? opConfidenceSum / opPredictionCount : null,
        accuracy: opPredictionCount > 0 ? opCorrectCount / opPredictionCount : 0,
        valuePredictionCount,
        valueAverageConfidence:
          valuePredictionCount > 0 ? valueConfidenceSum / valuePredictionCount : null,
        valueAccuracy: valuePredictionCount > 0 ? valueCorrectCount / valuePredictionCount : null,
        tokensPerSecond: summarizeRate(totalTokenCount, elapsedMs),
        elapsedMs,
        traceLength: result.trace.length,
      });
      pendingLines = [];
    }
  }

  const elapsedMs = performance.now() - startedAt;
  self.postMessage({
    type: "done",
    solved: true,
    solution: board,
    traceLength: result.trace.length,
    elapsedMs: Math.round(elapsedMs),
    tokenCount: totalTokenCount,
    predictionCount: opPredictionCount,
    averageConfidence: opPredictionCount > 0 ? opConfidenceSum / opPredictionCount : null,
    accuracy: opPredictionCount > 0 ? opCorrectCount / opPredictionCount : 0,
    valuePredictionCount,
    valueAverageConfidence:
      valuePredictionCount > 0 ? valueConfidenceSum / valuePredictionCount : null,
    valueAccuracy: valuePredictionCount > 0 ? valueCorrectCount / valuePredictionCount : null,
    tokensPerSecond: summarizeRate(totalTokenCount, elapsedMs),
  });
}

self.onmessage = (message) => {
  const { data } = message;
  if (!data || data.type !== "run") {
    return;
  }

  void runModelTrace(data.puzzle).catch((error) => {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  });
};

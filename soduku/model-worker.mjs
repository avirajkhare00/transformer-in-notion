import { cloneSudokuBoard, parseSudoku, solveSudokuWithTrace } from "../logic/sudoku.mjs";
import {
  HARD_OP_HISTORY_WINDOW,
  applyHardTraceEvent,
  buildHardOpContext,
  eventToHardOp,
} from "./hard-op-context.mjs";
import { predictHardSudokuNextOp, warmHardSudokuModel } from "./model.mjs";
import {
  predictHardSudokuPlaceValue,
  warmHardSudokuValueModel,
} from "./value-model.mjs";

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

async function runModelTrace(puzzle) {
  const startedAt = performance.now();
  await Promise.all([warmHardSudokuModel(), warmHardSudokuValueModel()]);

  const initialBoard = parseSudoku(puzzle);
  const result = solveSudokuWithTrace(initialBoard, { strategy: "mrv" });
  if (!result.solved) {
    throw new Error("Deterministic teacher trace failed to solve the puzzle.");
  }

  let board = cloneSudokuBoard(initialBoard);
  let focus = null;
  const focusFrames = new Map();
  const historyOps = [];
  let totalTokenCount = 0;
  let opPredictionCount = 0;
  let opConfidenceSum = 0;
  let opCorrectCount = 0;
  let valuePredictionCount = 0;
  let valueConfidenceSum = 0;
  let valueCorrectCount = 0;

  self.postMessage({
    type: "start",
    initialBoard,
    strategy: result.strategy,
    traceLength: result.trace.length,
  });

  for (const event of result.trace) {
    const expectedOp = eventToHardOp(event);
    const scopedFocus =
      typeof event.depth === "number" ? (focusFrames.get(event.depth) ?? null) : null;
    const context = buildHardOpContext({
      board,
      focus,
      historyOps,
      historyWindow: HARD_OP_HISTORY_WINDOW,
      strategy: result.strategy,
    });

    const opPredictions = await predictHardSudokuNextOp(context, 3);
    const topOp = opPredictions[0] ?? null;
    opPredictionCount += 1;
    totalTokenCount += 1;
    if (topOp) {
      opConfidenceSum += topOp.score;
      if (topOp.op === expectedOp) {
        opCorrectCount += 1;
      }
    }

    let valueProbe = null;
    if (event.type === "place" && scopedFocus) {
      const valueContext = buildHardOpContext({
        board,
        focus: scopedFocus,
        historyOps,
        historyWindow: HARD_OP_HISTORY_WINDOW,
        strategy: result.strategy,
      });
      const rawValuePredictions = await predictHardSudokuPlaceValue(valueContext, 9);
      const valuePredictions = filterLegalValuePredictions(rawValuePredictions, scopedFocus).slice(
        0,
        3
      );
      const topValue = valuePredictions[0] ?? null;
      valuePredictionCount += 1;
      totalTokenCount += 1;
      if (topValue) {
        valueConfidenceSum += topValue.score;
        if (topValue.value === event.value) {
          valueCorrectCount += 1;
        }
      }

      valueProbe = {
        expectedValue: event.value,
        predictions: valuePredictions,
        correct: topValue?.value === event.value,
      };
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

    const elapsedMs = performance.now() - startedAt;
    self.postMessage({
      type: "event",
      snapshot: cloneSudokuBoard(board),
      expectedOp,
      opPredictions,
      valueProbe,
      line: formatPredictionLine(opPredictionCount, expectedOp, opPredictions, valueProbe),
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

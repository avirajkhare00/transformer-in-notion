import { cloneSudokuBoard, parseSudoku, solveSudokuWithTrace } from "../logic/sudoku.mjs";
import {
  HARD_OP_HISTORY_WINDOW,
  applyHardTraceEvent,
  buildHardOpContext,
  eventToHardOp,
} from "./hard-op-context.mjs";
import { predictHardSudokuNextOp, warmHardSudokuModel } from "./model.mjs";

function formatPredictionLine(step, expectedOp, predictions) {
  const top = predictions[0];
  const correct = top?.op === expectedOp;
  const head = top ? `${top.op} ${(top.score * 100).toFixed(1)}%` : "no prediction";
  const tail = predictions
    .slice(1)
    .map((prediction) => `${prediction.op} ${(prediction.score * 100).toFixed(1)}%`)
    .join(" · ");

  return [
    `#${String(step).padStart(3, "0")}`,
    `[model ${head}]`,
    `expected ${expectedOp}`,
    correct ? "match" : "miss",
    tail ? `alts ${tail}` : "",
  ]
    .filter(Boolean)
    .join("  ");
}

async function runModelTrace(puzzle) {
  const startedAt = performance.now();
  await warmHardSudokuModel();

  const initialBoard = parseSudoku(puzzle);
  const result = solveSudokuWithTrace(initialBoard, { strategy: "mrv" });
  if (!result.solved) {
    throw new Error("Deterministic teacher trace failed to solve the puzzle.");
  }

  let board = cloneSudokuBoard(initialBoard);
  let focus = null;
  const historyOps = [];
  let predictionCount = 0;
  let confidenceSum = 0;
  let correctCount = 0;

  self.postMessage({
    type: "start",
    initialBoard,
    strategy: result.strategy,
    traceLength: result.trace.length,
  });

  for (const event of result.trace) {
    const expectedOp = eventToHardOp(event);
    const context = buildHardOpContext({
      board,
      focus,
      historyOps,
      historyWindow: HARD_OP_HISTORY_WINDOW,
      strategy: result.strategy,
    });
    const predictions = await predictHardSudokuNextOp(context, 3);
    const top = predictions[0] ?? null;

    predictionCount += 1;
    if (top) {
      confidenceSum += top.score;
      if (top.op === expectedOp) {
        correctCount += 1;
      }
    }

    focus = applyHardTraceEvent(board, event, focus);
    historyOps.push(expectedOp);

    const elapsedMs = performance.now() - startedAt;
    const tokensPerSecond = elapsedMs > 0 ? predictionCount / (elapsedMs / 1000) : 0;

    self.postMessage({
      type: "event",
      snapshot: cloneSudokuBoard(board),
      event,
      expectedOp,
      predictions,
      line: formatPredictionLine(predictionCount, expectedOp, predictions),
      predictionCount,
      averageConfidence: predictionCount > 0 ? confidenceSum / predictionCount : null,
      accuracy: predictionCount > 0 ? correctCount / predictionCount : 0,
      tokensPerSecond,
      elapsedMs,
    });
  }

  const elapsedMs = performance.now() - startedAt;
  const tokensPerSecond = elapsedMs > 0 ? predictionCount / (elapsedMs / 1000) : 0;

  self.postMessage({
    type: "done",
    solved: true,
    solution: board,
    traceLength: result.trace.length,
    elapsedMs: Math.round(elapsedMs),
    predictionCount,
    averageConfidence: predictionCount > 0 ? confidenceSum / predictionCount : null,
    accuracy: predictionCount > 0 ? correctCount / predictionCount : 0,
    tokensPerSecond,
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

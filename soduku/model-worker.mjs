import {
  parseSudoku,
  solveSudokuWithGuidance,
  solveSudokuWithTrace,
} from "../logic/sudoku.mjs";
import { HARD_OP_HISTORY_WINDOW, buildHardOpContext } from "./hard-op-context.mjs";
import {
  predictHardSudokuPlaceValue,
  warmHardSudokuValueModel,
} from "./value-model.mjs";
import { chooseValueGuidanceDecision } from "./value-guidance.mjs";

const EMIT_EVERY = 16;

function summarizeRate(totalTokens, elapsedMs) {
  return elapsedMs > 0 ? totalTokens / (elapsedMs / 1000) : 0;
}

async function yieldToBrowser() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function postProgress({
  phase,
  completed = null,
  total = null,
  message,
  modelId = null,
  modelLabel = null,
  modelArtifactId = null,
}) {
  self.postMessage({
    type: "progress",
    phase,
    completed,
    total,
    message,
    modelId,
    modelLabel,
    modelArtifactId,
  });
}

function postGuidedMetrics({
  events = [],
  tokenCount,
  branchCount,
  valueAverageConfidence,
  valueAverageMargin,
  tokensPerSecond,
  elapsedMs,
  guidedStats = null,
  referenceStats = null,
  traceLength = 0,
  referenceTraceLength = 0,
  modelId = null,
  modelLabel = null,
  modelArtifactId = null,
}) {
  self.postMessage({
    type: "event-batch",
    events,
    tokenCount,
    branchCount,
    valuePredictionCount: branchCount,
    valueAverageConfidence,
    valueAverageMargin,
    tokensPerSecond,
    elapsedMs,
    guidedStats,
    referenceStats,
    traceLength,
    referenceTraceLength,
    modelId,
    modelLabel,
    modelArtifactId,
  });
}

async function runGuidedSolve(puzzle, modelSelectionId = "auto") {
  const startedAt = performance.now();
  const initialBoard = parseSudoku(puzzle);
  const reference = solveSudokuWithTrace(initialBoard, { strategy: "mrv" });
  if (!reference.solved) {
    throw new Error("Exact reference solver failed to solve the puzzle.");
  }

  self.postMessage({
    type: "start",
    initialBoard,
    traceLength: reference.trace.length,
    referenceTraceLength: reference.trace.length,
    referenceStats: reference.stats,
    selectedModelId: modelSelectionId,
  });

  postProgress({
    phase: "warm-models",
    completed: 0,
    total: 1,
    message: "Loading local PLACE-value model.",
  });
  const loadedModel = await warmHardSudokuValueModel(modelSelectionId);
  postProgress({
    phase: "warm-models",
    completed: 1,
    total: 1,
    message: `Loaded ${loadedModel.modelLabel} from ${loadedModel.modelArtifactId}. Starting guided solve.`,
    modelId: loadedModel.modelId,
    modelLabel: loadedModel.modelLabel,
    modelArtifactId: loadedModel.modelArtifactId,
  });

  let tokenCount = 0;
  let branchCount = 0;
  let valueConfidenceSum = 0;
  let valueMarginSum = 0;
  let pendingEvents = [];

  postProgress({
    phase: "guided-solve",
    completed: 0,
    total: reference.stats.focuses,
    message: `Evaluating ambiguous branches 0 / ~${reference.stats.focuses}.`,
  });

  const guided = await solveSudokuWithGuidance(initialBoard, {
    strategy: "mrv",
    onEvent: async (event) => {
      pendingEvents.push(event);
      if (pendingEvents.length >= EMIT_EVERY) {
        const elapsedMs = performance.now() - startedAt;
        postGuidedMetrics({
          events: pendingEvents,
          tokenCount,
          branchCount,
          valueAverageConfidence: branchCount > 0 ? valueConfidenceSum / branchCount : null,
          valueAverageMargin: branchCount > 0 ? valueMarginSum / branchCount : null,
          tokensPerSecond: summarizeRate(tokenCount, elapsedMs),
          elapsedMs,
          referenceStats: reference.stats,
          referenceTraceLength: reference.trace.length,
          modelId: loadedModel.modelId,
          modelLabel: loadedModel.modelLabel,
          modelArtifactId: loadedModel.modelArtifactId,
        });
        pendingEvents = [];
        await yieldToBrowser();
      }
    },
    rankCandidates: async ({ board, focus, historyOps }) => {
      const context = buildHardOpContext({
        board,
        focus,
        historyOps,
        historyWindow: HARD_OP_HISTORY_WINDOW,
      });
      const predictions = await predictHardSudokuPlaceValue(context, 9, modelSelectionId);
      const decision = chooseValueGuidanceDecision({
        predictions,
        candidates: focus.candidates,
      });

      branchCount += 1;
      tokenCount += 1;
      valueConfidenceSum += decision.confidence;
      valueMarginSum += decision.margin;

      if (branchCount % EMIT_EVERY === 0) {
        const elapsedMs = performance.now() - startedAt;
        postProgress({
          phase: "guided-solve",
          completed: branchCount,
          total: reference.stats.focuses,
          message: `Evaluating ambiguous branches ${branchCount} / ~${reference.stats.focuses}.`,
        });
        postGuidedMetrics({
          events: pendingEvents,
          tokenCount,
          branchCount,
          valueAverageConfidence: branchCount > 0 ? valueConfidenceSum / branchCount : null,
          valueAverageMargin: branchCount > 0 ? valueMarginSum / branchCount : null,
          tokensPerSecond: summarizeRate(tokenCount, elapsedMs),
          elapsedMs,
          referenceStats: reference.stats,
          referenceTraceLength: reference.trace.length,
          modelId: loadedModel.modelId,
          modelLabel: loadedModel.modelLabel,
          modelArtifactId: loadedModel.modelArtifactId,
        });
        pendingEvents = [];
        await yieldToBrowser();
      }

      return decision;
    },
  });

  if (!guided.solved) {
    throw new Error("Guided solve failed to complete.");
  }

  const elapsedMs = performance.now() - startedAt;
  postProgress({
    phase: "guided-solve",
    completed: branchCount,
    total: reference.stats.focuses,
    message: `Guided solve finished after ${branchCount} branch evaluations.`,
  });
  postGuidedMetrics({
    events: pendingEvents,
    tokenCount,
    branchCount,
    valueAverageConfidence: branchCount > 0 ? valueConfidenceSum / branchCount : null,
    valueAverageMargin: branchCount > 0 ? valueMarginSum / branchCount : null,
    tokensPerSecond: summarizeRate(tokenCount, elapsedMs),
    elapsedMs,
    guidedStats: guided.stats,
    referenceStats: reference.stats,
    traceLength: guided.trace.length,
    referenceTraceLength: reference.trace.length,
    modelId: loadedModel.modelId,
    modelLabel: loadedModel.modelLabel,
    modelArtifactId: loadedModel.modelArtifactId,
  });

  self.postMessage({
    type: "done",
    solved: true,
    solution: guided.solution,
    tokenCount,
    branchCount,
    valuePredictionCount: branchCount,
    valueAverageConfidence: branchCount > 0 ? valueConfidenceSum / branchCount : null,
    valueAverageMargin: branchCount > 0 ? valueMarginSum / branchCount : null,
    tokensPerSecond: summarizeRate(tokenCount, elapsedMs),
    elapsedMs: Math.round(elapsedMs),
    traceLength: guided.trace.length,
    guidedStats: guided.stats,
    referenceStats: reference.stats,
    referenceTraceLength: reference.trace.length,
    modelId: loadedModel.modelId,
    modelLabel: loadedModel.modelLabel,
    modelArtifactId: loadedModel.modelArtifactId,
  });
}

self.onmessage = (message) => {
  const { data } = message;
  if (!data || data.type !== "run") {
    return;
  }

  void runGuidedSolve(data.puzzle, data.modelId).catch((error) => {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  });
};

import {
  buildProgram4x4,
  formatPsvmEvent,
  parsePuzzle4x4,
  solveWithPsvm4x4,
} from "./psvm4x4.mjs";

self.onmessage = (message) => {
  const { data } = message;
  if (!data || data.type !== "solve") {
    return;
  }

  const startedAt = performance.now();

  try {
    const initialBoard = parsePuzzle4x4(data.puzzle);
    self.postMessage({
      type: "start",
      initialBoard,
      program: buildProgram4x4(data.puzzle),
    });

    const result = solveWithPsvm4x4(data.puzzle, {
      onEvent(event, snapshot) {
        self.postMessage({
          type: "event",
          event,
          snapshot,
          line: formatPsvmEvent(event),
        });
      },
    });

    self.postMessage({
      type: "done",
      solved: result.solved,
      solution: result.solution,
      stats: result.stats,
      traceLength: result.trace.length,
      elapsedMs: Math.round(performance.now() - startedAt),
      givenMask: result.givenMask,
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

import {
  buildInvoiceProgram,
  buildInvoiceOpContext,
  createInvoiceExecutionState,
  createEmptyInvoiceSnapshot,
  executeInvoiceOp,
  formatInvoiceEvent,
  getInvoiceLegalOps,
  parseInvoice,
  runInvoicePsvm,
} from "./psvm.mjs";
import { predictInvoiceNextOp, warmInvoiceModel } from "./model.mjs";

function formatPredictedLine(line, prediction) {
  if (!prediction) {
    return line;
  }

  return `[student ${prediction.op} ${(prediction.score * 100).toFixed(1)}%] ${line}`;
}

async function resolveEngine(requestedEngine) {
  if (requestedEngine === "teacher") {
    return { mode: "teacher", error: null };
  }

  try {
    await warmInvoiceModel();
    return { mode: "student", error: null };
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function streamTeacherTrace(result) {
  for (const event of result.trace) {
    self.postMessage({
      type: "event",
      event,
      snapshot: event.snapshot,
      prediction: null,
      line: formatInvoiceEvent(event, result.invoice.currency),
      predictionCount: 0,
      averageConfidence: null,
    });
  }

  return { predictionCount: 0, averageConfidence: null };
}

async function streamStudentTrace(invoice) {
  let state = createInvoiceExecutionState();
  let previousSnapshot = createEmptyInvoiceSnapshot();
  const historyOps = [];
  let predictionCount = 0;
  let confidenceSum = 0;

  while (!state.halted) {
    const legalOps = getInvoiceLegalOps(invoice, state);
    const context = buildInvoiceOpContext(invoice, previousSnapshot, historyOps);
    const predictions = await predictInvoiceNextOp(context);
    const prediction = predictions[0] ?? null;
    if (!prediction) {
      throw new Error("Invoice student returned no prediction.");
    }

    predictionCount += 1;
    confidenceSum += prediction.score;

    if (!legalOps.includes(prediction.op)) {
      throw new Error(
        `Illegal student op ${prediction.op}. Expected ${legalOps.join(", ")}.`,
      );
    }

    const step = executeInvoiceOp(invoice, state, prediction.op);
    const event = step.event;

    self.postMessage({
      type: "event",
      event,
      snapshot: event.snapshot,
      prediction,
      line: formatPredictedLine(formatInvoiceEvent(event, invoice.currency), prediction),
      predictionCount,
      averageConfidence: confidenceSum / predictionCount,
    });

    state = step.state;
    previousSnapshot = event.snapshot;
    historyOps.push(event.op);
  }

  return {
    result: {
      subtotalCents: state.subtotalCents,
      taxCents: state.taxCents,
      totalCents: state.totalCents,
    },
    traceLength: historyOps.length,
    predictionCount,
    averageConfidence: predictionCount > 0 ? confidenceSum / predictionCount : null,
  };
}

async function handleRun(data) {
  const startedAt = performance.now();

  try {
    const invoice = parseInvoice(data.source);
    const requestedEngine = data.engine ?? "student";
    const engine = await resolveEngine(requestedEngine);
    self.postMessage({
      type: "start",
      invoice,
      program: buildInvoiceProgram(data.source),
      engine: engine.mode,
    });

    const execution =
      engine.mode === "teacher"
        ? await (async () => {
            const result = runInvoicePsvm(data.source);
            const streamed = await streamTeacherTrace(result);
            return {
              result: result.result,
              traceLength: result.trace.length,
              predictionCount: streamed.predictionCount,
              averageConfidence: streamed.averageConfidence,
            };
          })()
        : await streamStudentTrace(invoice);

    self.postMessage({
      type: "done",
      invoice,
      result: execution.result,
      traceLength: execution.traceLength,
      elapsedMs: Math.round(performance.now() - startedAt),
      engine: engine.mode,
      predictionCount: execution.predictionCount,
      averageConfidence: execution.averageConfidence,
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

self.onmessage = (message) => {
  const { data } = message;
  if (!data || data.type !== "run") {
    return;
  }

  void handleRun(data);
};

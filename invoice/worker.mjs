import {
  buildInvoiceOpContext,
  createEmptyInvoiceSnapshot,
  formatInvoiceEvent,
  parseInvoice,
  runInvoicePsvm,
} from "./psvm.mjs";
import { predictInvoiceNextOp, warmInvoiceModel } from "./model.mjs";

function formatPredictedLine(line, prediction, matched) {
  if (!prediction) {
    return line;
  }

  const status = matched ? "match" : "miss";
  return `[student ${status} ${prediction.op} ${(prediction.score * 100).toFixed(1)}%] ${line}`;
}

async function resolveEngine(requestedEngine) {
  if (requestedEngine === "teacher") {
    return { mode: "teacher", error: null };
  }

  try {
    await warmInvoiceModel();
    return { mode: "student+teacher", error: null };
  } catch (error) {
    return {
      mode: "teacher",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function streamTrace(result, invoice, engineMode) {
  let previousSnapshot = createEmptyInvoiceSnapshot();
  const historyOps = [];
  let modelMatches = 0;
  let modelPredictions = 0;

  for (const event of result.trace) {
    let prediction = null;
    let matched = null;

    if (engineMode === "student+teacher") {
      const context = buildInvoiceOpContext(invoice, previousSnapshot, historyOps);
      const predictions = await predictInvoiceNextOp(context);
      prediction = predictions[0] ?? null;
      matched = prediction ? prediction.op === event.op : null;
      modelPredictions += 1;
      if (matched) {
        modelMatches += 1;
      }
    }

    self.postMessage({
      type: "event",
      event,
      snapshot: event.snapshot,
      prediction,
      line: formatPredictedLine(
        formatInvoiceEvent(event, invoice.currency),
        prediction,
        matched,
      ),
      modelMatches,
      modelPredictions,
    });

    previousSnapshot = event.snapshot;
    historyOps.push(event.op);
  }

  return { modelMatches, modelPredictions };
}

async function handleRun(data) {
  const startedAt = performance.now();

  try {
    const invoice = parseInvoice(data.source);
    const engine = await resolveEngine(data.engine ?? "student");
    const result = runInvoicePsvm(data.source);

    self.postMessage({
      type: "start",
      invoice,
      program: result.program,
      engine: engine.mode,
      modelError: engine.error,
    });

    const { modelMatches, modelPredictions } = await streamTrace(
      result,
      invoice,
      engine.mode,
    );

    self.postMessage({
      type: "done",
      invoice,
      result: result.result,
      traceLength: result.trace.length,
      elapsedMs: Math.round(performance.now() - startedAt),
      engine: engine.mode,
      modelMatches,
      modelPredictions,
      modelAccuracy:
        modelPredictions > 0 ? modelMatches / modelPredictions : null,
      modelError: engine.error,
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

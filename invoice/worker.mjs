import {
  buildInvoiceProgram,
  formatInvoiceEvent,
  parseInvoice,
  runInvoicePsvm,
} from "./psvm.mjs";

self.onmessage = (message) => {
  const { data } = message;
  if (!data || data.type !== "run") {
    return;
  }

  const startedAt = performance.now();

  try {
    const invoice = parseInvoice(data.source);
    self.postMessage({
      type: "start",
      invoice,
      program: buildInvoiceProgram(data.source),
    });

    const result = runInvoicePsvm(data.source, {
      onEvent(event, snapshot) {
        self.postMessage({
          type: "event",
          event,
          snapshot,
          line: formatInvoiceEvent(event, invoice.currency),
        });
      },
    });

    self.postMessage({
      type: "done",
      invoice,
      result: result.result,
      traceLength: result.trace.length,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

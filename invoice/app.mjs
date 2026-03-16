import {
  DEFAULT_INVOICE,
  INVOICE_PSVM_OPS,
  buildInvoiceProgram,
  formatCents,
  parseInvoice,
} from "./psvm.mjs";

const sourceInput = document.querySelector("#source-input");
const sampleButton = document.querySelector("#sample-button");
const runButton = document.querySelector("#run-button");
const statusEl = document.querySelector("#status");
const programEl = document.querySelector("#program");
const traceEl = document.querySelector("#trace");
const opsEl = document.querySelector("#ops");
const summaryEl = document.querySelector("#summary");
const itemsEl = document.querySelector("#items");

let worker = null;
let traceLines = [];
let activeCurrency = "USD";

function setStatus(message, tone = "neutral") {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function renderProgram(lines) {
  programEl.textContent = lines.join("\n");
}

function renderTrace() {
  traceEl.textContent = traceLines.join("\n");
  traceEl.scrollTop = traceEl.scrollHeight;
}

function renderOps() {
  opsEl.innerHTML = INVOICE_PSVM_OPS.map((op) => `<li>${op}</li>`).join("");
}

function renderItems(invoice) {
  itemsEl.innerHTML = invoice.items
    .map(
      (item, index) => `
        <tr>
          <td>#${index + 1}</td>
          <td>${item.label}</td>
          <td>${item.quantity}</td>
          <td>${formatCents(item.unitCents, invoice.currency)}</td>
        </tr>`,
    )
    .join("");
}

function renderSummary(result = {}, extras = {}) {
  const cards = [
    ["subtotal", formatCents(result.subtotalCents ?? 0, activeCurrency)],
    ["tax", formatCents(result.taxCents ?? 0, activeCurrency)],
    ["total", formatCents(result.totalCents ?? 0, activeCurrency)],
  ];

  if (typeof extras.traceLength === "number") {
    cards.push(["trace events", String(extras.traceLength)]);
  }
  if (typeof extras.elapsedMs === "number") {
    cards.push(["worker ms", String(extras.elapsedMs)]);
  }
  if (typeof extras.averageConfidence === "number") {
    cards.push(["avg conf", `${(extras.averageConfidence * 100).toFixed(1)}%`]);
  }
  if (extras.engine) {
    cards.push(["engine", extras.engine]);
  }

  summaryEl.innerHTML = cards
    .map(
      ([label, value]) =>
        `<div class="stat"><dt>${label}</dt><dd>${value}</dd></div>`,
    )
    .join("");
}

function stopWorker() {
  if (!worker) {
    return;
  }

  worker.terminate();
  worker = null;
}

function loadSample() {
  sourceInput.value = DEFAULT_INVOICE;
  const invoice = parseInvoice(DEFAULT_INVOICE);
  activeCurrency = invoice.currency;
  renderProgram(buildInvoiceProgram(DEFAULT_INVOICE));
  renderItems(invoice);
  renderSummary();
  traceLines = [];
  renderTrace();
  setStatus("Sample invoice loaded. Run to stream the student-driven PSVM trace.");
}

function startRun() {
  const source = sourceInput.value.trim();

  try {
    const invoice = parseInvoice(source);
    activeCurrency = invoice.currency;
    renderProgram(buildInvoiceProgram(source));
    renderItems(invoice);
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : String(error),
      "error",
    );
    return;
  }

  stopWorker();
  traceLines = [];
  renderTrace();
  renderSummary({}, { engine: "student" });
  setStatus("Worker running student-driven invoice PSVM...", "busy");

  worker = new Worker(new URL("./worker.mjs", import.meta.url), {
    type: "module",
  });

  worker.onmessage = ({ data }) => {
    if (data.type === "start") {
      activeCurrency = data.invoice.currency;
      renderItems(data.invoice);
      renderProgram(data.program);
      if (data.engine === "student") {
        setStatus(
          "Worker running a strict student loop: predict next op, verify legality, execute.",
          "busy",
        );
      }
      return;
    }

    if (data.type === "event") {
      traceLines.push(data.line);
      renderTrace();
      renderSummary(
        {
          subtotalCents: data.snapshot.subtotalCents,
          taxCents: data.snapshot.taxCents,
          totalCents: data.snapshot.totalCents,
        },
        {},
      );
      return;
    }

    if (data.type === "done") {
      activeCurrency = data.invoice.currency;
      renderSummary(data.result, {
        traceLength: data.traceLength,
        elapsedMs: data.elapsedMs,
        averageConfidence: data.averageConfidence,
        engine: data.engine,
      });
      setStatus(
        data.engine === "student"
          ? `Student-driven invoice run finished in ${data.elapsedMs} ms across ${data.traceLength} trace events. Average confidence: ${(data.averageConfidence * 100).toFixed(1)}%.`
          : `Invoice total ready in ${data.elapsedMs} ms across ${data.traceLength} trace events.`,
        "success",
      );
      stopWorker();
      return;
    }

    if (data.type === "error") {
      setStatus(data.message, "error");
      stopWorker();
    }
  };

  worker.postMessage({
    type: "run",
    source,
    engine: "student",
  });
}

sampleButton.addEventListener("click", loadSample);
runButton.addEventListener("click", startRun);

renderOps();
loadSample();

import { TALLY_DEMO_PRESETS } from "./demo-samples.mjs";

const state = {
  worker: null,
  isRunning: false,
  lastResult: null,
};

const refs = {
  preset: document.querySelector("#tally-preset"),
  presetDescription: document.querySelector("#tally-preset-description"),
  format: document.querySelector("#tally-format"),
  engine: document.querySelector("#tally-engine"),
  input: document.querySelector("#tally-input"),
  file: document.querySelector("#tally-file"),
  run: document.querySelector("#tally-run"),
  clear: document.querySelector("#tally-clear"),
  status: document.querySelector("#tally-status"),
  stats: document.querySelector("#tally-stats"),
  selectedFields: document.querySelector("#tally-selected-fields"),
  record: document.querySelector("#tally-record"),
};

function getWorker() {
  if (!state.worker) {
    state.worker = new Worker(new URL("./worker.mjs", import.meta.url), {
      type: "module",
    });
    state.worker.addEventListener("message", handleWorkerMessage);
  }
  return state.worker;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function createStatCard(label, value) {
  return `
    <div class="stat-card">
      <span class="stat-label">${escapeHtml(label)}</span>
      <span class="stat-value">${escapeHtml(value)}</span>
    </div>
  `;
}

function humanizeFieldId(fieldId) {
  return fieldId
    .replace(/\[\]/g, "")
    .replaceAll(".", " / ")
    .replaceAll("_", " ");
}

function handleWorkerMessage(message) {
  const { data } = message;
  if (!data) {
    return;
  }

  state.isRunning = false;
  syncButtons();

  if (data.type === "error") {
    state.lastResult = null;
    renderError(data.message);
    return;
  }

  if (data.type !== "done") {
    return;
  }

  state.lastResult = data;
  renderResult(data);
}

function syncButtons() {
  const disabled = state.isRunning;
  refs.run.disabled = disabled;
  refs.clear.disabled = disabled;
  refs.preset.disabled = disabled;
  refs.format.disabled = disabled;
  refs.engine.disabled = disabled;
  refs.file.disabled = disabled;
}

function renderRunning() {
  refs.status.innerHTML = `
    <div>
      <strong>Running Tally demo...</strong><br>
      Reading OCR text and building a voucher-shaped record.
    </div>
  `;
  refs.stats.innerHTML = createStatCard("Status", "Running");
  refs.selectedFields.innerHTML = "";
  refs.record.textContent = "";
}

function renderError(message) {
  refs.status.innerHTML = `
    <div>
      <strong>Run failed.</strong><br>
      ${escapeHtml(message)}
    </div>
  `;
  refs.stats.innerHTML = createStatCard("Status", "Error");
  refs.selectedFields.innerHTML = `<li>${escapeHtml(message)}</li>`;
  refs.record.textContent = "";
}

function renderSelectedFields(result) {
  if (result.selectedFieldEntries.length === 0) {
    refs.selectedFields.innerHTML = result.supported
      ? "<li>No scalar fields were selected.</li>"
      : `<li>${escapeHtml(result.rejectionReason ?? "Unsupported document.")}</li>`;
    return;
  }

  refs.selectedFields.innerHTML = result.selectedFieldEntries
    .map((entry) => {
      const scoreSuffix =
        result.engine === "model" && typeof entry.modelScore === "number"
          ? ` · ${(entry.modelScore * 100).toFixed(1)}%`
          : "";

      return `
        <li>
          <strong>${escapeHtml(humanizeFieldId(entry.fieldId))}</strong><br>
          <span class="receipt-candidate-line">${escapeHtml(entry.displayValue)}</span><br>
          <span class="tally-inline-meta">${escapeHtml(`${entry.source}${scoreSuffix}`)}</span>
        </li>
      `;
    })
    .join("");
}

function renderResult(result) {
  const engineLabel = result.engine === "model" ? "local model" : "runtime";
  const summaryLine = result.supported
    ? `${result.selectedFieldCount} fields extracted using ${engineLabel}.`
    : result.rejectionReason ?? "Unsupported document.";

  refs.status.innerHTML = `
    <div>
      <strong>${escapeHtml(result.voucherLabel)}</strong><br>
      ${escapeHtml(summaryLine)}
    </div>
  `;

  refs.stats.innerHTML = [
    createStatCard("Engine", result.engine),
    createStatCard("Family", result.voucherFamily),
    createStatCard("Support", result.supported ? "Yes" : "No"),
    createStatCard("Input", result.inputFormat),
    createStatCard("Rows", String(result.lineCount)),
    createStatCard("Fields", String(result.selectedFieldCount)),
    createStatCard("Line items", String(result.lineItemCount)),
    createStatCard("Elapsed", `${result.elapsedMs} ms`),
    result.modelStats?.averageSelectedScore != null
      ? createStatCard(
          "Avg score",
          `${(result.modelStats.averageSelectedScore * 100).toFixed(1)}%`,
        )
      : "",
  ].join("");

  refs.record.textContent = JSON.stringify(result.result, null, 2);
  renderSelectedFields(result);
}

function findPresetById(id) {
  return TALLY_DEMO_PRESETS.find((preset) => preset.id === id) ?? null;
}

function applyPreset(id) {
  const preset = findPresetById(id);
  if (!preset) {
    refs.presetDescription.textContent =
      "Paste OCR text or pdftotext TSV from a voucher-like document.";
    return;
  }

  refs.input.value = preset.source;
  refs.format.value = preset.format;
  refs.presetDescription.textContent = preset.description;
}

async function loadFile(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  refs.preset.value = "custom";
  if (/\.pdf$/i.test(file.name)) {
    refs.file.value = "";
    refs.presetDescription.textContent =
      "PDF conversion is not supported in this demo. Paste OCR text or pdftotext TSV instead.";
    renderError("PDF conversion is not supported in this demo. Paste OCR text or pdftotext TSV instead.");
    return;
  }

  refs.presetDescription.textContent = `Loaded ${file.name}.`;
  refs.input.value = await file.text();
  refs.format.value = file.name.toLowerCase().endsWith(".tsv") ? "tsv" : "auto";
}

function runDemo() {
  state.isRunning = true;
  syncButtons();
  renderRunning();
  getWorker().postMessage({
    type: "run",
    source: refs.input.value,
    format: refs.format.value,
    engine: refs.engine.value,
    fileName: refs.file.files?.[0]?.name ?? null,
    inputKind: refs.file.files?.[0]?.name?.toLowerCase()?.endsWith(".pdf") ? "pdf" : "text",
  });
}

function clearInput() {
  refs.preset.value = "custom";
  refs.presetDescription.textContent =
    "Paste OCR text or pdftotext TSV from a voucher-like document.";
  refs.format.value = "auto";
  refs.engine.value = "teacher";
  refs.input.value = "";
  refs.file.value = "";
  refs.status.innerHTML =
    "<div><strong>Tally demo is idle.</strong><br>Paste OCR text or pdftotext TSV to get a voucher-shaped record.</div>";
  refs.stats.innerHTML = "";
  refs.selectedFields.innerHTML = "";
  refs.record.textContent = "";
}

function buildPresetMenu() {
  refs.preset.innerHTML = [
    '<option value="custom">Bring your own</option>',
    ...TALLY_DEMO_PRESETS.map(
      (preset) =>
        `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.label)}</option>`,
    ),
  ].join("");
}

function bindEvents() {
  refs.preset.addEventListener("change", () => applyPreset(refs.preset.value));
  refs.run.addEventListener("click", runDemo);
  refs.clear.addEventListener("click", clearInput);
  refs.file.addEventListener("change", loadFile);
}

function init() {
  buildPresetMenu();
  bindEvents();
  clearInput();
  refs.preset.value = "tax-invoice-core";
  applyPreset("tax-invoice-core");
  runDemo();
}

init();

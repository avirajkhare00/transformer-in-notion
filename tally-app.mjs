import { TALLY_DEMO_PRESETS } from "./invoice/tally-demo-samples.mjs";
import { TALLY_VOUCHER_FAMILIES, listSupportedIndustries } from "./invoice/tally_schema.mjs";

const state = {
  worker: null,
  isRunning: false,
  lastResult: null,
};

const refs = {
  preset: document.querySelector("#tally-preset"),
  presetDescription: document.querySelector("#tally-preset-description"),
  format: document.querySelector("#tally-format"),
  family: document.querySelector("#tally-family"),
  industry: document.querySelector("#tally-industry"),
  input: document.querySelector("#tally-input"),
  file: document.querySelector("#tally-file"),
  run: document.querySelector("#tally-run"),
  clear: document.querySelector("#tally-clear"),
  status: document.querySelector("#tally-status"),
  stats: document.querySelector("#tally-stats"),
  schemaStats: document.querySelector("#tally-schema-stats"),
  familyRanking: document.querySelector("#tally-family-ranking"),
  selectedFields: document.querySelector("#tally-selected-fields"),
  record: document.querySelector("#tally-record"),
  fieldCandidates: document.querySelector("#tally-field-candidates"),
  prompt: document.querySelector("#tally-prompt"),
  tool: document.querySelector("#tally-tool"),
  program: document.querySelector("#tally-program"),
  trace: document.querySelector("#tally-trace"),
  log: document.querySelector("#tally-log"),
  flowSource: document.querySelector("#tally-flow-source"),
  flowFamily: document.querySelector("#tally-flow-family"),
  flowCandidates: document.querySelector("#tally-flow-candidates"),
  flowEmit: document.querySelector("#tally-flow-emit"),
};

function getWorker() {
  if (!state.worker) {
    state.worker = new Worker(new URL("./invoice/tally-worker.mjs", import.meta.url), {
      type: "module",
    });
    state.worker.addEventListener("message", handleWorkerMessage);
  }
  return state.worker;
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
  refs.family.disabled = disabled;
  refs.industry.disabled = disabled;
  refs.file.disabled = disabled;
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

function buildToolCard(tool) {
  return `
    <div class="tool-call-head">
      <span class="tool-call-name">${escapeHtml(tool.name)}</span>
      <span class="tool-call-badge">${escapeHtml(tool.supported ? "supported" : "reject")}</span>
    </div>
    <div class="tool-call-grid">
      <div class="tool-call-row">
        <span class="tool-call-key">Format</span>
        <span class="tool-call-value">${escapeHtml(tool.inputFormat)}</span>
      </div>
      <div class="tool-call-row">
        <span class="tool-call-key">Family</span>
        <span class="tool-call-value">${escapeHtml(tool.voucherFamily)}</span>
      </div>
      <div class="tool-call-row">
        <span class="tool-call-key">Industry</span>
        <span class="tool-call-value">${escapeHtml(tool.industry)}</span>
      </div>
      <div class="tool-call-row">
        <span class="tool-call-key">Field groups</span>
        <span class="tool-call-value">${escapeHtml(String(tool.fieldGroups))}</span>
      </div>
      <div class="tool-call-row">
        <span class="tool-call-key">Validators</span>
        <span class="tool-call-value">${escapeHtml(String(tool.validators))}</span>
      </div>
    </div>
  `;
}

function setFlowState(result) {
  for (const node of [
    refs.flowSource,
    refs.flowFamily,
    refs.flowCandidates,
    refs.flowEmit,
  ]) {
    node?.classList.add("is-active");
  }

  const familyBody = refs.flowFamily?.querySelector(".flow-node-body");
  if (familyBody) {
    familyBody.textContent = result.supported
      ? `The runtime chose ${result.voucherFamily} and loaded the ${result.industry} schema surface.`
      : result.rejectionReason ?? "The runtime rejected this OCR as unsupported.";
  }

  const emitBody = refs.flowEmit?.querySelector(".flow-node-body");
  if (emitBody) {
    emitBody.textContent = result.supported
      ? "The PSVM emitted a structured Tally-shaped voucher record from the top field candidates."
      : "The PSVM emitted a structured rejection instead of forcing an incorrect invoice record.";
  }
}

function renderFamilyRanking(result) {
  refs.familyRanking.innerHTML = result.rankedFamilies
    .map((family, index) => {
      const isBest = family.voucherFamily === result.voucherFamily;
      const reasons = family.reasons.slice(0, 3).join(" · ");
      return `
        <li class="analysis-row tally-family-row${isBest ? " is-best" : ""}">
          <div class="tally-family-main">
            <div class="receipt-candidate-head">
              <span class="analysis-move">${escapeHtml(family.label)}</span>
              <span class="receipt-candidate-meta">${escapeHtml(family.voucherFamily)}</span>
            </div>
            <div class="receipt-candidate-line">${escapeHtml(reasons || "no explicit cues")}</div>
          </div>
          <span class="analysis-badge ${family.supported ? "badge-win" : "badge-loss"}">${escapeHtml(
            family.supported ? "supported" : "reject",
          )}</span>
          <span class="analysis-badge badge-draw">${escapeHtml(`#${index + 1} · ${family.score}`)}</span>
        </li>
      `;
    })
    .join("");
}

function renderSelectedFields(result) {
  if (result.selectedFieldEntries.length === 0) {
    refs.selectedFields.innerHTML = "<li>No fields selected.</li>";
    return;
  }

  refs.selectedFields.innerHTML = result.selectedFieldEntries
    .map(
      (entry) => `
        <li>
          <strong>${escapeHtml(humanizeFieldId(entry.fieldId))}</strong><br>
          <span class="receipt-candidate-line">${escapeHtml(entry.displayValue)}</span><br>
          <span class="tally-inline-meta">${escapeHtml(entry.source)}</span>
        </li>
      `,
    )
    .join("");
}

function buildCandidatePills(group) {
  return group.candidates
    .map(
      (candidate) => `
        <span class="tally-candidate-pill">
          ${escapeHtml(candidate.displayValue)} · ${escapeHtml(String(candidate.score))}
        </span>
      `,
    )
    .join("");
}

function renderFieldGroups(result) {
  if (result.fieldGroups.length === 0) {
    refs.fieldCandidates.innerHTML = "";
    return;
  }

  refs.fieldCandidates.innerHTML = result.fieldGroups
    .map((group) => {
      const top = group.topCandidate;
      return `
        <li class="analysis-row tally-field-row">
          <div class="tally-field-main">
            <div class="tally-field-head">
              <span class="analysis-move">${escapeHtml(humanizeFieldId(group.fieldId))}</span>
              <span class="receipt-candidate-meta">${escapeHtml(group.fieldId)}</span>
            </div>
            <div class="receipt-candidate-line">
              ${escapeHtml(top?.reason || "No candidate reason")}
            </div>
            <div class="tally-candidate-pill-row">${buildCandidatePills(group)}</div>
          </div>
          <div class="receipt-score-stack">
            <span class="analysis-badge badge-win">${escapeHtml(
              top?.displayValue ?? "missing",
            )}</span>
            <span class="analysis-badge badge-draw">${escapeHtml(
              `${group.candidateCount} cand.`,
            )}</span>
          </div>
        </li>
      `;
    })
    .join("");
}

function renderReadableLog(result) {
  const lines = [
    `Detected voucher family ${result.voucherFamily} (${result.supported ? "supported" : "unsupported"}).`,
    `Industry extension: ${result.industry}.`,
    `Built ${result.fieldGroupCount} field groups and selected ${result.selectedFieldCount} scalar fields.`,
  ];

  if (result.rejectionReason) {
    lines.push(result.rejectionReason);
  } else {
    lines.push(
      ...result.selectedFieldEntries.slice(0, 6).map(
        (entry) => `${entry.fieldId} -> ${entry.displayValue} (${entry.source})`,
      ),
    );
  }

  refs.log.innerHTML = lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
}

function renderRunning() {
  refs.status.innerHTML = `
    <div>
      <strong>Running Tally PSVM…</strong><br>
      Classifying voucher family and extracting schema-aligned field candidates.
    </div>
  `;
  refs.stats.innerHTML = createStatCard("Status", "Running");
  refs.schemaStats.innerHTML = "";
  refs.familyRanking.innerHTML = "";
  refs.selectedFields.innerHTML = "";
  refs.fieldCandidates.innerHTML = "";
  refs.record.textContent = "";
  refs.prompt.textContent = "";
  refs.tool.innerHTML = "";
  refs.program.textContent = "";
  refs.trace.textContent = "";
  refs.log.innerHTML = "";
}

function renderError(message) {
  refs.status.innerHTML = `
    <div>
      <strong>Run failed.</strong><br>
      ${escapeHtml(message)}
    </div>
  `;
  refs.stats.innerHTML = createStatCard("Status", "Error");
  refs.schemaStats.innerHTML = "";
  refs.familyRanking.innerHTML = "";
  refs.selectedFields.innerHTML = `<li>${escapeHtml(message)}</li>`;
  refs.fieldCandidates.innerHTML = "";
  refs.record.textContent = "";
  refs.prompt.textContent = "";
  refs.tool.innerHTML = "";
  refs.program.textContent = "";
  refs.trace.textContent = "";
  refs.log.innerHTML = `<li>${escapeHtml(message)}</li>`;
}

function renderResult(result) {
  refs.status.innerHTML = `
    <div>
      <strong>${escapeHtml(result.voucherLabel)}:</strong>
      ${escapeHtml(result.supported ? "structured record emitted" : "rejected")}<br>
      ${escapeHtml(result.industry)} · ${escapeHtml(result.inputFormat)} · ${
        result.supported
          ? `${escapeHtml(String(result.selectedFieldCount))} selected fields`
          : escapeHtml(result.rejectionReason ?? "unsupported family")
      }
    </div>
  `;

  refs.stats.innerHTML = [
    createStatCard("Family", result.voucherFamily),
    createStatCard("Support", result.supported ? "Yes" : "No"),
    createStatCard("Pages", String(result.pageCount)),
    createStatCard("Rows", String(result.lineCount)),
    createStatCard("Field groups", String(result.fieldGroupCount)),
    createStatCard("Line items", String(result.lineItemCount)),
    createStatCard("Selected", String(result.selectedFieldCount)),
    createStatCard("Elapsed", `${result.elapsedMs} ms`),
  ].join("");

  refs.schemaStats.innerHTML = [
    createStatCard("Validators", String(result.schemaSummary.validators.length)),
    createStatCard("Document", String(result.schemaSummary.documentFields)),
    createStatCard("Parties", String(result.schemaSummary.partyFields)),
    createStatCard("Amounts", String(result.schemaSummary.amountFields)),
    createStatCard("Taxes", String(result.schemaSummary.taxFields)),
    createStatCard("Line item fields", String(result.schemaSummary.lineItemFields)),
  ].join("");

  refs.record.textContent = JSON.stringify(result.result, null, 2);
  refs.prompt.textContent = result.prompt;
  refs.tool.innerHTML = buildToolCard(result.tool);
  refs.program.textContent = result.program.join("\n");
  refs.trace.textContent = result.traceLines.join("\n");

  renderFamilyRanking(result);
  renderSelectedFields(result);
  renderFieldGroups(result);
  renderReadableLog(result);
  setFlowState(result);
}

function findPresetById(id) {
  return TALLY_DEMO_PRESETS.find((preset) => preset.id === id) ?? null;
}

function applyPreset(id) {
  const preset = findPresetById(id);
  if (!preset) {
    refs.presetDescription.textContent =
      "Paste noisy OCR text or `pdftotext -tsv` output from a voucher-like document.";
    return;
  }

  refs.input.value = preset.source;
  refs.format.value = preset.format;
  refs.family.value = preset.familyOverride ?? "auto";
  refs.industry.value = preset.industryOverride ?? "auto";
  refs.presetDescription.textContent = preset.description;
}

async function loadFile(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  refs.preset.value = "custom";
  refs.presetDescription.textContent = `Loaded ${file.name}.`;
  refs.input.value = await file.text();
  if (file.name.toLowerCase().endsWith(".tsv")) {
    refs.format.value = "tsv";
  }
}

function runDemo() {
  state.isRunning = true;
  syncButtons();
  renderRunning();
  getWorker().postMessage({
    type: "run",
    source: refs.input.value,
    format: refs.format.value,
    familyOverride: refs.family.value,
    industryOverride: refs.industry.value,
  });
}

function clearInput() {
  refs.preset.value = "custom";
  refs.presetDescription.textContent =
    "Paste noisy OCR text or `pdftotext -tsv` output from a voucher-like document.";
  refs.format.value = "auto";
  refs.family.value = "auto";
  refs.industry.value = "auto";
  refs.input.value = "";
  refs.file.value = "";
  refs.status.innerHTML =
    "<div><strong>Tally PSVM is idle.</strong><br>Load a sample or paste OCR text to inspect voucher-family classification and field extraction.</div>";
  refs.stats.innerHTML = "";
  refs.schemaStats.innerHTML = "";
  refs.familyRanking.innerHTML = "";
  refs.selectedFields.innerHTML = "";
  refs.record.textContent = "";
  refs.fieldCandidates.innerHTML = "";
  refs.prompt.textContent = "";
  refs.tool.innerHTML = "";
  refs.program.textContent = "";
  refs.trace.textContent = "";
  refs.log.innerHTML = "";
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

function buildFamilyMenu() {
  refs.family.innerHTML = [
    '<option value="auto">Auto detect</option>',
    ...Object.values(TALLY_VOUCHER_FAMILIES).map(
      (family) =>
        `<option value="${escapeHtml(family.id)}">${escapeHtml(family.label)}</option>`,
    ),
  ].join("");
}

function buildIndustryMenu() {
  refs.industry.innerHTML = [
    '<option value="auto">Auto detect</option>',
    ...listSupportedIndustries().map(
      (industry) =>
        `<option value="${escapeHtml(industry)}">${escapeHtml(
          industry.replaceAll("_", " "),
        )}</option>`,
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
  buildFamilyMenu();
  buildIndustryMenu();
  bindEvents();
  clearInput();
  refs.preset.value = "tax-invoice-core";
  applyPreset("tax-invoice-core");
  runDemo();
}

init();

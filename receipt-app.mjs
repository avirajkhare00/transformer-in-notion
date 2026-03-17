import { RECEIPT_DEMO_PRESETS } from "./invoice/receipt-demo-samples.mjs";

const state = {
  worker: null,
  lastResult: null,
  isRunning: false,
};

const refs = {
  preset: document.querySelector("#receipt-preset"),
  presetDescription: document.querySelector("#receipt-preset-description"),
  format: document.querySelector("#receipt-format"),
  input: document.querySelector("#receipt-input"),
  file: document.querySelector("#receipt-file"),
  engine: document.querySelector("#receipt-engine"),
  run: document.querySelector("#receipt-run"),
  clear: document.querySelector("#receipt-clear"),
  status: document.querySelector("#receipt-status"),
  stats: document.querySelector("#receipt-stats"),
  modelStatus: document.querySelector("#receipt-model-status"),
  modelStats: document.querySelector("#receipt-model-stats"),
  prompt: document.querySelector("#receipt-prompt"),
  tool: document.querySelector("#receipt-tool"),
  program: document.querySelector("#receipt-program"),
  trace: document.querySelector("#receipt-trace"),
  log: document.querySelector("#receipt-log"),
  candidates: document.querySelector("#receipt-candidates"),
  flowSource: document.querySelector("#receipt-flow-source"),
  flowCandidates: document.querySelector("#receipt-flow-candidates"),
  flowEngine: document.querySelector("#receipt-flow-engine"),
  flowEmit: document.querySelector("#receipt-flow-emit"),
};

function getWorker() {
  if (!state.worker) {
    state.worker = new Worker(new URL("./invoice/total-worker.mjs", import.meta.url), {
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
  refs.engine.disabled = disabled;
  refs.file.disabled = disabled;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatPercent(value) {
  if (typeof value !== "number") {
    return "n/a";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatTeacherScore(value) {
  if (typeof value !== "number") {
    return "n/a";
  }
  return value.toFixed(2);
}

function createStatCard(label, value) {
  return `
    <div class="stat-card">
      <span class="stat-label">${escapeHtml(label)}</span>
      <span class="stat-value">${escapeHtml(value)}</span>
    </div>
  `;
}

function buildToolCard(tool) {
  return `
    <div class="tool-call-head">
      <span class="tool-call-name">${escapeHtml(tool.name)}</span>
      <span class="tool-call-badge">${escapeHtml(tool.engine)}</span>
    </div>
    <div class="tool-call-grid">
      <div class="tool-call-row">
        <span class="tool-call-key">Format</span>
        <span class="tool-call-value">${escapeHtml(tool.inputFormat)}</span>
      </div>
      <div class="tool-call-row">
        <span class="tool-call-key">Pages</span>
        <span class="tool-call-value">${escapeHtml(String(tool.pages))}</span>
      </div>
      <div class="tool-call-row">
        <span class="tool-call-key">Lines</span>
        <span class="tool-call-value">${escapeHtml(String(tool.lines))}</span>
      </div>
      <div class="tool-call-row">
        <span class="tool-call-key">Candidates</span>
        <span class="tool-call-value">${escapeHtml(String(tool.candidates))}</span>
      </div>
    </div>
  `;
}

function setFlowState(engine) {
  for (const node of [
    refs.flowSource,
    refs.flowCandidates,
    refs.flowEngine,
    refs.flowEmit,
  ]) {
    node?.classList.add("is-active");
  }

  if (!refs.flowEngine) {
    return;
  }

  const badge = refs.flowEngine.querySelector(".flow-badge");
  const body = refs.flowEngine.querySelector(".flow-node-body");
  if (badge) {
    badge.textContent = engine === "model" ? "model" : "teacher";
  }
  if (body) {
    body.textContent =
      engine === "model"
        ? "The local browser model ranks each legal candidate context and the PSVM emits the top one."
        : "The deterministic teacher heuristic ranks each legal candidate and the PSVM emits the top one.";
  }
}

function buildCandidateCues(candidate) {
  const cues = [];
  if (candidate.explicitCueBeforeAmount) {
    cues.push("cue-before-total");
  } else if (candidate.explicitTotalCue) {
    cues.push("row-total-cue");
  }
  if (candidate.softTotalCueBeforeAmount || candidate.softTotalCue) {
    cues.push("soft-total");
  }
  if (candidate.subtotalCueBeforeAmount || candidate.subtotalCue) {
    cues.push("subtotal");
  }
  if (candidate.taxCueBeforeAmount || candidate.taxCue) {
    cues.push("tax");
  }
  if (candidate.lineItemCue) {
    cues.push("line-item");
  }
  if (candidate.pageRightBucket) {
    cues.push(`x:${candidate.pageRightBucket}`);
  }
  if (candidate.pageYBucket) {
    cues.push(`y:${candidate.pageYBucket}`);
  }
  if (candidate.cueGapBucket && candidate.cueGapBucket !== "none") {
    cues.push(`cue-gap:${candidate.cueGapBucket}`);
  }
  return cues.slice(0, 6);
}

function renderCandidateList(result) {
  refs.candidates.innerHTML = result.candidates
    .map((candidate, index) => {
      const isBest = candidate.candidateIndex === result.selectedCandidate.candidateIndex;
      const scoreBadge =
        result.engine === "model"
          ? `<span class="analysis-badge badge-win">model ${escapeHtml(
              formatPercent(candidate.modelScore),
            )}</span>`
          : `<span class="analysis-badge badge-win">teacher ${escapeHtml(
              formatTeacherScore(candidate.teacherScore),
            )}</span>`;
      const secondaryBadge =
        result.engine === "model"
          ? `<span class="analysis-badge badge-draw">teacher ${escapeHtml(
              formatTeacherScore(candidate.teacherScore),
            )}</span>`
          : `<span class="analysis-badge badge-draw">rank #${escapeHtml(
              String(index + 1),
            )}</span>`;
      const cueChips = buildCandidateCues(candidate)
        .map((cue) => `<span class="receipt-chip">${escapeHtml(cue)}</span>`)
        .join("");

      return `
        <li class="analysis-row receipt-candidate-row${isBest ? " is-best" : ""}">
          <div class="receipt-candidate-main">
            <div class="receipt-candidate-head">
              <span class="analysis-move">${escapeHtml(candidate.amountText)}</span>
              <span class="receipt-candidate-meta">line ${escapeHtml(
                String(candidate.lineIndex + 1),
              )}${typeof candidate.pageIndex === "number" ? ` · page ${escapeHtml(
                String(candidate.pageIndex + 1),
              )}` : ""}</span>
            </div>
            <div class="receipt-chip-row">${cueChips}</div>
            <div class="receipt-candidate-line">${escapeHtml(candidate.lineText)}</div>
          </div>
          <div class="receipt-score-stack">
            ${scoreBadge}
            ${secondaryBadge}
          </div>
        </li>
      `;
    })
    .join("");
}

function renderReadableLog(result) {
  const lines = [
    `${result.engine === "model" ? "Model" : "Teacher"} selected ${result.selectedCandidate.amountText} from line ${
      result.selectedCandidate.lineIndex + 1
    }.`,
    `Detected ${result.candidateCount} legal money candidates across ${result.lineCount} rows.`,
  ];

  if (result.teacherSelectedCandidate) {
    lines.push(`Teacher reference total: ${result.teacherSelectedCandidate.amountText}.`);
  }
  if (result.engine === "model") {
    lines.push(
      result.modelStats.matchesTeacher
        ? "Local model matched the teacher-selected candidate."
        : "Local model diverged from the teacher-selected candidate.",
    );
  }
  lines.push(
    ...result.candidates.slice(0, 5).map((candidate, index) => {
      const score =
        result.engine === "model"
          ? `model ${formatPercent(candidate.modelScore)}`
          : `teacher ${formatTeacherScore(candidate.teacherScore)}`;
      return `#${index + 1} ${candidate.amountText} at line ${
        candidate.lineIndex + 1
      } with ${score}.`;
    }),
  );

  refs.log.innerHTML = lines
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");
}

function renderRunning() {
  refs.status.innerHTML = `
    <div>
      <strong>Running receipt PSVM…</strong><br>
      Extracting legal money candidates and ranking them.
    </div>
  `;
  refs.modelStatus.textContent = "Local model is idle.";
  refs.trace.textContent = "";
}

function renderError(message) {
  refs.status.innerHTML = `
    <div>
      <strong>Run failed.</strong><br>
      ${escapeHtml(message)}
    </div>
  `;
  refs.stats.innerHTML = createStatCard("Status", "Error");
  refs.modelStatus.textContent = message;
  refs.modelStats.innerHTML = "";
  refs.program.textContent = "";
  refs.prompt.textContent = "";
  refs.tool.innerHTML = "";
  refs.trace.textContent = "";
  refs.log.innerHTML = `<li>${escapeHtml(message)}</li>`;
  refs.candidates.innerHTML = "";
}

function renderResult(result) {
  const comparison =
    result.engine === "model" && result.teacherSelectedCandidate
      ? result.modelStats.matchesTeacher
        ? `The model agrees with the teacher on ${result.teacherSelectedCandidate.amountText}.`
        : `Teacher reference is ${result.teacherSelectedCandidate.amountText}.`
      : `Teacher selected ${result.selectedCandidate.amountText}.`;

  refs.status.innerHTML = `
    <div>
      <strong>${escapeHtml(result.engine === "model" ? "Model total" : "Teacher total")}:</strong>
      ${escapeHtml(result.result.totalText)}<br>
      ${escapeHtml(result.documentType)} · ${escapeHtml(result.inputFormat)} · ${escapeHtml(comparison)}
    </div>
  `;

  refs.stats.innerHTML = [
    createStatCard("Document", result.documentType),
    createStatCard("Pages", String(result.pageCount)),
    createStatCard("Rows", String(result.lineCount)),
    createStatCard("Candidates", String(result.candidateCount)),
    createStatCard("Engine", result.engine),
    createStatCard("Elapsed", `${result.elapsedMs} ms`),
  ].join("");

  refs.modelStatus.textContent =
    result.engine === "model"
      ? "Local browser model scored every legal candidate context."
      : "Teacher mode uses the deterministic heuristic only.";
  refs.modelStats.innerHTML =
    result.engine === "model"
      ? [
          createStatCard("Top score", formatPercent(result.modelStats.topScore)),
          createStatCard("Runner-up", formatPercent(result.modelStats.runnerUpScore)),
          createStatCard(
            "Margin",
            result.modelStats.scoreMargin === null
              ? "n/a"
              : formatPercent(result.modelStats.scoreMargin),
          ),
          createStatCard(
            "Teacher match",
            result.modelStats.matchesTeacher ? "Yes" : "No",
          ),
        ].join("")
      : [
          createStatCard("Top score", "n/a"),
          createStatCard("Runner-up", "n/a"),
          createStatCard("Margin", "n/a"),
          createStatCard("Teacher match", "Yes"),
        ].join("");

  refs.prompt.textContent = result.prompt;
  refs.tool.innerHTML = buildToolCard(result.tool);
  refs.program.textContent = result.program.join("\n");
  refs.trace.textContent = result.traceLines.join("\n");

  renderCandidateList(result);
  renderReadableLog(result);
  setFlowState(result.engine);
}

function findPresetById(id) {
  return RECEIPT_DEMO_PRESETS.find((preset) => preset.id === id) ?? null;
}

function applyPreset(id) {
  const preset = findPresetById(id);
  if (!preset) {
    refs.presetDescription.textContent =
      "Paste your own OCR text or `pdftotext -tsv` output.";
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
    engine: refs.engine.value,
  });
}

function clearInput() {
  refs.preset.value = "custom";
  refs.presetDescription.textContent =
    "Paste your own OCR text or `pdftotext -tsv` output.";
  refs.input.value = "";
  refs.file.value = "";
  refs.status.innerHTML =
    "<div><strong>Receipt PSVM is idle.</strong><br>Load a sample or paste OCR text to begin.</div>";
  refs.stats.innerHTML = "";
  refs.modelStatus.textContent = "Local model is idle.";
  refs.modelStats.innerHTML = "";
  refs.prompt.textContent = "";
  refs.tool.innerHTML = "";
  refs.program.textContent = "";
  refs.trace.textContent = "";
  refs.log.innerHTML = "";
  refs.candidates.innerHTML = "";
}

function buildPresetMenu() {
  const options = [
    '<option value="custom">Bring your own</option>',
    ...RECEIPT_DEMO_PRESETS.map(
      (preset) =>
        `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.label)}</option>`,
    ),
  ];
  refs.preset.innerHTML = options.join("");
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
  refs.preset.value = "tax-ocr";
  applyPreset("tax-ocr");
  runDemo();
}

init();

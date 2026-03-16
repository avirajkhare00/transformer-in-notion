import {
  DEFAULT_PRESET_ID,
  WEIQI_OPS,
  WEIQI_PRESETS,
  formatCoord,
  getTargetOverlay,
  parseBoard5x5,
} from "./psvm5x5.mjs";

const presetEl = document.querySelector("#preset");
const loadButton = document.querySelector("#load-button");
const solveButton = document.querySelector("#solve-button");
const statusEl = document.querySelector("#status");
const summaryEl = document.querySelector("#summary");
const programEl = document.querySelector("#program");
const traceEl = document.querySelector("#trace");
const boardEl = document.querySelector("#board");
const statsEl = document.querySelector("#stats");
const opsEl = document.querySelector("#ops");

let worker = null;
let currentPreset = WEIQI_PRESETS.find((preset) => preset.id === DEFAULT_PRESET_ID) ?? WEIQI_PRESETS[0];
let givenMask = null;
let targetOverlay = [];
let traceLines = [];

function setStatus(message, tone = "neutral") {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function stopWorker() {
  if (!worker) {
    return;
  }
  worker.terminate();
  worker = null;
}

function renderOps() {
  opsEl.innerHTML = WEIQI_OPS.map((op) => `<li>${op}</li>`).join("");
}

function renderProgram(lines) {
  programEl.textContent = lines.join("\n");
}

function renderTrace() {
  traceEl.textContent = traceLines.join("\n");
  traceEl.scrollTop = traceEl.scrollHeight;
}

function renderSummary(preset) {
  if (!preset) {
    summaryEl.innerHTML = "";
    return;
  }

  const cells = [
    ["attacker", preset.attacker === "B" ? "Black" : "White"],
    ["target", `${preset.targetColor} @ ${formatCoord(preset.targetSeed.row, preset.targetSeed.col)}`],
    ["max ply", preset.maxPly],
    ["goal", "capture the marked chain"],
  ];

  summaryEl.innerHTML = cells
    .map(
      ([label, value]) =>
        `<div class="stat"><dt>${label}</dt><dd>${value}</dd></div>`,
    )
    .join("");
}

function updateStats(stats = {}, extras = {}) {
  const entries = [
    ["nodes", stats.nodes ?? 0],
    ["legal moves", stats.legalMoves ?? 0],
    ["captures", stats.captures ?? 0],
    ["undos", stats.undos ?? 0],
    ["max depth", stats.maxDepth ?? 0],
  ];

  if (typeof extras.traceLength === "number") {
    entries.push(["trace events", extras.traceLength]);
  }
  if (typeof extras.elapsedMs === "number") {
    entries.push(["worker ms", extras.elapsedMs]);
  }

  statsEl.innerHTML = entries
    .map(
      ([label, value]) =>
        `<div class="stat"><dt>${label}</dt><dd>${value}</dd></div>`,
    )
    .join("");
}

function overlaySet(points) {
  return new Set(points.map((point) => `${point.row}:${point.col}`));
}

function renderBoard(board, event = null, liveTarget = []) {
  boardEl.innerHTML = "";
  const targetSet = overlaySet(liveTarget);
  const captureSet =
    event?.op === "CAPTURE" ? overlaySet(event.stones) : new Set();
  const eventKey =
    typeof event?.row === "number" && typeof event?.col === "number"
      ? `${event.row}:${event.col}`
      : null;

  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";
      const key = `${row}:${col}`;

      if (targetSet.has(key)) {
        cell.classList.add("target");
      }
      if (captureSet.has(key)) {
        cell.classList.add("captured");
      }
      if (eventKey === key) {
        cell.classList.add("active");
        if (event.op === "UNDO") {
          cell.classList.add("undo");
        }
      }

      const stone = board[row][col];
      if (stone !== ".") {
        const stoneEl = document.createElement("span");
        stoneEl.className = `stone ${stone === "B" ? "stone-black" : "stone-white"}`;
        if (givenMask?.[row]?.[col]) {
          stoneEl.classList.add("given");
        }
        cell.appendChild(stoneEl);
      }

      boardEl.appendChild(cell);
    }
  }
}

function populatePresets() {
  presetEl.innerHTML = WEIQI_PRESETS.map(
    (preset) =>
      `<option value="${preset.id}"${
        preset.id === currentPreset.id ? " selected" : ""
      }>${preset.label}</option>`,
  ).join("");
}

function loadPreset(id = presetEl.value) {
  currentPreset =
    WEIQI_PRESETS.find((preset) => preset.id === id) ??
    WEIQI_PRESETS.find((preset) => preset.id === DEFAULT_PRESET_ID) ??
    WEIQI_PRESETS[0];

  const board = parseBoard5x5(currentPreset.board);
  givenMask = board.map((row) => row.map((cell) => cell !== "."));
  targetOverlay = getTargetOverlay(board, currentPreset.targetSeed, currentPreset.targetColor);
  traceLines = [];
  renderTrace();
  renderProgram([
    `BOARD 5x5 attacker=${currentPreset.attacker} target=${currentPreset.targetColor}@${formatCoord(
      currentPreset.targetSeed.row,
      currentPreset.targetSeed.col,
    )}`,
    "RULES liberties capture suicide-ko",
    "LOOP PLAY CAPTURE UNDO PASS",
    `HALT when target chain is removed within ${currentPreset.maxPly} plies`,
  ]);
  renderBoard(board, null, targetOverlay);
  renderSummary(currentPreset);
  updateStats();
  setStatus(currentPreset.summary);
}

function startSolve() {
  stopWorker();
  traceLines = [];
  renderTrace();
  updateStats();
  setStatus("Worker searching the 5x5 capture proof...", "busy");

  worker = new Worker(new URL("./worker.mjs", import.meta.url), {
    type: "module",
  });

  worker.onmessage = ({ data }) => {
    if (data.type === "start") {
      currentPreset = data.preset;
      givenMask = data.givenMask;
      targetOverlay = data.targetOverlay;
      renderSummary(data.preset);
      renderProgram(data.program);
      renderBoard(data.board, null, data.targetOverlay);
      return;
    }

    if (data.type === "event") {
      targetOverlay = data.targetOverlay;
      traceLines.push(data.line);
      renderTrace();
      renderBoard(data.snapshot, data.event, data.targetOverlay);
      return;
    }

    if (data.type === "done") {
      givenMask = data.givenMask;
      targetOverlay = data.targetOverlay;
      renderBoard(data.board, null, data.targetOverlay);
      updateStats(data.stats, {
        traceLength: data.traceLength,
        elapsedMs: data.elapsedMs,
      });
      setStatus(
        data.solved
          ? `Forced capture found in ${data.elapsedMs} ms over ${data.traceLength} trace events.`
          : "Target survived inside the search horizon.",
        data.solved ? "success" : "error",
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
    type: "solve",
    presetId: currentPreset.id,
  });
}

loadButton.addEventListener("click", () => loadPreset(presetEl.value));
solveButton.addEventListener("click", startSolve);

populatePresets();
renderOps();
loadPreset(currentPreset.id);

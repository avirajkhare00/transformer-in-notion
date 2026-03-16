import {
  DEFAULT_4X4_PUZZLE,
  PSVM_OPS,
  buildGivenMask4x4,
  buildProgram4x4,
  parsePuzzle4x4,
} from "./psvm4x4.mjs";

const puzzleInput = document.querySelector("#puzzle-input");
const exampleButton = document.querySelector("#example-button");
const solveButton = document.querySelector("#solve-button");
const statusEl = document.querySelector("#status");
const programEl = document.querySelector("#program");
const traceEl = document.querySelector("#trace");
const boardEl = document.querySelector("#board");
const statsEl = document.querySelector("#stats");
const opsEl = document.querySelector("#ops");

let worker = null;
let givenMask = null;
let traceLines = [];

function setStatus(message, tone = "neutral") {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function updateStats(stats = {}, extras = {}) {
  const entries = [
    ["focuses", stats.focuses ?? 0],
    ["placements", stats.placements ?? 0],
    ["backtracks", stats.backtracks ?? 0],
    ["contradictions", stats.contradictions ?? 0],
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

function renderProgram(lines) {
  programEl.textContent = lines.join("\n");
}

function renderTrace() {
  traceEl.textContent = traceLines.join("\n");
  traceEl.scrollTop = traceEl.scrollHeight;
}

function renderOps() {
  opsEl.innerHTML = PSVM_OPS.map((op) => `<li>${op}</li>`).join("");
}

function renderBoard(board, event = null) {
  boardEl.innerHTML = "";
  const highlightKey =
    event && typeof event.row === "number" && typeof event.col === "number"
      ? `${event.row}:${event.col}`
      : null;

  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";

      if (row === 1) {
        cell.classList.add("row-break");
      }
      if (col === 1) {
        cell.classList.add("col-break");
      }
      if (givenMask && givenMask[row][col]) {
        cell.classList.add("given");
      }
      if (highlightKey === `${row}:${col}`) {
        cell.classList.add("focus");
        if (event.op === "PLACE") {
          cell.classList.add("trial");
        }
        if (event.op === "UNDO" || event.op === "FAIL") {
          cell.classList.add("undo");
        }
      }

      const value = board[row][col];
      cell.textContent = value === 0 ? "" : String(value);
      boardEl.appendChild(cell);
    }
  }
}

function stopWorker() {
  if (!worker) {
    return;
  }

  worker.terminate();
  worker = null;
}

function loadExample() {
  puzzleInput.value = DEFAULT_4X4_PUZZLE;
  const board = parsePuzzle4x4(DEFAULT_4X4_PUZZLE);
  givenMask = buildGivenMask4x4(board);
  renderBoard(board);
  renderProgram(buildProgram4x4(DEFAULT_4X4_PUZZLE));
  traceLines = [];
  renderTrace();
  updateStats();
  setStatus("Example loaded. Solve to stream the PSVM trace.");
}

function startSolve() {
  const puzzle = puzzleInput.value.trim();

  try {
    const board = parsePuzzle4x4(puzzle);
    givenMask = buildGivenMask4x4(board);
    renderBoard(board);
    renderProgram(buildProgram4x4(puzzle));
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
  updateStats();
  setStatus("Worker running canonical PSVM search...", "busy");

  worker = new Worker(new URL("./worker.mjs", import.meta.url), {
    type: "module",
  });

  worker.onmessage = ({ data }) => {
    if (data.type === "start") {
      givenMask = buildGivenMask4x4(data.initialBoard);
      renderBoard(data.initialBoard);
      renderProgram(data.program);
      return;
    }

    if (data.type === "event") {
      traceLines.push(data.line);
      renderTrace();
      renderBoard(data.snapshot, data.event);
      return;
    }

    if (data.type === "done") {
      givenMask = data.givenMask;
      renderBoard(data.solution);
      updateStats(data.stats, {
        traceLength: data.traceLength,
        elapsedMs: data.elapsedMs,
      });
      setStatus(
        data.solved
          ? `Solved in ${data.elapsedMs} ms with ${data.traceLength} trace events.`
          : "No solution found.",
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
    puzzle,
  });
}

exampleButton.addEventListener("click", loadExample);
solveButton.addEventListener("click", startSolve);

renderOps();
loadExample();

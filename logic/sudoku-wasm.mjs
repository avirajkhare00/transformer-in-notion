import { parseSudoku } from "./sudoku.mjs";

let runtimePromise = null;
let nextRequestId = 1;

function createSudokuRuntime() {
  const worker = new Worker(new URL("./sudoku-wasm-worker.mjs", import.meta.url), {
    type: "module",
  });
  const pending = new Map();

  worker.addEventListener("message", (event) => {
    const { requestId, ok, payload, error } = event.data ?? {};
    const entry = pending.get(requestId);
    if (!entry) {
      return;
    }
    pending.delete(requestId);

    if (ok) {
      entry.resolve(payload);
      return;
    }

    entry.reject(new Error(error || "Sudoku worker request failed."));
  });

  worker.addEventListener("error", (event) => {
    const message = event.message || "Sudoku worker crashed.";
    pending.forEach(({ reject }) => reject(new Error(message)));
    pending.clear();
  });

  return { worker, pending };
}

function destroySudokuRuntime(runtime) {
  runtime.pending.forEach(({ reject }) => reject(new Error("Sudoku worker terminated.")));
  runtime.pending.clear();
  runtime.worker.terminate();
}

async function getSudokuRuntime() {
  if (!runtimePromise) {
    runtimePromise = Promise.resolve(createSudokuRuntime());
  }
  return runtimePromise;
}

async function sendSudokuRuntimeMessageWithRuntime(runtime, type, payload = {}) {
  const requestId = nextRequestId;
  nextRequestId += 1;

  return new Promise((resolve, reject) => {
    runtime.pending.set(requestId, { resolve, reject });
    runtime.worker.postMessage({ type, requestId, payload });
  });
}

async function sendSudokuRuntimeMessage(type, payload = {}) {
  const runtime = await getSudokuRuntime();
  return sendSudokuRuntimeMessageWithRuntime(runtime, type, payload);
}

async function runSudokuIsolatedJob(type, payload = {}) {
  const runtime = createSudokuRuntime();

  try {
    return await sendSudokuRuntimeMessageWithRuntime(runtime, type, payload);
  } finally {
    destroySudokuRuntime(runtime);
  }
}

function normalizeSolveResult(result) {
  if (result.error) {
    throw new Error(result.error);
  }

  return {
    solved: result.solved,
    solution: parseSudoku(result.solution),
    trace: result.trace,
    stats: result.stats,
    elapsedMs: result.elapsedMs,
  };
}

export async function warmSudokuExecutor() {
  await sendSudokuRuntimeMessage("warm");
}

export async function solveSudokuWithWasm(puzzle) {
  const result = await sendSudokuRuntimeMessage("solve", { puzzle });
  return normalizeSolveResult(result);
}

export async function benchmarkSudokuDeterministic(puzzle, strategy = "mrv") {
  return sendSudokuRuntimeMessage("benchmark", { puzzle, strategy });
}

export async function benchmarkSudokuWasm(puzzle, runs = 100) {
  return runSudokuIsolatedJob("benchmark-wasm", { puzzle, runs });
}

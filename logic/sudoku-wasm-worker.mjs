import { parseSudoku, solveSudokuWithTrace } from "./sudoku.mjs";

const WASM_URL = new URL("../wasm/sudoku_solver.wasm", import.meta.url);

let wasmPromise = null;

async function instantiateSudokuExecutor() {
  const response = await fetch(WASM_URL);
  const bytes = await response.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return instance.exports;
}

async function getSudokuExecutor() {
  if (!wasmPromise) {
    wasmPromise = instantiateSudokuExecutor();
  }
  return wasmPromise;
}

function readUtf8(memory, pointer, length) {
  const bytes = new Uint8Array(memory.buffer, pointer, length);
  return new TextDecoder().decode(bytes);
}

function normalizeSolvePayload(result, elapsedMs) {
  if (result.error) {
    throw new Error(result.error);
  }

  return {
    solved: result.solved,
    solution: result.solution,
    trace: result.trace,
    stats: result.stats,
    elapsedMs,
  };
}

async function solveSudokuWithWorkerWasm(puzzle) {
  const executor = await getSudokuExecutor();
  const input = new TextEncoder().encode(puzzle);
  const pointer = executor.alloc(input.length);
  const view = new Uint8Array(executor.memory.buffer, pointer, input.length);
  view.set(input);

  try {
    const startedAt = performance.now();
    executor.solve(pointer, input.length);
    const elapsedMs = performance.now() - startedAt;
    const resultPointer = executor.result_ptr();
    const resultLength = executor.result_len();
    const json = readUtf8(executor.memory, resultPointer, resultLength);
    return normalizeSolvePayload(JSON.parse(json), elapsedMs);
  } finally {
    executor.dealloc(pointer, input.length);
  }
}

function benchmarkDeterministicSolver(puzzle, strategy) {
  const board = parseSudoku(puzzle);
  const startedAt = performance.now();
  const result = solveSudokuWithTrace(board, { strategy });
  const elapsedMs = performance.now() - startedAt;

  if (!result.solved) {
    throw new Error(`Deterministic ${strategy} solver failed to solve the puzzle.`);
  }

  return {
    strategy: result.strategy,
    elapsedMs,
    stats: result.stats,
    traceLength: result.trace.length,
  };
}

self.addEventListener("message", async (event) => {
  const { type, requestId, payload = {} } = event.data ?? {};

  try {
    if (type === "warm") {
      await getSudokuExecutor();
      self.postMessage({ requestId, ok: true, payload: { ready: true } });
      return;
    }

    if (type === "solve") {
      const result = await solveSudokuWithWorkerWasm(payload.puzzle);
      self.postMessage({ requestId, ok: true, payload: result });
      return;
    }

    if (type === "benchmark") {
      const result = benchmarkDeterministicSolver(payload.puzzle, payload.strategy ?? "mrv");
      self.postMessage({ requestId, ok: true, payload: result });
      return;
    }

    throw new Error(`Unknown Sudoku worker command: ${type}`);
  } catch (error) {
    self.postMessage({
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : "Sudoku worker command failed.",
    });
  }
});

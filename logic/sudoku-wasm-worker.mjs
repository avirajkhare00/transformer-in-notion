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

function percentile(sortedValues, fraction) {
  if (!sortedValues.length) {
    return NaN;
  }

  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * fraction) - 1)
  );
  return sortedValues[index];
}

function summarizeSamples(values) {
  if (!values.length) {
    return {
      count: 0,
      minMs: NaN,
      maxMs: NaN,
      meanMs: NaN,
      medianMs: NaN,
      p95Ms: NaN,
    };
  }

  const sorted = [...values].sort((left, right) => left - right);
  const total = values.reduce((sum, value) => sum + value, 0);

  return {
    count: values.length,
    minMs: sorted[0],
    maxMs: sorted.at(-1),
    meanMs: total / values.length,
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
  };
}

function ensureSolved(result, label) {
  if (!result.solved) {
    throw new Error(`${label} failed to solve the puzzle.`);
  }
}

function collectCoreStats(result) {
  return {
    traceLength: result.trace.length,
    placements: result.stats.placements,
    backtracks: result.stats.backtracks,
  };
}

async function runSudokuWasmSolve(executor, puzzle) {
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

async function solveSudokuWithWorkerWasm(puzzle) {
  const executor = await getSudokuExecutor();
  return runSudokuWasmSolve(executor, puzzle);
}

async function benchmarkSudokuWasmSolver(puzzle, runs = 100) {
  const instantiateStartedAt = performance.now();
  const executor = await getSudokuExecutor();
  const instantiateMs = performance.now() - instantiateStartedAt;
  const samples = [];
  let firstResult = null;

  for (let runIndex = 0; runIndex < runs; runIndex += 1) {
    const result = await runSudokuWasmSolve(executor, puzzle);
    ensureSolved(result, "WASM benchmark");
    samples.push(result.elapsedMs);
    if (!firstResult) {
      firstResult = result;
    }
  }

  const warmSamples = samples.slice(1);

  return {
    runs,
    instantiateMs,
    firstSolveMs: samples[0],
    all: summarizeSamples(samples),
    warm: summarizeSamples(warmSamples),
    samplesMs: samples,
    ...collectCoreStats(firstResult),
  };
}

function benchmarkDeterministicSolver(puzzle, strategy) {
  const board = parseSudoku(puzzle);
  const startedAt = performance.now();
  const result = solveSudokuWithTrace(board, { strategy });
  const elapsedMs = performance.now() - startedAt;

  ensureSolved(result, `Deterministic ${strategy} solver`);

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

    if (type === "benchmark-wasm") {
      const result = await benchmarkSudokuWasmSolver(payload.puzzle, payload.runs ?? 100);
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

import { parseSudoku } from "./sudoku.mjs";

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

function normalizeResult(result) {
  if (result.error) {
    throw new Error(result.error);
  }

  return {
    solved: result.solved,
    solution: parseSudoku(result.solution),
    trace: result.trace,
    stats: result.stats,
  };
}

export async function warmSudokuExecutor() {
  await getSudokuExecutor();
}

export async function solveSudokuWithWasm(puzzle) {
  const executor = await getSudokuExecutor();
  const input = new TextEncoder().encode(puzzle);
  const pointer = executor.alloc(input.length);
  const view = new Uint8Array(executor.memory.buffer, pointer, input.length);
  view.set(input);

  try {
    executor.solve(pointer, input.length);
    const resultPointer = executor.result_ptr();
    const resultLength = executor.result_len();
    const json = readUtf8(executor.memory, resultPointer, resultLength);
    return normalizeResult(JSON.parse(json));
  } finally {
    executor.dealloc(pointer, input.length);
  }
}

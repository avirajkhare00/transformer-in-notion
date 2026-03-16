import fs from "node:fs/promises";
import path from "node:path";

import { HARD_SUDOKU_PRESETS } from "../logic/sudoku-hard.mjs";
import { parseSudoku, solveSudokuWithTrace } from "../logic/sudoku.mjs";

const outputArg = process.argv.indexOf("--output");
const outputPath =
  outputArg >= 0 && process.argv[outputArg + 1]
    ? process.argv[outputArg + 1]
    : path.join("soduku", "training", "hard-puzzle-traces.json");

const dataset = HARD_SUDOKU_PRESETS.map((preset) => {
  const result = solveSudokuWithTrace(parseSudoku(preset.puzzle));
  return {
    id: preset.id,
    label: preset.label,
    puzzle: preset.puzzle,
    strategy: result.strategy,
    solved: result.solved,
    stats: result.stats,
    trace: result.trace,
  };
});

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(dataset, null, 2));

console.log(
  `Wrote ${dataset.length} hard Sudoku traces to ${outputPath}`,
);

import { performance } from "node:perf_hooks";

import { HARD_SUDOKU_PRESETS } from "../logic/sudoku-hard.mjs";
import {
  isValidSudokuSolution,
  parseSudoku,
  solveSudokuNaively,
  solveSudokuWithTrace,
} from "../logic/sudoku.mjs";

function runSolver(preset, solverName, solver) {
  const board = parseSudoku(preset.puzzle);
  const startedAt = performance.now();
  const result = solver(board);
  const elapsedMs = performance.now() - startedAt;
  const valid = result.solved && isValidSudokuSolution(result.solution, board);

  return {
    puzzle: preset.label,
    solver: solverName,
    solved: result.solved,
    valid,
    ms: Number(elapsedMs.toFixed(2)),
    focuses: result.stats.focuses,
    placements: result.stats.placements,
    backtracks: result.stats.backtracks,
    deadEnds: result.stats.deadEnds,
    candidateQueries: result.stats.candidateQueries,
    chooserCellScans: result.stats.chooserCellScans,
    maxDepth: result.stats.maxDepth,
    traceEvents: result.trace.length,
  };
}

const rows = [];
for (const preset of HARD_SUDOKU_PRESETS) {
  rows.push(runSolver(preset, "naive", solveSudokuNaively));
  rows.push(runSolver(preset, "mrv", solveSudokuWithTrace));
}

console.table(rows);

const summary = HARD_SUDOKU_PRESETS.map((preset) => {
  const naive = rows.find(
    (row) => row.puzzle === preset.label && row.solver === "naive",
  );
  const mrv = rows.find(
    (row) => row.puzzle === preset.label && row.solver === "mrv",
  );

  return {
    puzzle: preset.label,
    valid: naive.valid && mrv.valid,
    searchEventsSaved:
      naive.placements +
      naive.backtracks -
      (mrv.placements + mrv.backtracks),
    placementsSaved: naive.placements - mrv.placements,
    backtracksSaved: naive.backtracks - mrv.backtracks,
    candidateQueriesAdded: mrv.candidateQueries - naive.candidateQueries,
    chooserCellScansAdded: mrv.chooserCellScans - naive.chooserCellScans,
    msSaved: Number((naive.ms - mrv.ms).toFixed(2)),
  };
});

console.log("\nPolicy-only delta (same JS DFS solver, same puzzle set, only chooser policy changes)");
console.table(summary);

export const DEFAULT_PUZZLE =
  "300200000000107000706030500070009080900020004010800050009040301000702000000008006";

export function parseSudoku(puzzle) {
  const cleaned = puzzle.replace(/[^0-9.]/g, "").replace(/\./g, "0");
  if (cleaned.length !== 81) {
    throw new Error("Sudoku puzzles must contain exactly 81 cells.");
  }

  const board = [];
  for (let row = 0; row < 9; row += 1) {
    const current = [];
    for (let col = 0; col < 9; col += 1) {
      current.push(Number(cleaned[row * 9 + col]));
    }
    board.push(current);
  }
  return board;
}

export function cloneSudokuBoard(board) {
  return board.map((row) => [...row]);
}

export function serializeSudoku(board) {
  return board
    .flat()
    .map((value) => (value === 0 ? "." : String(value)))
    .join("");
}

export function countFilledSudokuCells(board) {
  return board.flat().filter((value) => value !== 0).length;
}

export function buildGivenMask(board) {
  return board.map((row) => row.map((value) => value !== 0));
}

export function formatSudokuCell(row, col) {
  return `r${row + 1}c${col + 1}`;
}

export function getSudokuCandidates(board, row, col, stats = null) {
  if (stats) {
    stats.candidateQueries += 1;
  }

  if (board[row][col] !== 0) {
    return [];
  }

  const blocked = new Set();

  for (let index = 0; index < 9; index += 1) {
    if (board[row][index] !== 0) {
      blocked.add(board[row][index]);
    }
    if (board[index][col] !== 0) {
      blocked.add(board[index][col]);
    }
  }

  const boxRow = Math.floor(row / 3) * 3;
  const boxCol = Math.floor(col / 3) * 3;
  for (let r = boxRow; r < boxRow + 3; r += 1) {
    for (let c = boxCol; c < boxCol + 3; c += 1) {
      if (board[r][c] !== 0) {
        blocked.add(board[r][c]);
      }
    }
  }

  const candidates = [];
  for (let value = 1; value <= 9; value += 1) {
    if (!blocked.has(value)) {
      candidates.push(value);
    }
  }
  return candidates;
}

function chooseNextCell(board, stats = null) {
  if (stats) {
    stats.chooserCalls += 1;
  }

  let best = null;

  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      if (stats) {
        stats.chooserCellScans += 1;
      }

      if (board[row][col] !== 0) {
        continue;
      }

      const candidates = getSudokuCandidates(board, row, col, stats);
      if (!best || candidates.length < best.candidates.length) {
        best = { row, col, candidates };
      }

      if (best.candidates.length === 1) {
        return best;
      }
    }
  }

  return best;
}

function chooseNextCellRowMajor(board, stats = null) {
  if (stats) {
    stats.chooserCalls += 1;
  }

  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      if (stats) {
        stats.chooserCellScans += 1;
      }

      if (board[row][col] !== 0) {
        continue;
      }

      return {
        row,
        col,
        candidates: getSudokuCandidates(board, row, col, stats),
      };
    }
  }

  return null;
}

function getChooser(strategy) {
  if (strategy === "row-major") {
    return chooseNextCellRowMajor;
  }
  return chooseNextCell;
}

function normalizeGuidedCandidateOrder(candidates, rankedCandidates) {
  if (!Array.isArray(rankedCandidates) || rankedCandidates.length === 0) {
    return [...candidates];
  }

  const legal = new Set(candidates);
  const ordered = [];
  const seen = new Set();

  rankedCandidates.forEach((value) => {
    if (!legal.has(value) || seen.has(value)) {
      return;
    }
    seen.add(value);
    ordered.push(value);
  });

  candidates.forEach((value) => {
    if (seen.has(value)) {
      return;
    }
    ordered.push(value);
  });

  return ordered;
}

function pushHistoryOp(historyOps, op) {
  historyOps.push(op);
  if (historyOps.length > 64) {
    historyOps.shift();
  }
}

export function solveSudokuWithTrace(startBoard, options = {}) {
  const strategy = options.strategy ?? "mrv";
  const chooseCell = getChooser(strategy);
  const board = cloneSudokuBoard(startBoard);
  const trace = [];
  const stats = {
    placements: 0,
    backtracks: 0,
    focuses: 0,
    deadEnds: 0,
    candidateQueries: 0,
    chooserCalls: 0,
    chooserCellScans: 0,
    maxDepth: 0,
  };

  function search(depth = 0) {
    stats.maxDepth = Math.max(stats.maxDepth, depth);
    const next = chooseCell(board, stats);
    if (!next) {
      return true;
    }

    if (next.candidates.length === 0) {
      stats.deadEnds += 1;
      return false;
    }

    stats.focuses += 1;
    trace.push({
      type: "focus",
      row: next.row,
      col: next.col,
      candidates: [...next.candidates],
      depth,
    });

    for (const value of next.candidates) {
      board[next.row][next.col] = value;
      stats.placements += 1;
      trace.push({
        type: "place",
        row: next.row,
        col: next.col,
        value,
        depth,
      });

      if (search(depth + 1)) {
        return true;
      }

      board[next.row][next.col] = 0;
      stats.backtracks += 1;
      trace.push({
        type: "backtrack",
        row: next.row,
        col: next.col,
        value,
        depth,
      });
    }

    return false;
  }

  const solved = search();
  return {
    solved,
    solution: board,
    trace,
    stats,
    strategy,
  };
}

export function solveSudokuNaively(startBoard) {
  return solveSudokuWithTrace(startBoard, { strategy: "row-major" });
}

export async function solveSudokuWithGuidance(startBoard, options = {}) {
  const strategy = options.strategy ?? "mrv";
  const chooseCell = getChooser(strategy);
  const board = cloneSudokuBoard(startBoard);
  const trace = [];
  const stats = {
    placements: 0,
    backtracks: 0,
    focuses: 0,
    deadEnds: 0,
    candidateQueries: 0,
    chooserCalls: 0,
    chooserCellScans: 0,
    maxDepth: 0,
  };
  const historyOps = [];
  const onEvent =
    typeof options.onEvent === "function" ? options.onEvent : null;

  async function search(depth = 0) {
    stats.maxDepth = Math.max(stats.maxDepth, depth);
    const next = chooseCell(board, stats);
    if (!next) {
      return true;
    }

    if (next.candidates.length === 0) {
      stats.deadEnds += 1;
      return false;
    }

    const focus = {
      row: next.row,
      col: next.col,
      candidates: [...next.candidates],
      depth,
    };

    stats.focuses += 1;
    const focusEvent = {
      type: "focus",
      row: focus.row,
      col: focus.col,
      candidates: [...focus.candidates],
      depth,
    };
    trace.push(focusEvent);
    if (onEvent) {
      await onEvent(focusEvent, board);
    }
    pushHistoryOp(historyOps, "FOCUS_NEXT");

    let candidateOrder = [...next.candidates];
    if (
      typeof options.rankCandidates === "function" &&
      next.candidates.length > 1
    ) {
      const rankedResult = await options.rankCandidates({
        board,
        focus,
        historyOps: [...historyOps],
        strategy,
      });
      const rankedCandidates = Array.isArray(rankedResult)
        ? rankedResult
        : rankedResult?.orderedCandidates;
      candidateOrder = normalizeGuidedCandidateOrder(
        next.candidates,
        rankedCandidates
      );
    }

    for (const value of candidateOrder) {
      board[next.row][next.col] = value;
      stats.placements += 1;
      const placeEvent = {
        type: "place",
        row: next.row,
        col: next.col,
        value,
        depth,
      };
      trace.push(placeEvent);
      if (onEvent) {
        await onEvent(placeEvent, board);
      }
      pushHistoryOp(historyOps, "PLACE");

      if (await search(depth + 1)) {
        return true;
      }

      board[next.row][next.col] = 0;
      stats.backtracks += 1;
      const backtrackEvent = {
        type: "backtrack",
        row: next.row,
        col: next.col,
        value,
        depth,
      };
      trace.push(backtrackEvent);
      if (onEvent) {
        await onEvent(backtrackEvent, board);
      }
      pushHistoryOp(historyOps, "UNDO");
    }

    return false;
  }

  const solved = await search();
  return {
    solved,
    solution: board,
    trace,
    stats,
    strategy,
  };
}

export function isValidSudokuSolution(board, clueBoard = null) {
  for (let row = 0; row < 9; row += 1) {
    const rowValues = new Set();
    const colValues = new Set();
    for (let col = 0; col < 9; col += 1) {
      const rowValue = board[row][col];
      const colValue = board[col][row];
      if (!Number.isInteger(rowValue) || rowValue < 1 || rowValue > 9) {
        return false;
      }
      if (!Number.isInteger(colValue) || colValue < 1 || colValue > 9) {
        return false;
      }
      rowValues.add(rowValue);
      colValues.add(colValue);
    }
    if (rowValues.size !== 9 || colValues.size !== 9) {
      return false;
    }
  }

  for (let boxRow = 0; boxRow < 9; boxRow += 3) {
    for (let boxCol = 0; boxCol < 9; boxCol += 3) {
      const values = new Set();
      for (let row = boxRow; row < boxRow + 3; row += 1) {
        for (let col = boxCol; col < boxCol + 3; col += 1) {
          values.add(board[row][col]);
        }
      }
      if (values.size !== 9) {
        return false;
      }
    }
  }

  if (clueBoard) {
    for (let row = 0; row < 9; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        if (clueBoard[row][col] !== 0 && board[row][col] !== clueBoard[row][col]) {
          return false;
        }
      }
    }
  }

  return true;
}

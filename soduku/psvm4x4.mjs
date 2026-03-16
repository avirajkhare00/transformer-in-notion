export const PSVM_OPS = Object.freeze([
  "LOAD_PUZZLE",
  "FOCUS_NEXT",
  "READ_CANDS",
  "TRY_VALUE",
  "PLACE",
  "UNDO",
  "ADVANCE",
  "FAIL",
  "HALT_IF_SOLVED",
  "EMIT",
]);

export const DEFAULT_4X4_PUZZLE = "1..4.4....434..1";

const GRID_SIZE = 4;
const BOX_SIZE = 2;
const DIGITS = [1, 2, 3, 4];

export function normalizePuzzle4x4(puzzle) {
  const cleaned = puzzle.replace(/[^0-4.]/g, "").replace(/\./g, "0");
  if (cleaned.length !== GRID_SIZE * GRID_SIZE) {
    throw new Error("4x4 Sudoku puzzles must contain exactly 16 cells.");
  }

  for (const char of cleaned) {
    const value = Number(char);
    if (!Number.isInteger(value) || value < 0 || value > GRID_SIZE) {
      throw new Error("4x4 Sudoku cells must be digits 0-4 or dots.");
    }
  }

  return cleaned;
}

export function parsePuzzle4x4(puzzle) {
  const normalized = normalizePuzzle4x4(puzzle);
  const board = [];

  for (let row = 0; row < GRID_SIZE; row += 1) {
    const current = [];
    for (let col = 0; col < GRID_SIZE; col += 1) {
      current.push(Number(normalized[row * GRID_SIZE + col]));
    }
    board.push(current);
  }

  return board;
}

export function cloneBoard4x4(board) {
  return board.map((row) => [...row]);
}

export function serializeBoard4x4(board) {
  return board.flat().join("");
}

export function formatBoard4x4(board) {
  return board
    .map((row, rowIndex) => {
      const cells = row.map((value) => (value === 0 ? "." : String(value)));
      if (rowIndex === 1) {
        return `${cells.slice(0, 2).join(" ")} | ${cells.slice(2).join(" ")}`;
      }
      return `${cells.slice(0, 2).join(" ")} | ${cells.slice(2).join(" ")}`;
    })
    .join("\n")
    .replace(/^(.+\n.+)\n(.+\n.+)$/s, "$1\n-----\n$2");
}

export function buildGivenMask4x4(board) {
  return board.map((row) => row.map((value) => value !== 0));
}

export function buildProgram4x4(puzzle) {
  const normalized = normalizePuzzle4x4(puzzle);
  return [
    `LOAD_PUZZLE ${normalized}`,
    "LOOP FOCUS_NEXT READ_CANDS TRY_VALUE PLACE UNDO ADVANCE FAIL HALT_IF_SOLVED",
    "EMIT solution",
  ];
}

export function isSolved4x4(board) {
  return board.every((row) => row.every((value) => value !== 0));
}

function getCandidates4x4(board, row, col) {
  if (board[row][col] !== 0) {
    return [];
  }

  const blocked = new Set();

  for (let index = 0; index < GRID_SIZE; index += 1) {
    if (board[row][index] !== 0) {
      blocked.add(board[row][index]);
    }
    if (board[index][col] !== 0) {
      blocked.add(board[index][col]);
    }
  }

  const boxRow = Math.floor(row / BOX_SIZE) * BOX_SIZE;
  const boxCol = Math.floor(col / BOX_SIZE) * BOX_SIZE;
  for (let r = boxRow; r < boxRow + BOX_SIZE; r += 1) {
    for (let c = boxCol; c < boxCol + BOX_SIZE; c += 1) {
      if (board[r][c] !== 0) {
        blocked.add(board[r][c]);
      }
    }
  }

  return DIGITS.filter((value) => !blocked.has(value));
}

function chooseNextCell4x4(board) {
  let best = null;

  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      if (board[row][col] !== 0) {
        continue;
      }

      const candidates = getCandidates4x4(board, row, col);
      if (
        !best ||
        candidates.length < best.candidates.length ||
        (candidates.length === best.candidates.length &&
          (row < best.row || (row === best.row && col < best.col)))
      ) {
        best = { row, col, candidates };
      }

      if (best && best.candidates.length === 1) {
        return best;
      }
    }
  }

  return best;
}

function createEvent(op, fields = {}) {
  return {
    op,
    ...fields,
  };
}

function emitEvent(trace, board, event, onEvent) {
  const snapshot = cloneBoard4x4(board);
  trace.push({ ...event, snapshot });
  if (onEvent) {
    onEvent({ ...event }, snapshot);
  }
}

export function formatPsvmEvent(event) {
  switch (event.op) {
    case "LOAD_PUZZLE":
      return `LOAD_PUZZLE ${event.puzzle}`;
    case "FOCUS_NEXT":
      return `FOCUS_NEXT r${event.row + 1}c${event.col + 1} depth=${event.depth}`;
    case "READ_CANDS":
      return `READ_CANDS r${event.row + 1}c${event.col + 1} -> [${event.candidates.join(", ")}]`;
    case "TRY_VALUE":
      return `TRY_VALUE r${event.row + 1}c${event.col + 1} = ${event.value}`;
    case "PLACE":
      return `PLACE r${event.row + 1}c${event.col + 1} = ${event.value}`;
    case "UNDO":
      return `UNDO r${event.row + 1}c${event.col + 1} = ${event.value}`;
    case "ADVANCE":
      return `ADVANCE r${event.row + 1}c${event.col + 1} -> try ${event.nextValue}`;
    case "FAIL":
      return `FAIL ${event.reason}${typeof event.row === "number" ? ` at r${event.row + 1}c${event.col + 1}` : ""}`;
    case "HALT_IF_SOLVED":
      return "HALT_IF_SOLVED";
    case "EMIT":
      return `EMIT ${event.solution}`;
    default:
      return event.op;
  }
}

export function solveWithPsvm4x4(puzzle, options = {}) {
  const { onEvent } = options;
  const initialBoard = parsePuzzle4x4(puzzle);
  const board = cloneBoard4x4(initialBoard);
  const trace = [];
  const stats = {
    focuses: 0,
    placements: 0,
    backtracks: 0,
    contradictions: 0,
  };

  emitEvent(
    trace,
    board,
    createEvent("LOAD_PUZZLE", { puzzle: serializeBoard4x4(board) }),
    onEvent,
  );

  function search(depth = 0) {
    if (isSolved4x4(board)) {
      emitEvent(trace, board, createEvent("HALT_IF_SOLVED", { depth }), onEvent);
      return true;
    }

    const next = chooseNextCell4x4(board);
    if (!next) {
      emitEvent(trace, board, createEvent("HALT_IF_SOLVED", { depth }), onEvent);
      return true;
    }

    stats.focuses += 1;
    emitEvent(
      trace,
      board,
      createEvent("FOCUS_NEXT", {
        row: next.row,
        col: next.col,
        depth,
      }),
      onEvent,
    );
    emitEvent(
      trace,
      board,
      createEvent("READ_CANDS", {
        row: next.row,
        col: next.col,
        candidates: [...next.candidates],
        depth,
      }),
      onEvent,
    );

    if (next.candidates.length === 0) {
      stats.contradictions += 1;
      emitEvent(
        trace,
        board,
        createEvent("FAIL", {
          row: next.row,
          col: next.col,
          reason: "no_candidates",
          depth,
        }),
        onEvent,
      );
      return false;
    }

    for (let index = 0; index < next.candidates.length; index += 1) {
      const value = next.candidates[index];
      emitEvent(
        trace,
        board,
        createEvent("TRY_VALUE", {
          row: next.row,
          col: next.col,
          value,
          depth,
        }),
        onEvent,
      );

      board[next.row][next.col] = value;
      stats.placements += 1;
      emitEvent(
        trace,
        board,
        createEvent("PLACE", {
          row: next.row,
          col: next.col,
          value,
          depth,
        }),
        onEvent,
      );

      if (search(depth + 1)) {
        return true;
      }

      board[next.row][next.col] = 0;
      stats.backtracks += 1;
      emitEvent(
        trace,
        board,
        createEvent("UNDO", {
          row: next.row,
          col: next.col,
          value,
          depth,
        }),
        onEvent,
      );

      if (index < next.candidates.length - 1) {
        emitEvent(
          trace,
          board,
          createEvent("ADVANCE", {
            row: next.row,
            col: next.col,
            nextValue: next.candidates[index + 1],
            depth,
          }),
          onEvent,
        );
      }
    }

    stats.contradictions += 1;
    emitEvent(
      trace,
      board,
      createEvent("FAIL", {
        row: next.row,
        col: next.col,
        reason: "branch_exhausted",
        depth,
      }),
      onEvent,
    );
    return false;
  }

  const solved = search(0);
  if (solved) {
    emitEvent(
      trace,
      board,
      createEvent("EMIT", {
        solution: serializeBoard4x4(board),
      }),
      onEvent,
    );
  }

  return {
    solved,
    program: buildProgram4x4(serializeBoard4x4(initialBoard)),
    initialBoard,
    solution: cloneBoard4x4(board),
    trace,
    stats,
    givenMask: buildGivenMask4x4(initialBoard),
  };
}

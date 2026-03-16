import { countFilledSudokuCells } from "../logic/sudoku.mjs";

export const HARD_OP_LABELS = Object.freeze(["FOCUS_NEXT", "PLACE", "UNDO"]);
export const HARD_VALUE_LABELS = Object.freeze(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
export const HARD_OP_HISTORY_WINDOW = 8;

const HARD_OP_IDS = Object.freeze({
  FOCUS_NEXT: 1,
  PLACE: 2,
  UNDO: 3,
});

export function eventToHardOp(event) {
  switch (event.type) {
    case "focus":
      return "FOCUS_NEXT";
    case "place":
      return "PLACE";
    case "backtrack":
      return "UNDO";
    default:
      throw new Error(`Unsupported Sudoku trace event: ${event.type}`);
  }
}

export function encodeHardHistory(historyOps, historyWindow = HARD_OP_HISTORY_WINDOW) {
  const encoded = Array.from({ length: historyWindow }, () => 0);
  const recent = historyOps.slice(-historyWindow);
  const start = historyWindow - recent.length;

  recent.forEach((op, index) => {
    encoded[start + index] = HARD_OP_IDS[op] ?? 0;
  });

  return encoded;
}

export function buildHardOpContext({
  board,
  focus,
  historyOps,
  historyWindow = HARD_OP_HISTORY_WINDOW,
}) {
  const candidateMask = Array.from({ length: 9 }, (_, index) =>
    focus && focus.candidates.includes(index + 1) ? 1 : 0
  );

  return {
    boardTokens: board.flat().map((value) => value ?? 0),
    focusRow: focus ? focus.row + 1 : 0,
    focusCol: focus ? focus.col + 1 : 0,
    candidateMask,
    historyOps: encodeHardHistory(historyOps, historyWindow),
    filledCount: countFilledSudokuCells(board),
    searchDepth: focus?.depth ?? 0,
  };
}

export function applyHardTraceEvent(board, event, focus) {
  switch (event.type) {
    case "focus":
      return {
        row: event.row,
        col: event.col,
        candidates: [...event.candidates],
        depth: event.depth ?? 0,
      };
    case "place":
      board[event.row][event.col] = event.value;
      return focus;
    case "backtrack":
      board[event.row][event.col] = 0;
      return focus;
    default:
      throw new Error(`Unsupported Sudoku trace event: ${event.type}`);
  }
}

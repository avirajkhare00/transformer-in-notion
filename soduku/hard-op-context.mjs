import { countFilledSudokuCells } from "../logic/sudoku.mjs";

export const HARD_OP_LABELS = Object.freeze(["FOCUS_NEXT", "PLACE", "UNDO"]);
export const HARD_OP_HISTORY_WINDOW = 8;

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

export function buildHardOpContext({
  board,
  focus,
  historyOps,
  historyWindow = HARD_OP_HISTORY_WINDOW,
  strategy = "mrv",
}) {
  const history =
    historyOps.length === 0 ? "START" : historyOps.slice(-historyWindow).join(" ");
  const boardTokens = board
    .flat()
    .map((value) => (value === 0 ? "." : String(value)))
    .join(" ");
  const focusRow = focus ? String(focus.row + 1) : "none";
  const focusCol = focus ? String(focus.col + 1) : "none";
  const candidateTokens =
    focus && focus.candidates.length > 0 ? focus.candidates.join(" ") : "none";

  return [
    `strategy ${strategy}`,
    `board ${boardTokens}`,
    `filled ${countFilledSudokuCells(board)}`,
    `focus_row ${focusRow}`,
    `focus_col ${focusCol}`,
    `cands ${candidateTokens}`,
    `history ${history}`,
  ].join(" ");
}

export function applyHardTraceEvent(board, event, focus) {
  switch (event.type) {
    case "focus":
      return {
        row: event.row,
        col: event.col,
        candidates: [...event.candidates],
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

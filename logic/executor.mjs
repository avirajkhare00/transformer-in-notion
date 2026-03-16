import { formatMoveLabel } from "./tictactoe.mjs";
import { formatSudokuCell } from "./sudoku.mjs";

function encodeCell(value) {
  return value || ".";
}

function renderTicTacToeBoard(board) {
  return [
    board.slice(0, 3).map(encodeCell).join(" "),
    board.slice(3, 6).map(encodeCell).join(" "),
    board.slice(6, 9).map(encodeCell).join(" "),
  ].join(" / ");
}

function renderSudokuRow(row) {
  return row
    .map((value, index) => `${value || "."}${index === 2 || index === 5 ? " |" : ""}`)
    .join(" ")
    .trim();
}

function countClues(board) {
  return board.flat().filter(Boolean).length;
}

function windowEvents(events, stepIndex, size = 12) {
  if (!events.length) {
    return [];
  }

  const safeIndex = Math.max(0, Math.min(stepIndex, events.length));
  if (safeIndex === 0) {
    return events.slice(0, size);
  }

  return events.slice(Math.max(0, safeIndex - size), safeIndex);
}

function formatTicTacToeToken(option, index) {
  const moveToken = String(option.move).padStart(2, "0");
  const scoreToken = String(option.score).padStart(2, "0");
  return `step ${String(index + 1).padStart(2, "0")} eval move=${moveToken} score=${scoreToken} tag=${option.label.replace(/\s+/g, "_")}`;
}

function formatSudokuToken(event, index) {
  const head = `pc=${String(index + 1).padStart(3, "0")}`;
  const cell = formatSudokuCell(event.row, event.col);
  if (event.type === "focus") {
    return `${head} focus ${cell} cand=[${event.candidates.join(",")}] depth=${event.depth}`;
  }
  if (event.type === "place") {
    return `${head} commit ${cell}=${event.value} depth=${event.depth}`;
  }
  return `${head} undo ${cell}=${event.value} depth=${event.depth}`;
}

export function buildTicTacToeExecutorArtifacts(board, analysis, locked) {
  const prompt = [
    "Need the safest reply for O.",
    `Board: ${renderTicTacToeBoard(board)}`,
    analysis?.runtime ? `Runtime: ${analysis.runtime}` : "Runtime: local transformer policy.",
  ].join("\n");

  const options = analysis?.options ?? [];
  const bestMove = analysis?.bestMove;
  const program = [
    "{",
    "  tokenize_board",
    "  embed_tokens",
    "  self_attention",
    "  classify_move_logits",
    "  mask_illegal_moves",
    "  argmax probability",
    `  commit_move ${bestMove == null ? "--" : formatMoveLabel(bestMove)}`,
    "}",
  ].join("\n");

  const traceLines = [];
  if (!options.length) {
    traceLines.push(locked ? "loading model policy..." : "waiting for a player move...");
  } else {
    options.forEach((option, index) => {
      traceLines.push(
        `step ${String(index + 1).padStart(2, "0")} policy move=${String(option.move).padStart(
          2,
          "0"
        )} p=${option.score.toFixed(4)} tag=${option.label.replace(/\s+/g, "_")}`
      );
    });
    traceLines.push(
      `argmax ${formatMoveLabel(bestMove)} p=${options[0].score.toFixed(4)} engine=${analysis.engine}`
    );
    traceLines.push(locked ? `commit pending O -> ${formatMoveLabel(bestMove)}` : `commit O -> ${formatMoveLabel(bestMove)}`);
  }

  return {
    prompt,
    program,
    trace: traceLines.join("\n"),
  };
}

export function buildSudokuExecutorArtifacts(initialBoard, result, stepIndex) {
  const prompt = [
    `Solve 9x9 Sudoku with ${countClues(initialBoard)} clues.`,
    "Strategy: choose the emptiest cell, try candidates, backtrack on contradiction.",
    `Preview row 1: ${renderSudokuRow(initialBoard[0])}`,
  ].join("\n");

  const program = [
    "{",
    "  load_grid",
    "  scan_min_candidate_cell",
    "  emit_focus",
    "  try_candidate",
    "  check_row",
    "  check_col",
    "  check_box",
    "  commit_or_backtrack",
    "  halt_when_full",
    "}",
  ].join("\n");

  const traceWindow = windowEvents(result.trace, stepIndex);
  const trace = traceWindow.length
    ? traceWindow
        .map((event, index) =>
          formatSudokuToken(
            event,
            Math.max(0, stepIndex === 0 ? index : stepIndex - traceWindow.length + index)
          )
        )
        .join("\n")
    : "trace not started";

  return {
    prompt,
    program,
    trace,
  };
}

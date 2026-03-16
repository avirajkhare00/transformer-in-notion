import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeTicTacToe,
  createTicTacToeBoard,
  getTicTacToeOutcome,
} from "../logic/tictactoe.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(__dirname, "../training/tictactoe-dataset.json");

function serializeBoard(board) {
  return board.map((cell) => cell || ".").join(" ");
}

function listLegalMoves(board) {
  return board.flatMap((cell, index) => (cell ? [] : [index]));
}

const seen = new Set();
const samples = [];

function visit(board, turn) {
  const key = `${board.map((cell) => cell || "-").join("")}:${turn}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);

  const outcome = getTicTacToeOutcome(board);
  if (outcome.isDone) {
    return;
  }

  if (turn === "O") {
    const analysis = analyzeTicTacToe(board, "O");
    samples.push({
      board: serializeBoard(board),
      bestMove: analysis.bestMove,
      legalMoves: listLegalMoves(board),
      options: analysis.options,
    });
  }

  const nextTurn = turn === "X" ? "O" : "X";
  for (let index = 0; index < board.length; index += 1) {
    if (board[index]) {
      continue;
    }
    board[index] = turn;
    visit(board, nextTurn);
    board[index] = "";
  }
}

visit(createTicTacToeBoard(), "X");
visit(createTicTacToeBoard(), "O");

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      sampleCount: samples.length,
      samples,
    },
    null,
    2
  )
);

console.log(`Wrote ${samples.length} tic-tac-toe samples to ${outputPath}.`);

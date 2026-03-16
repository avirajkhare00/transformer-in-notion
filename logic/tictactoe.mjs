const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const PREFERRED_MOVES = [4, 0, 2, 6, 8, 1, 3, 5, 7];
const MOVE_LABELS = [
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
];

const memo = new Map();

export function createTicTacToeBoard() {
  return Array(9).fill("");
}

export function formatMoveLabel(index) {
  return MOVE_LABELS[index];
}

export function getTicTacToeOutcome(board) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return {
        winner: board[a],
        line,
        isDraw: false,
        isDone: true,
      };
    }
  }

  const isDraw = board.every(Boolean);
  return {
    winner: "",
    line: [],
    isDraw,
    isDone: isDraw,
  };
}

function nextPlayer(player) {
  return player === "O" ? "X" : "O";
}

function orderedMoves(board) {
  return PREFERRED_MOVES.filter((move) => !board[move]);
}

function serialize(board, player) {
  return `${board.map((cell) => cell || "-").join("")}:${player}`;
}

function minimax(board, player, depth, stats) {
  const outcome = getTicTacToeOutcome(board);
  if (outcome.winner === "O") {
    return { score: 10 - depth, move: null };
  }
  if (outcome.winner === "X") {
    return { score: depth - 10, move: null };
  }
  if (outcome.isDraw) {
    return { score: 0, move: null };
  }

  const key = serialize(board, player);
  if (memo.has(key)) {
    return memo.get(key);
  }

  stats.nodes += 1;

  let best =
    player === "O"
      ? { score: Number.NEGATIVE_INFINITY, move: null }
      : { score: Number.POSITIVE_INFINITY, move: null };

  for (const move of orderedMoves(board)) {
    board[move] = player;
    const result = minimax(board, nextPlayer(player), depth + 1, stats);
    board[move] = "";

    if (player === "O") {
      if (result.score > best.score) {
        best = { score: result.score, move };
      }
    } else if (result.score < best.score) {
      best = { score: result.score, move };
    }
  }

  memo.set(key, best);
  return best;
}

export function analyzeTicTacToe(board, player = "O") {
  const outcome = getTicTacToeOutcome(board);
  if (outcome.isDone) {
    return { bestMove: null, nodes: 0, options: [] };
  }

  const stats = { nodes: 0 };
  const options = [];

  for (const move of orderedMoves(board)) {
    board[move] = player;
    const result = minimax(board, nextPlayer(player), 1, stats);
    board[move] = "";
    options.push({
      move,
      score: result.score,
      label: describeScore(result.score),
    });
  }

  options.sort((left, right) => right.score - left.score);

  return {
    bestMove: options[0]?.move ?? null,
    nodes: stats.nodes,
    options,
  };
}

function describeScore(score) {
  if (score > 0) {
    return "forced win";
  }
  if (score < 0) {
    return "forced loss";
  }
  return "draw line";
}

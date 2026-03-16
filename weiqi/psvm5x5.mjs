export const WEIQI_OPS = Object.freeze([
  "PLAY",
  "CAPTURE",
  "UNDO",
  "PASS",
  "HALT",
]);

const BOARD_SIZE = 5;
const DIRECTIONS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

export const WEIQI_PRESETS = Object.freeze([
  {
    id: "center-seal",
    label: "Center Seal",
    attacker: "B",
    targetColor: "W",
    targetSeed: { row: 1, col: 1 },
    maxPly: 3,
    board: `
      BBBB.
      BWWB.
      BW.B.
      BBBB.
      .....
    `,
    summary: "Black to play and capture the marked white group.",
  },
  {
    id: "corridor-net",
    label: "Corridor Net",
    attacker: "B",
    targetColor: "W",
    targetSeed: { row: 1, col: 1 },
    maxPly: 5,
    board: `
      BBBBB
      BWW.B
      BW..B
      BBBBB
      .....
    `,
    summary: "Black to play. One move keeps the white chain sealed long enough to capture.",
  },
]);

export const DEFAULT_PRESET_ID = WEIQI_PRESETS[0].id;

function otherColor(color) {
  return color === "B" ? "W" : "B";
}

function inside(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function keyOf(row, col) {
  return `${row}:${col}`;
}

function parseKey(key) {
  const [row, col] = key.split(":").map(Number);
  return { row, col };
}

export function formatCoord(row, col) {
  return `${String.fromCharCode(97 + col)}${BOARD_SIZE - row}`;
}

export function normalizeBoard5x5(source) {
  const cleaned = source
    .toUpperCase()
    .replace(/[^BW.]/g, "");

  if (cleaned.length !== BOARD_SIZE * BOARD_SIZE) {
    throw new Error("5x5 Weiqi boards must contain exactly 25 cells using B, W, or .");
  }

  return cleaned;
}

export function parseBoard5x5(source) {
  const normalized = normalizeBoard5x5(source);
  const board = [];

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    const current = [];
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      current.push(normalized[row * BOARD_SIZE + col]);
    }
    board.push(current);
  }

  return board;
}

export function cloneBoard5x5(board) {
  return board.map((row) => [...row]);
}

export function buildGivenMask5x5(board) {
  return board.map((row) => row.map((cell) => cell !== "."));
}

export function serializeBoard5x5(board) {
  return board.flat().join("");
}

export function formatBoard5x5(board) {
  return board.map((row) => row.join(" ")).join("\n");
}

function listNeighbors(row, col) {
  const cells = [];
  for (const [dRow, dCol] of DIRECTIONS) {
    const nextRow = row + dRow;
    const nextCol = col + dCol;
    if (inside(nextRow, nextCol)) {
      cells.push({ row: nextRow, col: nextCol });
    }
  }
  return cells;
}

function collectChain(board, row, col) {
  const color = board[row][col];
  if (color !== "B" && color !== "W") {
    return null;
  }

  const queue = [{ row, col }];
  const visited = new Set([keyOf(row, col)]);
  const stones = [];
  const liberties = new Set();

  while (queue.length > 0) {
    const current = queue.pop();
    stones.push(current);

    for (const neighbor of listNeighbors(current.row, current.col)) {
      const value = board[neighbor.row][neighbor.col];
      if (value === ".") {
        liberties.add(keyOf(neighbor.row, neighbor.col));
        continue;
      }
      if (value !== color) {
        continue;
      }

      const neighborKey = keyOf(neighbor.row, neighbor.col);
      if (!visited.has(neighborKey)) {
        visited.add(neighborKey);
        queue.push(neighbor);
      }
    }
  }

  return {
    color,
    stones,
    liberties: [...liberties].map(parseKey),
  };
}

function removeChain(board, chain) {
  for (const stone of chain.stones) {
    board[stone.row][stone.col] = ".";
  }
}

function chainContains(chain, row, col) {
  return chain.stones.some((stone) => stone.row === row && stone.col === col);
}

function coordsToText(stones) {
  return stones.map((stone) => formatCoord(stone.row, stone.col)).join(", ");
}

function sortMoves(moves, targetChain, currentPlayer) {
  const targetKeys = new Set(targetChain.stones.map((stone) => keyOf(stone.row, stone.col)));
  const targetLibertyKeys = new Set(
    targetChain.liberties.map((point) => keyOf(point.row, point.col)),
  );

  moves.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (left.move.type !== right.move.type) {
      return left.move.type === "play" ? -1 : 1;
    }
    if (left.move.type === "pass") {
      return 0;
    }
    const leftOnTarget = targetKeys.has(keyOf(left.move.row, left.move.col));
    const rightOnTarget = targetKeys.has(keyOf(right.move.row, right.move.col));
    if (leftOnTarget !== rightOnTarget) {
      return leftOnTarget ? -1 : 1;
    }
    const leftOnLiberty = targetLibertyKeys.has(keyOf(left.move.row, left.move.col));
    const rightOnLiberty = targetLibertyKeys.has(keyOf(right.move.row, right.move.col));
    if (leftOnLiberty !== rightOnLiberty) {
      return leftOnLiberty ? -1 : 1;
    }
    return keyOf(left.move.row, left.move.col).localeCompare(
      keyOf(right.move.row, right.move.col),
    );
  });

  if (currentPlayer !== "B") {
    moves.reverse();
  }
}

function applyMove(state, move) {
  if (move.type === "pass") {
    return {
      nextState: {
        ...state,
        toMove: otherColor(state.toMove),
        passes: state.passes + 1,
        koPoint: null,
      },
      captureEvents: [],
      passEvent: {
        op: "PASS",
        player: state.toMove,
        depth: state.depth,
      },
    };
  }

  if (!inside(move.row, move.col)) {
    return null;
  }
  if (state.board[move.row][move.col] !== ".") {
    return null;
  }
  if (
    state.koPoint &&
    state.koPoint.row === move.row &&
    state.koPoint.col === move.col
  ) {
    return null;
  }

  const board = cloneBoard5x5(state.board);
  board[move.row][move.col] = state.toMove;
  const opponent = otherColor(state.toMove);
  const captureEvents = [];
  const checkedChains = new Set();
  let capturedCount = 0;

  for (const neighbor of listNeighbors(move.row, move.col)) {
    if (board[neighbor.row][neighbor.col] !== opponent) {
      continue;
    }
    const neighborKey = keyOf(neighbor.row, neighbor.col);
    if (checkedChains.has(neighborKey)) {
      continue;
    }
    const chain = collectChain(board, neighbor.row, neighbor.col);
    for (const stone of chain.stones) {
      checkedChains.add(keyOf(stone.row, stone.col));
    }
    if (chain.liberties.length === 0) {
      removeChain(board, chain);
      capturedCount += chain.stones.length;
      captureEvents.push({
        op: "CAPTURE",
        color: opponent,
        stones: chain.stones.map((stone) => ({ ...stone })),
        depth: state.depth,
      });
    }
  }

  const ownChain = collectChain(board, move.row, move.col);
  if (!ownChain || ownChain.liberties.length === 0) {
    return null;
  }

  let koPoint = null;
  if (
    capturedCount === 1 &&
    ownChain.stones.length === 1 &&
    ownChain.liberties.length === 1
  ) {
    koPoint = { ...captureEvents[0].stones[0] };
  }

  const nextState = {
    ...state,
    board,
    toMove: opponent,
    passes: 0,
    koPoint,
    depth: state.depth + 1,
  };

  return {
    nextState,
    captureEvents,
    playEvent: {
      op: "PLAY",
      player: state.toMove,
      row: move.row,
      col: move.col,
      depth: state.depth,
      captures: capturedCount,
    },
  };
}

function isTargetCaptured(state) {
  return state.board[state.targetSeed.row][state.targetSeed.col] !== state.targetColor;
}

function getTargetChain(state) {
  if (isTargetCaptured(state)) {
    return null;
  }
  return collectChain(state.board, state.targetSeed.row, state.targetSeed.col);
}

function buildMoveCandidates(state) {
  const targetChain = getTargetChain(state);
  if (!targetChain) {
    return [];
  }

  const moves = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (state.board[row][col] !== ".") {
        continue;
      }

      const result = applyMove(state, {
        type: "play",
        row,
        col,
      });
      if (!result) {
        continue;
      }

      let score = 0;
      if (targetChain.liberties.some((point) => point.row === row && point.col === col)) {
        score += 30;
      }

      const adjacentTarget = listNeighbors(row, col).some((neighbor) =>
        chainContains(targetChain, neighbor.row, neighbor.col),
      );
      if (adjacentTarget) {
        score += 12;
      }

      score += result.captureEvents.reduce(
        (sum, event) => sum + event.stones.length * 18,
        0,
      );

      for (const neighbor of listNeighbors(row, col)) {
        if (state.board[neighbor.row][neighbor.col] === state.toMove) {
          score += 2;
        }
      }

      moves.push({
        move: { type: "play", row, col },
        result,
        score,
      });
    }
  }

  if (moves.length === 0) {
    const result = applyMove(state, { type: "pass" });
    moves.push({
      move: { type: "pass" },
      result,
      score: -1,
    });
  }

  sortMoves(moves, targetChain, state.toMove);
  return moves;
}

function createEvent(op, fields = {}) {
  return {
    op,
    ...fields,
  };
}

function emitEvent(trace, board, event, onEvent) {
  const snapshot = cloneBoard5x5(board);
  const payload = { ...event, snapshot };
  trace.push(payload);
  if (onEvent) {
    onEvent({ ...event }, snapshot);
  }
}

export function formatWeiqiEvent(event) {
  switch (event.op) {
    case "PLAY":
      return `PLAY ${event.player} ${formatCoord(event.row, event.col)}${
        event.captures > 0 ? ` capture=${event.captures}` : ""
      }`;
    case "CAPTURE":
      return `CAPTURE ${event.color} [${coordsToText(event.stones)}]`;
    case "UNDO":
      return event.move === "pass"
        ? `UNDO ${event.player} PASS`
        : `UNDO ${event.player} ${formatCoord(event.row, event.col)}`;
    case "PASS":
      return `PASS ${event.player}`;
    case "HALT":
      return `HALT ${event.reason}`;
    default:
      return event.op;
  }
}

export function buildProgram5x5(preset) {
  return [
    `BOARD 5x5 attacker=${preset.attacker} target=${preset.targetColor}@${formatCoord(
      preset.targetSeed.row,
      preset.targetSeed.col,
    )}`,
    "RULES liberties capture suicide-ko",
    "LOOP PLAY CAPTURE UNDO PASS",
    `HALT when target chain is removed within ${preset.maxPly} plies`,
  ];
}

export function getTargetOverlay(board, targetSeed, targetColor) {
  if (board[targetSeed.row][targetSeed.col] !== targetColor) {
    return [];
  }
  const chain = collectChain(board, targetSeed.row, targetSeed.col);
  return chain ? chain.stones : [];
}

export function solveWeiqiCapture(preset, options = {}) {
  const { onEvent } = options;
  const initialBoard = parseBoard5x5(preset.board);
  const trace = [];
  let solvedBoard = null;
  const stats = {
    nodes: 0,
    legalMoves: 0,
    captures: 0,
    undos: 0,
    passes: 0,
    maxDepth: 0,
  };

  function search(state) {
    stats.maxDepth = Math.max(stats.maxDepth, state.depth);

    if (isTargetCaptured(state)) {
      solvedBoard = cloneBoard5x5(state.board);
      emitEvent(
        trace,
        state.board,
        createEvent("HALT", {
          depth: state.depth,
          reason: "target_captured",
        }),
        onEvent,
      );
      return true;
    }

    if (state.depth >= preset.maxPly) {
      return false;
    }

    stats.nodes += 1;
    const moves = buildMoveCandidates(state);
    stats.legalMoves += moves.length;

    if (moves.length === 0) {
      return false;
    }

    if (state.toMove === preset.attacker) {
      for (const candidate of moves) {
        if (candidate.move.type === "pass") {
          stats.passes += 1;
          emitEvent(trace, state.board, candidate.result.passEvent, onEvent);
          if (search(candidate.result.nextState)) {
            return true;
          }
          emitEvent(
            trace,
            state.board,
            createEvent("UNDO", {
              player: state.toMove,
              move: "pass",
              depth: state.depth,
            }),
            onEvent,
          );
          stats.undos += 1;
          continue;
        }

        emitEvent(trace, candidate.result.nextState.board, candidate.result.playEvent, onEvent);
        for (const captureEvent of candidate.result.captureEvents) {
          stats.captures += captureEvent.stones.length;
          emitEvent(trace, candidate.result.nextState.board, captureEvent, onEvent);
        }
        if (search(candidate.result.nextState)) {
          return true;
        }
        emitEvent(
          trace,
          state.board,
          createEvent("UNDO", {
            player: state.toMove,
            row: candidate.move.row,
            col: candidate.move.col,
            depth: state.depth,
          }),
          onEvent,
        );
        stats.undos += 1;
      }

      return false;
    }

    for (const candidate of moves) {
      if (candidate.move.type === "pass") {
        stats.passes += 1;
        emitEvent(trace, state.board, candidate.result.passEvent, onEvent);
        if (!search(candidate.result.nextState)) {
          emitEvent(
            trace,
            state.board,
            createEvent("UNDO", {
              player: state.toMove,
              move: "pass",
              depth: state.depth,
            }),
            onEvent,
          );
          stats.undos += 1;
          return false;
        }
        emitEvent(
          trace,
          state.board,
          createEvent("UNDO", {
            player: state.toMove,
            move: "pass",
            depth: state.depth,
          }),
          onEvent,
        );
        stats.undos += 1;
        continue;
      }

      emitEvent(trace, candidate.result.nextState.board, candidate.result.playEvent, onEvent);
      for (const captureEvent of candidate.result.captureEvents) {
        stats.captures += captureEvent.stones.length;
        emitEvent(trace, candidate.result.nextState.board, captureEvent, onEvent);
      }
      if (!search(candidate.result.nextState)) {
        emitEvent(
          trace,
          state.board,
          createEvent("UNDO", {
            player: state.toMove,
            row: candidate.move.row,
            col: candidate.move.col,
            depth: state.depth,
          }),
          onEvent,
        );
        stats.undos += 1;
        return false;
      }
      emitEvent(
        trace,
        state.board,
        createEvent("UNDO", {
          player: state.toMove,
          row: candidate.move.row,
          col: candidate.move.col,
          depth: state.depth,
        }),
        onEvent,
      );
      stats.undos += 1;
    }

    return true;
  }

  const initialState = {
    board: initialBoard,
    toMove: preset.attacker,
    targetSeed: { ...preset.targetSeed },
    targetColor: preset.targetColor,
    koPoint: null,
    passes: 0,
    depth: 0,
  };

  const solved = search(initialState);
  const finalBoard =
    solvedBoard ?? (trace.length > 0 ? trace[trace.length - 1].snapshot : cloneBoard5x5(initialBoard));

  if (!solved) {
    emitEvent(
      trace,
      initialBoard,
      createEvent("HALT", {
        depth: 0,
        reason: "target_survived",
      }),
      onEvent,
    );
  }

  return {
    solved,
    board: finalBoard,
    initialBoard,
    givenMask: buildGivenMask5x5(initialBoard),
    trace,
    stats,
    overlay: getTargetOverlay(finalBoard, preset.targetSeed, preset.targetColor),
  };
}

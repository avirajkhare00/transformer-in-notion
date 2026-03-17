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

function describeSudokuModelArtifacts(modelInfo = {}) {
  const selectedModelId =
    modelInfo.selectedModelId === "transformer" ||
    modelInfo.selectedModelId === "transformer-regret" ||
    modelInfo.selectedModelId === "gnn"
      ? modelInfo.selectedModelId
      : "auto";
  const loadedModelId =
    modelInfo.loadedModelId === "transformer" ||
    modelInfo.loadedModelId === "transformer-regret" ||
    modelInfo.loadedModelId === "gnn"
      ? modelInfo.loadedModelId
      : null;
  const loadedModelLabel =
    typeof modelInfo.loadedModelLabel === "string" && modelInfo.loadedModelLabel
      ? modelInfo.loadedModelLabel
      : "";
  const loadedModelArtifactId =
    typeof modelInfo.loadedModelArtifactId === "string" && modelInfo.loadedModelArtifactId
      ? modelInfo.loadedModelArtifactId
      : "";

  const activeModelId = loadedModelId ?? selectedModelId;
  const activeModelLabel =
    loadedModelLabel ||
    (activeModelId === "gnn"
      ? "local value gnn"
      : activeModelId === "transformer-regret"
        ? "local regret transformer"
      : activeModelId === "transformer"
        ? "local value transformer"
        : "local value model");

  const badge =
    activeModelId === "gnn"
      ? "gnn + verifier"
      : activeModelId === "transformer-regret"
        ? "regret transformer + verifier"
      : activeModelId === "transformer"
        ? "transformer + verifier"
        : "model + verifier";

  const runtime =
    activeModelId === "gnn"
      ? "structured ONNX GNN policy + exact JS/WASM runtime"
      : activeModelId === "transformer-regret"
        ? "structured ONNX regret transformer policy + exact JS/WASM runtime"
      : activeModelId === "transformer"
        ? "structured ONNX transformer policy + exact JS/WASM runtime"
        : "structured ONNX value policy + exact JS/WASM runtime";

  let artifact = "soduku/models/extreme-value-gnn or extreme-value";
  if (selectedModelId === "gnn") {
    artifact = "soduku/models/extreme-value-gnn or hard-value-gnn";
  } else if (selectedModelId === "transformer-regret") {
    artifact = "soduku/models/extreme-value-regret-s64-r80-sharp12";
  } else if (selectedModelId === "transformer") {
    artifact = "soduku/models/extreme-value or hard-value-structured";
  }
  if (loadedModelArtifactId) {
    artifact = `soduku/models/${loadedModelArtifactId}`;
  }

  const call = "rank_candidates(board, focus, history_ops) -> ordered PLACE candidates";

  return {
    badge,
    runtime,
    artifact,
    call,
    modelLabel: activeModelLabel,
    loadingLabel:
      selectedModelId === "gnn"
        ? "local value gnn"
        : selectedModelId === "transformer-regret"
          ? "local regret transformer"
        : selectedModelId === "transformer"
          ? "local value transformer"
          : "local value model",
  };
}

export function buildTicTacToeExecutorArtifacts(board, analysis, locked) {
  const prompt = [
    "Need the safest reply for O.",
    `Board: ${renderTicTacToeBoard(board)}`,
    analysis?.runtime ? `Runtime: ${analysis.runtime}` : "Runtime: local transformer policy.",
  ].join("\n");

  const tool = {
    name: "text-classification",
    badge: "local model",
    runtime: analysis?.runtime ?? "transformers.js + onnx wasm",
    artifact: "models/tictactoe-bert/onnx/model.onnx",
    call: "classify(board_tokens) -> legal move logits",
  };

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
    tool,
    program,
    trace: traceLines.join("\n"),
  };
}

export function buildSudokuExecutorArtifacts(initialBoard, result, stepIndex, modelInfo = {}) {
  const modelArtifacts = describeSudokuModelArtifacts(modelInfo);
  const prompt = [
    `Solve 9x9 Sudoku with ${countClues(initialBoard)} clues.`,
    result
      ? `Runtime: ${modelArtifacts.modelLabel} + exact browser-side verifier.`
      : `Runtime: loading ${modelArtifacts.loadingLabel} + exact browser-side verifier.`,
    "Strategy: MRV picks the cell, the model ranks legal values, the exact runtime backtracks on contradiction.",
    `Preview row 1: ${renderSudokuRow(initialBoard[0])}`,
  ].join("\n");

  const tool = {
    name: "guided_solve()",
    badge: modelArtifacts.badge,
    runtime: modelArtifacts.runtime,
    artifact: modelArtifacts.artifact,
    call: modelArtifacts.call,
  };

  const program = [
    "{",
    "  load_grid",
    "  select_mrv_cell",
    "  enumerate_legal_values",
    "  model_rank_legal_values",
    "  exact_place_or_backtrack",
    "  halt_when_full",
    "}",
  ].join("\n");

  if (!result) {
    return {
      prompt,
      tool,
      program,
      trace: "waiting for guided runtime trace...",
    };
  }

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
    tool,
    program,
    trace,
  };
}

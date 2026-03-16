const TRANSFORMERS_CDN =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";
const MODEL_ID = "tictactoe-bert";

let runtimePromise = null;
let classifierPromise = null;

function boardToText(board) {
  return board.map((cell) => cell || ".").join(" ");
}

function listLegalMoves(board) {
  return board.flatMap((cell, index) => (cell ? [] : [index]));
}

function parseMoveLabel(label) {
  const match = /(\d+)$/.exec(String(label));
  return match ? Number(match[1]) : null;
}

async function getRuntime() {
  if (!runtimePromise) {
    runtimePromise = import(TRANSFORMERS_CDN);
  }
  return runtimePromise;
}

async function loadClassifier() {
  if (!classifierPromise) {
    classifierPromise = (async () => {
      const { env, pipeline } = await getRuntime();
      env.allowLocalModels = true;
      env.allowRemoteModels = false;
      env.localModelPath = new URL("../models/", import.meta.url).pathname;

      return pipeline("text-classification", MODEL_ID, {
        local_files_only: true,
        device: "wasm",
      });
    })();
  }
  return classifierPromise;
}

function normalizeClassifierOutput(result) {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0];
  }
  return result;
}

function probabilityLabel(score) {
  if (score >= 0.85) {
    return "very sure";
  }
  if (score >= 0.6) {
    return "likely";
  }
  if (score >= 0.35) {
    return "live option";
  }
  return "fallback";
}

export async function warmTicTacToeModel() {
  await loadClassifier();
}

export async function analyzeTicTacToeWithModel(board) {
  const classifier = await loadClassifier();
  const results = normalizeClassifierOutput(
    await classifier(boardToText(board), {
      top_k: 9,
    })
  );

  const legalMoves = new Set(listLegalMoves(board));
  const options = results
    .map((item) => {
      const move = parseMoveLabel(item.label);
      if (move == null || !legalMoves.has(move)) {
        return null;
      }

      return {
        move,
        score: item.score,
        label: probabilityLabel(item.score),
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);

  return {
    bestMove: options[0]?.move ?? null,
    options,
    engine: "local transformer",
    runtime: "transformers.js + onnx wasm",
    input: boardToText(board),
  };
}

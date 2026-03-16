const ORT_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/+esm";

let ortPromise = null;

function toInt32Tensor(ort, values, dims) {
  return new ort.Tensor("int32", Int32Array.from(values), dims);
}

export async function getOrtRuntime() {
  if (!ortPromise) {
    ortPromise = import(ORT_CDN);
  }
  return ortPromise;
}

export function buildStructuredFeeds(ort, states) {
  const batch = Array.isArray(states) ? states : [states];
  const batchSize = batch.length;
  const boardTokens = [];
  const focusRow = [];
  const focusCol = [];
  const candidateMask = [];
  const historyOps = [];
  const filledCount = [];
  const searchDepth = [];

  batch.forEach((state) => {
    boardTokens.push(...state.boardTokens);
    focusRow.push(state.focusRow);
    focusCol.push(state.focusCol);
    candidateMask.push(...state.candidateMask);
    historyOps.push(...state.historyOps);
    filledCount.push(state.filledCount);
    searchDepth.push(state.searchDepth ?? 0);
  });

  return {
    board_tokens: toInt32Tensor(ort, boardTokens, [batchSize, 81]),
    focus_row: toInt32Tensor(ort, focusRow, [batchSize]),
    focus_col: toInt32Tensor(ort, focusCol, [batchSize]),
    candidate_mask: toInt32Tensor(ort, candidateMask, [batchSize, 9]),
    history_ops: toInt32Tensor(ort, historyOps, [batchSize, 8]),
    filled_count: toInt32Tensor(ort, filledCount, [batchSize]),
    search_depth: toInt32Tensor(ort, searchDepth, [batchSize]),
  };
}

export function softmax(logits) {
  const peak = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - peak));
  const sum = exps.reduce((total, value) => total + value, 0);
  return exps.map((value) => value / sum);
}

export function topK(scores, labels, limit) {
  return scores
    .map((score, index) => ({
      label: labels[index],
      score,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

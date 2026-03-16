import { HARD_VALUE_LABELS } from "./hard-op-context.mjs";
import { buildStructuredFeeds, getOrtRuntime, softmax, topK } from "./structured-onnx.mjs";

const MODEL_URL = new URL("./models/hard-value-structured/onnx/model_quantized.onnx", import.meta.url);

let sessionPromise = null;

async function loadSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await getOrtRuntime();
      ort.env.wasm.numThreads = 1;
      return ort.InferenceSession.create(MODEL_URL.href, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
    })();
  }
  return sessionPromise;
}

function normalizeLogits(logitsData, batchSize) {
  const classCount = HARD_VALUE_LABELS.length;
  const rows = [];
  for (let index = 0; index < batchSize; index += 1) {
    const start = index * classCount;
    rows.push(Array.from(logitsData.slice(start, start + classCount)));
  }
  return rows;
}

function decodeLogits(batchLogits, topKLimit) {
  return batchLogits.map((logits) =>
    topK(softmax(logits), HARD_VALUE_LABELS, topKLimit).map((item) => ({
      value: Number(item.label),
      score: item.score,
    }))
  );
}

export async function warmHardSudokuValueModel() {
  await loadSession();
}

export async function predictHardSudokuPlaceValues(
  contexts,
  topKLimit = 9,
  batchSize = 256,
  onProgress = null
) {
  const session = await loadSession();
  const ort = await getOrtRuntime();
  const inputs = Array.isArray(contexts) ? contexts : [contexts];
  const allPredictions = [];

  if (inputs.length === 0) {
    return allPredictions;
  }

  for (let index = 0; index < inputs.length; index += batchSize) {
    const batch = inputs.slice(index, index + batchSize);
    const feeds = buildStructuredFeeds(ort, batch);
    const output = await session.run(feeds);
    const logits = output.logits ?? output[session.outputNames[0]];
    const decoded = decodeLogits(normalizeLogits(logits.data, batch.length), topKLimit);
    allPredictions.push(...decoded);

    if (typeof onProgress === "function") {
      onProgress({
        completed: Math.min(index + batch.length, inputs.length),
        total: inputs.length,
      });
    }
  }

  return allPredictions;
}

export async function predictHardSudokuPlaceValue(context, topKLimit = 9) {
  const [predictions] = await predictHardSudokuPlaceValues([context], topKLimit, 1);
  return predictions;
}

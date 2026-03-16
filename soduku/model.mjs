import { HARD_OP_LABELS } from "./hard-op-context.mjs";
import {
  buildStructuredFeeds,
  fetchStructuredModel,
  getOrtRuntime,
  softmax,
  topK,
} from "./structured-onnx.mjs";

const MODEL_URLS = [
  new URL("./models/extreme-op/onnx/model_quantized.onnx", import.meta.url),
  new URL("./models/hard-op-structured/onnx/model_quantized.onnx", import.meta.url),
];

let sessionPromise = null;

async function loadSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await getOrtRuntime();
      ort.env.wasm.numThreads = 1;
      let lastError = null;
      for (const modelUrl of MODEL_URLS) {
        try {
          const modelBytes = await fetchStructuredModel(modelUrl.href);
          return await ort.InferenceSession.create(modelBytes, {
            executionProviders: ["wasm"],
            graphOptimizationLevel: "all",
          });
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError ?? new Error("Unable to load a structured op model.");
    })();
  }
  return sessionPromise;
}

function decodeLogits(batchLogits, topKLimit) {
  return batchLogits.map((logits) =>
    topK(softmax(logits), HARD_OP_LABELS, topKLimit).map((item) => ({
      op: item.label,
      score: item.score,
    }))
  );
}

function normalizeLogits(logitsData, batchSize) {
  const classCount = HARD_OP_LABELS.length;
  const rows = [];
  for (let index = 0; index < batchSize; index += 1) {
    const start = index * classCount;
    rows.push(Array.from(logitsData.slice(start, start + classCount)));
  }
  return rows;
}

export async function warmHardSudokuModel() {
  await loadSession();
}

export async function predictHardSudokuNextOps(
  contexts,
  topKLimit = 3,
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

export async function predictHardSudokuNextOp(context, topKLimit = 3) {
  const [predictions] = await predictHardSudokuNextOps([context], topKLimit, 1);
  return predictions;
}

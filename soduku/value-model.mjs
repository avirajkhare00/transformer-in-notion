import { HARD_VALUE_LABELS } from "./hard-op-context.mjs";
import {
  buildStructuredFeeds,
  getOrtRuntime,
  softmax,
  topK,
} from "./structured-onnx.mjs";

const MODEL_REGISTRY = Object.freeze({
  auto: [
    {
      modelId: "gnn",
      modelLabel: "local value gnn",
      modelArtifactId: "extreme-value-gnn",
      modelUrl: new URL("./models/extreme-value-gnn/onnx/model_quantized.onnx", import.meta.url),
    },
    {
      modelId: "gnn",
      modelLabel: "local value gnn",
      modelArtifactId: "hard-value-gnn",
      modelUrl: new URL("./models/hard-value-gnn/onnx/model_quantized.onnx", import.meta.url),
    },
    {
      modelId: "transformer",
      modelLabel: "local value transformer",
      modelArtifactId: "extreme-value",
      modelUrl: new URL("./models/extreme-value/onnx/model_quantized.onnx", import.meta.url),
    },
    {
      modelId: "transformer",
      modelLabel: "local value transformer",
      modelArtifactId: "hard-value-structured",
      modelUrl: new URL("./models/hard-value-structured/onnx/model_quantized.onnx", import.meta.url),
    },
  ],
  transformer: [
    {
      modelId: "transformer",
      modelLabel: "local value transformer",
      modelArtifactId: "extreme-value",
      modelUrl: new URL("./models/extreme-value/onnx/model_quantized.onnx", import.meta.url),
    },
    {
      modelId: "transformer",
      modelLabel: "local value transformer",
      modelArtifactId: "hard-value-structured",
      modelUrl: new URL("./models/hard-value-structured/onnx/model_quantized.onnx", import.meta.url),
    },
  ],
  "transformer-regret": [
    {
      modelId: "transformer-regret",
      modelLabel: "local regret transformer",
      modelArtifactId: "extreme-value-regret-s64-r80-sharp12",
      modelUrl: new URL(
        "./models/extreme-value-regret-s64-r80-sharp12/onnx/model_quantized.onnx",
        import.meta.url
      ),
    },
  ],
  "transformer-hard": [
    {
      modelId: "transformer-hard",
      modelLabel: "local hard-set transformer",
      modelArtifactId: "hard-value-policy-soft",
      modelUrl: new URL(
        "./models/hard-value-policy-soft/onnx/model_quantized.onnx",
        import.meta.url
      ),
    },
  ],
  gnn: [
    {
      modelId: "gnn",
      modelLabel: "local value gnn",
      modelArtifactId: "extreme-value-gnn",
      modelUrl: new URL("./models/extreme-value-gnn/onnx/model_quantized.onnx", import.meta.url),
    },
    {
      modelId: "gnn",
      modelLabel: "local value gnn",
      modelArtifactId: "hard-value-gnn",
      modelUrl: new URL("./models/hard-value-gnn/onnx/model_quantized.onnx", import.meta.url),
    },
  ],
});

const sessionPromiseByUrl = new Map();

function normalizeModelSelection(modelSelectionId) {
  return MODEL_REGISTRY[modelSelectionId] ? modelSelectionId : "auto";
}

async function getOrCreateSession(candidate) {
  const cacheKey = candidate.modelUrl.href;
  if (!sessionPromiseByUrl.has(cacheKey)) {
    const sessionPromise = (async () => {
      const ort = await getOrtRuntime();
      ort.env.wasm.numThreads = 1;
      return ort.InferenceSession.create(candidate.modelUrl.href, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
    })().catch((error) => {
      sessionPromiseByUrl.delete(cacheKey);
      throw error;
    });
    sessionPromiseByUrl.set(cacheKey, sessionPromise);
  }
  return sessionPromiseByUrl.get(cacheKey);
}

async function loadSession(modelSelectionId = "auto") {
  const selectionId = normalizeModelSelection(modelSelectionId);
  let lastError = null;
  for (const candidate of MODEL_REGISTRY[selectionId]) {
    try {
      const session = await getOrCreateSession(candidate);
      return {
        session,
        requestedModelId: selectionId,
        modelId: candidate.modelId,
        modelLabel: candidate.modelLabel,
        modelArtifactId: candidate.modelArtifactId,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Unable to load a structured value model.");
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

export async function warmHardSudokuValueModel(modelSelectionId = "auto") {
  return loadSession(modelSelectionId);
}

export async function predictHardSudokuPlaceValues(
  contexts,
  topKLimit = 9,
  batchSize = 256,
  onProgress = null,
  modelSelectionId = "auto"
) {
  const { session } = await loadSession(modelSelectionId);
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

export async function predictHardSudokuPlaceValue(
  context,
  topKLimit = 9,
  modelSelectionId = "auto"
) {
  const [predictions] = await predictHardSudokuPlaceValues(
    [context],
    topKLimit,
    1,
    null,
    modelSelectionId
  );
  return predictions;
}

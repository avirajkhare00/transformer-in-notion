const TRANSFORMERS_CDN =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";
const MODEL_ID = "hard-value-bert";

let runtimePromise = null;
let classifierPromise = null;

function normalizeClassifierBatchOutput(result) {
  if (!Array.isArray(result)) {
    return [];
  }
  if (result.length === 0) {
    return [];
  }
  if (Array.isArray(result[0])) {
    return result;
  }
  return [result];
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
      env.localModelPath = new URL("./models/", import.meta.url).pathname;

      return pipeline("text-classification", MODEL_ID, {
        local_files_only: true,
        device: "wasm",
        dtype: "fp32",
      });
    })();
  }
  return classifierPromise;
}

export async function warmHardSudokuValueModel() {
  await loadClassifier();
}

export async function predictHardSudokuPlaceValues(contexts, topK = 9, batchSize = 128) {
  const classifier = await loadClassifier();
  const inputs = Array.isArray(contexts) ? contexts : [contexts];
  const allPredictions = [];

  for (let index = 0; index < inputs.length; index += batchSize) {
    const batch = inputs.slice(index, index + batchSize);
    const results = normalizeClassifierBatchOutput(
      await classifier(batch, {
        top_k: topK,
      })
    );
    allPredictions.push(
      ...results.map((items) =>
        items.map((item) => ({
          value: Number(item.label),
          score: item.score,
        }))
      )
    );
  }

  return allPredictions;
}

export async function predictHardSudokuPlaceValue(context, topK = 9) {
  const [predictions] = await predictHardSudokuPlaceValues([context], topK, 1);
  return predictions;
}

const TRANSFORMERS_CDN =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";
const MODEL_ID = "invoice-total-selector";

let runtimePromise = null;
let classifierPromise = null;

function normalizeClassifierOutput(result) {
  if (Array.isArray(result) && Array.isArray(result[0])) {
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

function normalizeCandidatePrediction(result) {
  const items = Array.isArray(result) ? result : [result];
  const scores = new Map(items.map((item) => [item.label, item.score]));
  return {
    totalScore: scores.get("TOTAL") ?? 0,
    notTotalScore: scores.get("NOT_TOTAL") ?? 0,
    scores: items,
  };
}

export async function warmReceiptTotalModel() {
  await loadClassifier();
}

export async function predictReceiptTotalCandidates(contexts) {
  const classifier = await loadClassifier();
  const results = normalizeClassifierOutput(
    await classifier(Array.isArray(contexts) ? contexts : [contexts], {
      top_k: 2,
    }),
  );

  return results.map(normalizeCandidatePrediction);
}

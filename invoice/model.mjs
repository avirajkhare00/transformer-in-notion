const TRANSFORMERS_CDN =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";
const MODEL_ID = "invoice-op-bert";

let runtimePromise = null;
let classifierPromise = null;

function normalizeClassifierOutput(result) {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0];
  }
  return result;
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

export async function warmInvoiceModel() {
  await loadClassifier();
}

export async function predictInvoiceNextOp(context, topK = 9) {
  const classifier = await loadClassifier();
  const results = normalizeClassifierOutput(
    await classifier(context, {
      top_k: topK,
    }),
  );

  return results.map((item) => ({
    op: item.label,
    score: item.score,
  }));
}

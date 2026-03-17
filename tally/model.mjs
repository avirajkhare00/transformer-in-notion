import {
  TALLY_FIELD_SELECTOR_MODEL_ID,
  applyTallyFieldPredictions,
  buildTallyFieldModelExamples,
} from "./model-common.mjs";

const TRANSFORMERS_CDN =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";

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
      try {
        const { env, pipeline } = await getRuntime();
        env.allowLocalModels = true;
        env.allowRemoteModels = false;
        env.localModelPath = new URL("./models/", import.meta.url).pathname;

        return pipeline("text-classification", TALLY_FIELD_SELECTOR_MODEL_ID, {
          local_files_only: true,
          device: "wasm",
          dtype: "fp32",
        });
      } catch (error) {
        throw new Error(
          `Failed to load the local Tally field model. Train/export tally/train_field_selector.py first. ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })();
  }
  return classifierPromise;
}

function normalizeCandidatePrediction(result) {
  const items = Array.isArray(result) ? result : [result];
  const scores = new Map(items.map((item) => [item.label, item.score]));
  return {
    selectedScore: scores.get("SELECTED") ?? 0,
    notSelectedScore: scores.get("NOT_SELECTED") ?? 0,
    scores: items,
  };
}

export async function warmTallyFieldModel() {
  await loadClassifier();
}

export async function predictTallyFieldCandidates(contexts) {
  const classifier = await loadClassifier();
  const results = normalizeClassifierOutput(
    await classifier(Array.isArray(contexts) ? contexts : [contexts], {
      top_k: 2,
    }),
  );

  return results.map(normalizeCandidatePrediction);
}

export async function selectTallyFieldsWithModel(state) {
  const examples = buildTallyFieldModelExamples(state);
  if (examples.length === 0) {
    return applyTallyFieldPredictions(state, [], []);
  }

  const predictions = await predictTallyFieldCandidates(
    examples.map((example) => example.context),
  );
  return applyTallyFieldPredictions(state, examples, predictions);
}

import { parsePdftotextTsv } from "../invoice/ocr_layout.mjs";
import { selectTallyFieldsWithModel, warmTallyFieldModel } from "./model.mjs";
import { buildTallyExtractionState, buildTallyRecord, runTallyExtractionPsvm } from "./psvm.mjs";

const TSV_HEADER =
  "level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";

const DISPLAY_FIELD_ORDER = Object.freeze([
  "document.number",
  "document.date",
  "document.currency",
  "document.place_of_supply",
  "seller.name",
  "seller.gstin",
  "buyer.name",
  "buyer.gstin",
  "consignee.name",
  "consignee.gstin",
  "amounts.taxable_amount_cents",
  "amounts.subtotal_cents",
  "taxes.igst_cents",
  "taxes.cgst_cents",
  "taxes.sgst_cents",
  "taxes.cess_cents",
  "amounts.discount_cents",
  "amounts.round_off_cents",
  "amounts.grand_total_cents",
]);

function detectFormat(source, requestedFormat) {
  if (requestedFormat === "text" || requestedFormat === "tsv") {
    return requestedFormat;
  }

  const trimmed = String(source ?? "").trimStart();
  return trimmed.startsWith(TSV_HEADER) ? "tsv" : "text";
}

function parseSource(source, format) {
  if (format === "tsv") {
    return parsePdftotextTsv(source);
  }
  return String(source ?? "");
}

function formatCents(value) {
  return `Rs. ${new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100)}`;
}

function formatFieldValue(fieldId, value, candidate) {
  if (fieldId.endsWith("_cents") && typeof value === "number") {
    return formatCents(value);
  }

  if (typeof candidate?.displayValue === "string" && candidate.displayValue.trim()) {
    return candidate.displayValue;
  }

  return String(value);
}

function fieldSortOrder(fieldId) {
  const index = DISPLAY_FIELD_ORDER.indexOf(fieldId);
  return index === -1 ? DISPLAY_FIELD_ORDER.length : index;
}

function buildSelectedFieldEntries(selectedFields, fieldCandidates) {
  return Object.entries(selectedFields)
    .filter(([fieldId, value]) => fieldId !== "document.voucher_family" && value !== null && value !== undefined)
    .map(([fieldId, value]) => {
      const topCandidate = fieldCandidates[fieldId]?.[0] ?? null;
      return {
        fieldId,
        value,
        displayValue: formatFieldValue(fieldId, value, topCandidate),
        source: topCandidate?.source ?? "runtime",
        modelScore: topCandidate?.selectedScore ?? null,
      };
    })
    .sort((left, right) => {
      const orderDelta = fieldSortOrder(left.fieldId) - fieldSortOrder(right.fieldId);
      if (orderDelta !== 0) {
        return orderDelta;
      }
      return left.fieldId.localeCompare(right.fieldId);
    });
}

function buildTeacherPayload(parsedSource) {
  const execution = runTallyExtractionPsvm(parsedSource);
  return {
    engine: "teacher",
    state: execution.state,
    result: execution.result,
    selectedFieldEntries: buildSelectedFieldEntries(
      execution.state.selectedFields,
      execution.state.fieldCandidates,
    ),
    modelStats: null,
  };
}

async function buildModelPayload(parsedSource) {
  const state = buildTallyExtractionState(parsedSource);
  await warmTallyFieldModel();
  const selection = await selectTallyFieldsWithModel(state);
  return {
    engine: "model",
    state,
    result: buildTallyRecord(state, selection.selectedFields),
    selectedFieldEntries: buildSelectedFieldEntries(
      selection.selectedFields,
      selection.rankedFieldCandidates,
    ),
    modelStats: selection.modelStats,
  };
}

async function handleRun(data) {
  const startedAt = performance.now();

  try {
    if (data.inputKind === "pdf" || /\.pdf$/i.test(data.fileName ?? "")) {
      throw new Error(
        "PDF conversion is not supported in this demo. Paste OCR text or pdftotext TSV instead.",
      );
    }

    const source = String(data.source ?? "");
    if (!source.trim()) {
      throw new Error("Paste OCR text or pdftotext TSV before running the demo.");
    }

    const format = detectFormat(source, data.format ?? "auto");
    const parsedSource = parseSource(source, format);
    const execution =
      data.engine === "model"
        ? await buildModelPayload(parsedSource)
        : buildTeacherPayload(parsedSource);

    self.postMessage({
      type: "done",
      engine: execution.engine,
      inputFormat: format,
      pageCount: execution.state.pageCount,
      lineCount: execution.state.lines.length,
      voucherFamily: execution.state.voucherFamily,
      voucherLabel: execution.state.schema.voucherLabel,
      industry: execution.state.industry,
      supported: execution.state.schema.supported,
      rejectionReason: execution.state.schema.rejectionReason ?? null,
      selectedFieldCount: execution.selectedFieldEntries.length,
      lineItemCount: execution.result.lineItems.length,
      elapsedMs: Math.round(performance.now() - startedAt),
      result: execution.result,
      selectedFieldEntries: execution.selectedFieldEntries,
      modelStats: execution.modelStats,
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

self.onmessage = (message) => {
  const { data } = message;
  if (!data || data.type !== "run") {
    return;
  }

  void handleRun(data);
};

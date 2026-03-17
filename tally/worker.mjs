import { parsePdftotextTsv } from "../invoice/ocr_layout.mjs";
import { TALLY_VOUCHER_FAMILIES } from "./schema.mjs";
import { runTallyExtractionPsvm } from "./psvm.mjs";

const TSV_HEADER =
  "level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";

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

function serializeVoucherFamily(family) {
  return {
    voucherFamily: family.voucherFamily,
    label: family.label,
    supported: family.supported,
    score: family.score,
    reasons: [...family.reasons],
  };
}

function serializeCandidate(candidate) {
  return {
    value: candidate.value,
    normalizedValue: candidate.normalizedValue,
    displayValue: candidate.displayValue,
    score: candidate.score,
    source: candidate.source,
    lineIndex: candidate.lineIndex,
    lineText: candidate.lineText,
    itemIndex: candidate.itemIndex,
    reason: candidate.reason,
  };
}

function buildSelectedFieldEntries(selectedFields, fieldCandidates) {
  return Object.entries(selectedFields)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([fieldId, value]) => ({
      fieldId,
      value,
      displayValue:
        fieldCandidates[fieldId]?.[0]?.displayValue ??
        (fieldId === "document.voucher_family"
          ? TALLY_VOUCHER_FAMILIES[value]?.label ?? String(value)
          : String(value)),
      source: fieldCandidates[fieldId]?.[0]?.source ?? "runtime",
    }))
    .sort((left, right) => left.fieldId.localeCompare(right.fieldId));
}

function buildFieldGroups(fieldCandidates) {
  return Object.entries(fieldCandidates)
    .map(([fieldId, candidates]) => ({
      fieldId,
      candidateCount: candidates.length,
      topCandidate: candidates[0] ? serializeCandidate(candidates[0]) : null,
      candidates: candidates.slice(0, 6).map(serializeCandidate),
    }))
    .sort((left, right) => {
      const leftScore = left.topCandidate?.score ?? Number.NEGATIVE_INFINITY;
      const rightScore = right.topCandidate?.score ?? Number.NEGATIVE_INFINITY;
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      return left.fieldId.localeCompare(right.fieldId);
    });
}

function countSelectedFields(selectedFieldEntries) {
  return selectedFieldEntries.length;
}

function formatTraceLine(step) {
  switch (step.op) {
    case "CLASSIFY_VOUCHER_FAMILY":
      return `CLASSIFY_VOUCHER_FAMILY -> ${step.rankedFamilies
        .map((family) => `${family.voucherFamily} ${family.score}`)
        .join(" · ")}`;
    case "SELECT_SCHEMA":
      return `SELECT_SCHEMA -> ${step.voucherFamily} / ${step.industry} / ${
        step.supported ? "supported" : "reject"
      }`;
    case "EXTRACT_FIELD_CANDIDATES":
      return `EXTRACT_FIELD_CANDIDATES -> ${step.topFields
        .map((field) => `${field.fieldId}=${field.topCandidate ?? "missing"}`)
        .join(" · ")}`;
    case "EMIT_TALLY_RECORD":
      return `EMIT_TALLY_RECORD -> ${step.recordSummary.voucherFamily} ${
        step.recordSummary.documentNumber ?? "no-number"
      } total=${step.recordSummary.grandTotalCents ?? "n/a"}`;
    case "HALT":
      return "HALT";
    default:
      return step.op;
  }
}

function buildToolPayload(execution, format) {
  return {
    name: "tally_extraction_psvm",
    inputFormat: format,
    pages: execution.state.pageCount,
    lines: execution.state.lines.length,
    voucherFamily: execution.state.voucherFamily,
    industry: execution.state.industry,
    supported: execution.state.schema.supported,
    fieldGroups: Object.keys(execution.state.fieldCandidates).length,
    validators: execution.state.schema.validators.length,
  };
}

async function handleRun(data) {
  const startedAt = performance.now();

  try {
    const source = String(data.source ?? "");
    if (!source.trim()) {
      throw new Error("Paste OCR text or pdftotext TSV before running the demo.");
    }

    const format = detectFormat(source, data.format ?? "auto");
    const parsedSource = parseSource(source, format);
    const voucherFamily =
      data.familyOverride && data.familyOverride !== "auto" ? data.familyOverride : undefined;
    const industry =
      data.industryOverride && data.industryOverride !== "auto"
        ? data.industryOverride
        : undefined;

    const execution = runTallyExtractionPsvm(parsedSource, {
      voucherFamily,
      industry,
    });
    const selectedFieldEntries = buildSelectedFieldEntries(
      execution.state.selectedFields,
      execution.state.fieldCandidates,
    );
    const fieldGroups = buildFieldGroups(execution.state.fieldCandidates);

    self.postMessage({
      type: "done",
      inputFormat: format,
      pageCount: execution.state.pageCount,
      lineCount: execution.state.lines.length,
      voucherFamily: execution.state.voucherFamily,
      voucherLabel: execution.state.schema.voucherLabel,
      industry: execution.state.industry,
      supported: execution.state.schema.supported,
      rejectionReason: execution.state.schema.rejectionReason ?? null,
      fieldGroupCount: fieldGroups.length,
      selectedFieldCount: countSelectedFields(selectedFieldEntries),
      lineItemCount: execution.result.lineItems.length,
      elapsedMs: Math.round(performance.now() - startedAt),
      program: execution.program,
      result: execution.result,
      rankedFamilies: execution.state.rankedVoucherFamilies.map(serializeVoucherFamily),
      selectedFieldEntries,
      fieldGroups,
      schemaSummary: {
        validators: [...execution.state.schema.validators],
        documentFields: execution.state.schema.fields.document.length,
        partyFields: execution.state.schema.fields.parties.length,
        amountFields: execution.state.schema.fields.amounts.length,
        taxFields: execution.state.schema.fields.taxes.length,
        lineItemFields: execution.state.schema.fields.lineItems.length,
      },
      traceLines: execution.trace.map(formatTraceLine),
      trace: execution.trace,
      prompt:
        "From noisy OCR and layout, classify the voucher family, pick legal field candidates, and emit a Tally-shaped structured record. Reject unsupported families when needed.",
      tool: buildToolPayload(execution, format),
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

import { buildPlainTextReceiptSource, collapseWhitespace } from "./ocr_layout.mjs";
import { parseReceiptText } from "./receipt.mjs";
import { buildTallyVoucherSchema, TALLY_VOUCHER_FAMILIES } from "./tally_schema.mjs";
import { extractReceiptAmountCandidates, rankReceiptTotalCandidates } from "./total_psvm.mjs";

const GSTIN_PATTERN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/g;
const GSTIN_VALUE_PATTERN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/;
const DATE_VALUE_PATTERN =
  /^(?:\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}-[A-Za-z]{3}-\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})$/;
const COMPANY_SUFFIX_PATTERN = /\b(?:LLP|LTD\.?|LIMITED|PRIVATE LIMITED|PVT\.?\s+LTD\.?)\b/i;
const MONEY_TOKEN_PATTERN = /(?:₹\s*)?(?:Rs\.?\s*)?[0-9][0-9,]*\.\d{2}/;
const PARTY_HEADING_PATTERN =
  /\b(?:buyer|bill to|sold to|consignee|ship to|supplier|seller|from)\b/i;
const PARTY_METADATA_PATTERN =
  /\b(?:gstin|gst no|uin|invoice|date|ack|e-way|amount|total|subtotal|tax|place of supply|state|phone|email|bank|branch|declaration)\b/i;
const STATEMENT_HEADER_PATTERN =
  /\b(?:account statement|bank statement|statement of account|mini statement|ledger statement)\b/i;
const STATEMENT_BALANCE_PATTERN =
  /\b(?:opening balance|closing balance|available balance|ledger balance|running balance)\b/i;
const STATEMENT_COLUMN_PATTERN =
  /\b(?:debit|credit|withdrawal|deposit|narration|transaction|txn|cheque|utr|imps|neft|upi|balance)\b/i;
const UNKNOWN_FAMILY_THRESHOLD = 1;

export const TALLY_EXTRACTION_PSVM_OPS = Object.freeze([
  "CLASSIFY_VOUCHER_FAMILY",
  "SELECT_SCHEMA",
  "EXTRACT_FIELD_CANDIDATES",
  "EMIT_TALLY_RECORD",
  "HALT",
]);

function isStructuredSource(value) {
  return Boolean(value) && typeof value === "object" && Array.isArray(value.rows);
}

function normalizeRowText(row) {
  if (typeof row?.text === "string") {
    return collapseWhitespace(row.text);
  }

  if (Array.isArray(row?.words)) {
    return collapseWhitespace(row.words.map((word) => word.text ?? "").join(" "));
  }

  return "";
}

function normalizeTallySource(source) {
  if (typeof source === "string") {
    return buildPlainTextReceiptSource(source);
  }

  if (!isStructuredSource(source)) {
    throw new Error("Tally OCR source must be a string or structured OCR payload.");
  }

  const rows = source.rows.map((row, rowIndex) => ({
    ...row,
    rowIndex: Number.isInteger(row?.rowIndex) ? row.rowIndex : rowIndex,
    text: normalizeRowText(row),
  }));

  return {
    kind: "receipt_ocr_source",
    pageCount:
      Number.isInteger(source.pageCount) && source.pageCount > 0
        ? source.pageCount
        : Math.max(1, ...rows.map((row) => (Number.isInteger(row.pageIndex) ? row.pageIndex + 1 : 1))),
    text:
      typeof source.text === "string" && source.text.trim()
        ? source.text
        : rows.map((row) => row.text).filter(Boolean).join("\n"),
    rows,
  };
}

function createCandidate(fieldId, value, options = {}) {
  return {
    fieldId,
    value,
    normalizedValue: options.normalizedValue ?? value,
    displayValue: options.displayValue ?? String(value),
    score: options.score ?? 0,
    source: options.source ?? "heuristic",
    lineIndex: Number.isInteger(options.lineIndex) ? options.lineIndex : null,
    lineText: typeof options.lineText === "string" ? options.lineText : null,
    itemIndex: Number.isInteger(options.itemIndex) ? options.itemIndex : null,
    reason: options.reason ?? "",
  };
}

function pushCandidate(candidateMap, fieldId, candidate) {
  if (!candidate) {
    return;
  }

  const existing = candidateMap.get(fieldId) ?? [];
  existing.push(candidate);
  candidateMap.set(fieldId, existing);
}

function pushCandidates(candidateMap, fieldId, candidates) {
  for (const candidate of candidates) {
    pushCandidate(candidateMap, fieldId, candidate);
  }
}

function sortCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (left.lineIndex !== right.lineIndex) {
      return (left.lineIndex ?? Number.MAX_SAFE_INTEGER) - (right.lineIndex ?? Number.MAX_SAFE_INTEGER);
    }
    if (left.itemIndex !== right.itemIndex) {
      return (left.itemIndex ?? Number.MAX_SAFE_INTEGER) - (right.itemIndex ?? Number.MAX_SAFE_INTEGER);
    }
    return String(left.displayValue).localeCompare(String(right.displayValue));
  });
}

function cleanFieldCandidate(value) {
  return collapseWhitespace(String(value).replace(/^[:\s-]+/, ""));
}

function countPatternMatches(text, pattern) {
  const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  return [...text.matchAll(regex)].length;
}

function findHeadingRole(line) {
  if (/\b(?:consignee|ship to)\b/i.test(line)) {
    return "consignee";
  }
  if (/\b(?:buyer|bill to|sold to)\b/i.test(line)) {
    return "buyer";
  }
  if (/\b(?:supplier|seller|from)\b/i.test(line)) {
    return "seller";
  }
  return null;
}

function buildHeadingMarkers(lines) {
  return lines
    .map((line, index) => ({
      index,
      role: findHeadingRole(line),
    }))
    .filter((entry) => entry.role);
}

function inferPartyRoleForLine(lineIndex, headingMarkers, lineCount) {
  const closeHeading = [...headingMarkers]
    .reverse()
    .find((marker) => lineIndex > marker.index && lineIndex - marker.index <= 2);
  if (closeHeading) {
    return closeHeading.role;
  }

  const previousHeading = [...headingMarkers].reverse().find((marker) => marker.index < lineIndex);
  const nextHeading = headingMarkers.find((marker) => marker.index > lineIndex);
  if (previousHeading && (!nextHeading || lineIndex < nextHeading.index)) {
    return previousHeading.role;
  }

  if (lineIndex <= Math.max(5, Math.floor(lineCount * 0.25))) {
    return "seller";
  }

  return null;
}

function nextNonEmptyLine(lines, startIndex) {
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const candidate = collapseWhitespace(lines[index]);
    if (candidate) {
      return {
        lineIndex: index,
        text: candidate,
      };
    }
  }

  return null;
}

function isLikelyPartyName(line) {
  const text = collapseWhitespace(line);
  if (!text || text.length > 90) {
    return false;
  }
  if (PARTY_HEADING_PATTERN.test(text) || PARTY_METADATA_PATTERN.test(text)) {
    return false;
  }
  if (DATE_VALUE_PATTERN.test(text) || MONEY_TOKEN_PATTERN.test(text)) {
    return false;
  }
  if (GSTIN_VALUE_PATTERN.test(text)) {
    return false;
  }
  return /[A-Za-z]{2}/.test(text);
}

function isCompanyNameCandidate(line) {
  const text = collapseWhitespace(line);
  if (!text || text.length > 90) {
    return false;
  }
  if (!COMPANY_SUFFIX_PATTERN.test(text)) {
    return false;
  }
  if (PARTY_HEADING_PATTERN.test(text) || PARTY_METADATA_PATTERN.test(text)) {
    return false;
  }
  if (MONEY_TOKEN_PATTERN.test(text)) {
    return false;
  }
  return true;
}

function scoreCompanyNameCandidate(text, lineIndex, lineCount, role) {
  let score = 24;

  if (role) {
    score += 8;
  }
  if (isCompanyNameCandidate(text)) {
    score += 6;
  }
  if (!/[0-9]/.test(text)) {
    score += 3;
  }
  if (lineIndex <= Math.max(6, Math.floor(lineCount * 0.25))) {
    score += 3;
  }

  return score;
}

function collectLabeledValueCandidates(lines, labelPatterns, validator, options = {}) {
  const candidates = [];
  const lookahead = options.lookahead ?? 2;
  const inlineScore = options.inlineScore ?? 48;
  const projectedScore = options.projectedScore ?? 40;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const labelPattern of labelPatterns) {
      const pattern = new RegExp(labelPattern.source, labelPattern.flags.replace(/g/g, ""));
      const match = pattern.exec(line);
      if (!match) {
        continue;
      }

      const labelIndex = match.index ?? line.indexOf(match[0]);
      const inlineCandidate = cleanFieldCandidate(line.slice(labelIndex + match[0].length));
      if (validator(inlineCandidate)) {
        candidates.push({
          value: inlineCandidate,
          score: inlineScore,
          lineIndex: index,
          lineText: line,
          reason: `matched label ${match[0].trim()}`,
        });
      }

      for (let cursor = index + 1; cursor <= Math.min(lines.length - 1, index + lookahead); cursor += 1) {
        const projectedCandidates = [
          cleanFieldCandidate(lines[cursor].slice(labelIndex)),
          cleanFieldCandidate(lines[cursor]),
        ];

        for (const projectedCandidate of projectedCandidates) {
          if (!validator(projectedCandidate)) {
            continue;
          }

          candidates.push({
            value: projectedCandidate,
            score: projectedScore - (cursor - index - 1) * 3,
            lineIndex: cursor,
            lineText: lines[cursor],
            reason: `continued after label ${match[0].trim()}`,
          });
        }
      }
    }
  }

  return candidates;
}

function detectIndustry(text) {
  if (/\b(?:stockist|free qty|free quantity|scheme discount|scheme)\b/i.test(text)) {
    return "stockist";
  }
  if (/\b(?:mrp|batch no|expiry|tablet|capsule|syrup|pharma|drug)\b/i.test(text)) {
    return "pharma";
  }
  if (/\b(?:serial no|implant|surgical|diagnostic|medical device)\b/i.test(text)) {
    return "medical";
  }
  if (/\b(?:transport|dispatch|vehicle no|lr no|lorry receipt|packing)\b/i.test(text)) {
    return "trading";
  }
  return "generic";
}

function scoreVoucherFamily(lines, text, voucherFamily) {
  let score = 0;
  const reasons = [];
  const header = lines.slice(0, 10).join(" ");
  const dateRowCount = lines.filter((line) => DATE_VALUE_PATTERN.test(collapseWhitespace(line))).length;
  const hasDebitAndCredit = /\bdebit\b/i.test(text) && /\bcredit\b/i.test(text);
  const hasBalanceCue = STATEMENT_BALANCE_PATTERN.test(text);
  const statementColumnMatches = countPatternMatches(text, STATEMENT_COLUMN_PATTERN);

  switch (voucherFamily) {
    case "proforma_invoice":
      if (/PROFORMA INVOICE/i.test(text)) {
        score += 30;
        reasons.push("matched PROFORMA INVOICE header");
      }
      if (/\bPI No\.?/i.test(text)) {
        score += 6;
        reasons.push("contains PI number label");
      }
      break;
    case "sales_invoice":
      if (/TAX INVOICE/i.test(text)) {
        score += 24;
        reasons.push("matched TAX INVOICE header");
      } else if (/SALES INVOICE/i.test(text)) {
        score += 24;
        reasons.push("matched SALES INVOICE header");
      } else if (/\bINVOICE\b/i.test(text)) {
        score += 12;
        reasons.push("contains invoice header");
      }
      if (/\b(?:GSTIN|IGST|CGST|SGST|amount payable|place of supply)\b/i.test(text)) {
        score += 4;
        reasons.push("contains invoice/GST field cues");
      }
      if (/PROFORMA INVOICE/i.test(text)) {
        score -= 8;
      }
      break;
    case "purchase_invoice":
      if (/PURCHASE INVOICE/i.test(text)) {
        score += 28;
        reasons.push("matched PURCHASE INVOICE header");
      } else if (/\bPURCHASE\b/i.test(text) && /\bINVOICE\b/i.test(text)) {
        score += 14;
        reasons.push("contains purchase + invoice cues");
      }
      break;
    case "credit_note":
      if (/CREDIT NOTE/i.test(text)) {
        score += 28;
        reasons.push("matched CREDIT NOTE header");
      }
      break;
    case "debit_note":
      if (/DEBIT NOTE/i.test(text)) {
        score += 28;
        reasons.push("matched DEBIT NOTE header");
      }
      break;
    case "account_statement":
      if (STATEMENT_HEADER_PATTERN.test(header)) {
        score += 28;
        reasons.push("matched statement header");
      }
      if (hasBalanceCue) {
        score += 12;
        reasons.push("contains running balance cues");
      }
      if (hasDebitAndCredit) {
        score += 10;
        reasons.push("contains debit/credit columns");
      }
      if (statementColumnMatches >= 5) {
        score += 8;
        reasons.push("contains statement column vocabulary");
      }
      if (dateRowCount >= 3) {
        score += 6;
        reasons.push("contains multiple statement-like date rows");
      }
      if (/\bINVOICE\b/i.test(text)) {
        score -= 18;
      }
      break;
    case "unknown_document":
      reasons.push("fallback abstain family");
      break;
    default:
      break;
  }

  return {
    voucherFamily,
    label: TALLY_VOUCHER_FAMILIES[voucherFamily].label,
    supported: TALLY_VOUCHER_FAMILIES[voucherFamily].supported,
    score,
    reasons,
  };
}

export function classifyTallyVoucherFamily(source) {
  const normalizedSource = normalizeTallySource(source);
  const lines = normalizedSource.rows.map((row) => collapseWhitespace(row.text ?? ""));
  const text = lines.filter(Boolean).join("\n");

  const rankedFamilies = Object.keys(TALLY_VOUCHER_FAMILIES)
    .map((voucherFamily) => scoreVoucherFamily(lines, text, voucherFamily))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.voucherFamily === "unknown_document") {
        return 1;
      }
      if (right.voucherFamily === "unknown_document") {
        return -1;
      }
      return left.voucherFamily.localeCompare(right.voucherFamily);
    });

  let selectedFamily = rankedFamilies[0];
  if (!selectedFamily || selectedFamily.score < UNKNOWN_FAMILY_THRESHOLD) {
    selectedFamily = rankedFamilies.find((family) => family.voucherFamily === "unknown_document");
  }

  return {
    source: normalizedSource.text,
    pageCount: normalizedSource.pageCount,
    rows: normalizedSource.rows,
    lines,
    rankedFamilies,
    selectedFamily,
  };
}

function tryParseReceipt(text) {
  try {
    return parseReceiptText(text);
  } catch {
    return null;
  }
}

function addVoucherFamilyCandidates(candidateMap, rankedFamilies) {
  for (const family of rankedFamilies) {
    pushCandidate(
      candidateMap,
      "document.voucher_family",
      createCandidate("document.voucher_family", family.voucherFamily, {
        normalizedValue: family.voucherFamily,
        displayValue: family.label,
        score: family.score,
        source: "voucher_classifier",
        reason: family.reasons.join("; "),
      }),
    );
  }
}

function addParserCandidates(candidateMap, parsedReceipt) {
  if (!parsedReceipt) {
    return;
  }

  if (parsedReceipt.invoiceNumber) {
    pushCandidate(
      candidateMap,
      "document.number",
      createCandidate("document.number", parsedReceipt.invoiceNumber, {
        score: 120,
        source: "receipt_parser",
        reason: "deterministic receipt parser",
      }),
    );
  }

  if (parsedReceipt.documentDate) {
    pushCandidate(
      candidateMap,
      "document.date",
      createCandidate("document.date", parsedReceipt.documentDate, {
        score: 120,
        source: "receipt_parser",
        reason: "deterministic receipt parser",
      }),
    );
  }

  if (parsedReceipt.currency) {
    pushCandidate(
      candidateMap,
      "document.currency",
      createCandidate("document.currency", parsedReceipt.currency, {
        score: 120,
        source: "receipt_parser",
        reason: "deterministic receipt parser",
      }),
    );
  }

  if (parsedReceipt.seller?.name) {
    pushCandidate(
      candidateMap,
      "seller.name",
      createCandidate("seller.name", parsedReceipt.seller.name, {
        score: 120,
        source: "receipt_parser",
        reason: "deterministic receipt parser",
      }),
    );
  }
  if (parsedReceipt.seller?.gstin) {
    pushCandidate(
      candidateMap,
      "seller.gstin",
      createCandidate("seller.gstin", parsedReceipt.seller.gstin, {
        score: 120,
        source: "receipt_parser",
        reason: "deterministic receipt parser",
      }),
    );
  }
  if (parsedReceipt.buyer?.name) {
    pushCandidate(
      candidateMap,
      "buyer.name",
      createCandidate("buyer.name", parsedReceipt.buyer.name, {
        score: 120,
        source: "receipt_parser",
        reason: "deterministic receipt parser",
      }),
    );
  }
  if (parsedReceipt.buyer?.gstin) {
    pushCandidate(
      candidateMap,
      "buyer.gstin",
      createCandidate("buyer.gstin", parsedReceipt.buyer.gstin, {
        score: 120,
        source: "receipt_parser",
        reason: "deterministic receipt parser",
      }),
    );
  }
  if (parsedReceipt.consignee?.name) {
    pushCandidate(
      candidateMap,
      "consignee.name",
      createCandidate("consignee.name", parsedReceipt.consignee.name, {
        score: 120,
        source: "receipt_parser",
        reason: "deterministic receipt parser",
      }),
    );
  }
  if (parsedReceipt.consignee?.gstin) {
    pushCandidate(
      candidateMap,
      "consignee.gstin",
      createCandidate("consignee.gstin", parsedReceipt.consignee.gstin, {
        score: 120,
        source: "receipt_parser",
        reason: "deterministic receipt parser",
      }),
    );
  }
  if (parsedReceipt.summary?.taxableAmountCents != null) {
    pushCandidate(
      candidateMap,
      "amounts.taxable_amount_cents",
      createCandidate("amounts.taxable_amount_cents", parsedReceipt.summary.taxableAmountCents, {
        normalizedValue: parsedReceipt.summary.taxableAmountCents,
        displayValue: String(parsedReceipt.summary.taxableAmountCents),
        score: 118,
        source: "receipt_parser",
        reason: "summary taxable amount",
      }),
    );
  }
  if (parsedReceipt.summary?.subtotalAmountCents != null) {
    pushCandidate(
      candidateMap,
      "amounts.subtotal_cents",
      createCandidate("amounts.subtotal_cents", parsedReceipt.summary.subtotalAmountCents, {
        normalizedValue: parsedReceipt.summary.subtotalAmountCents,
        displayValue: String(parsedReceipt.summary.subtotalAmountCents),
        score: 118,
        source: "receipt_parser",
        reason: "summary subtotal amount",
      }),
    );
  }
  if (parsedReceipt.summary?.roundOffCents != null) {
    pushCandidate(
      candidateMap,
      "amounts.round_off_cents",
      createCandidate("amounts.round_off_cents", parsedReceipt.summary.roundOffCents, {
        normalizedValue: parsedReceipt.summary.roundOffCents,
        displayValue: String(parsedReceipt.summary.roundOffCents),
        score: 118,
        source: "receipt_parser",
        reason: "summary round-off amount",
      }),
    );
  }
  if (parsedReceipt.summary?.totalAmountCents != null) {
    pushCandidate(
      candidateMap,
      "amounts.grand_total_cents",
      createCandidate("amounts.grand_total_cents", parsedReceipt.summary.totalAmountCents, {
        normalizedValue: parsedReceipt.summary.totalAmountCents,
        displayValue: String(parsedReceipt.summary.totalAmountCents),
        score: 120,
        source: "receipt_parser",
        reason: "summary total amount",
      }),
    );
  }

  for (const taxLine of parsedReceipt.summary?.taxLines ?? []) {
    let fieldId = null;
    if (/IGST/i.test(taxLine.label)) {
      fieldId = "taxes.igst_cents";
    } else if (/CGST/i.test(taxLine.label)) {
      fieldId = "taxes.cgst_cents";
    } else if (/SGST/i.test(taxLine.label)) {
      fieldId = "taxes.sgst_cents";
    } else if (/CESS/i.test(taxLine.label)) {
      fieldId = "taxes.cess_cents";
    }

    if (!fieldId) {
      continue;
    }

    pushCandidate(
      candidateMap,
      fieldId,
      createCandidate(fieldId, taxLine.amountCents, {
        normalizedValue: taxLine.amountCents,
        displayValue: String(taxLine.amountCents),
        score: 118,
        source: "receipt_parser",
        reason: taxLine.label,
      }),
    );
  }

  for (const item of parsedReceipt.items ?? []) {
    pushCandidate(
      candidateMap,
      "line_items[].description",
      createCandidate("line_items[].description", item.description, {
        itemIndex: item.index,
        score: 116,
        source: "receipt_parser",
        reason: "parsed line item description",
      }),
    );

    if (item.hsnSac) {
      pushCandidate(
        candidateMap,
        "line_items[].hsn_sac",
        createCandidate("line_items[].hsn_sac", item.hsnSac, {
          itemIndex: item.index,
          score: 116,
          source: "receipt_parser",
          reason: "parsed line item HSN/SAC",
        }),
      );
    }

    pushCandidate(
      candidateMap,
      "line_items[].quantity",
      createCandidate("line_items[].quantity", item.quantity, {
        itemIndex: item.index,
        score: 116,
        source: "receipt_parser",
        reason: "parsed line item quantity",
      }),
    );

    if (item.quantityUnit) {
      pushCandidate(
        candidateMap,
        "line_items[].unit",
        createCandidate("line_items[].unit", item.quantityUnit, {
          itemIndex: item.index,
          score: 116,
          source: "receipt_parser",
          reason: "parsed line item unit",
        }),
      );
    }

    if (item.unitPriceCents != null) {
      pushCandidate(
        candidateMap,
        "line_items[].unit_price_cents",
        createCandidate("line_items[].unit_price_cents", item.unitPriceCents, {
          itemIndex: item.index,
          normalizedValue: item.unitPriceCents,
          displayValue: String(item.unitPriceCents),
          score: 116,
          source: "receipt_parser",
          reason: "parsed line item unit price",
        }),
      );
    }

    if (item.taxRate != null) {
      pushCandidate(
        candidateMap,
        "line_items[].tax_rate_percent",
        createCandidate("line_items[].tax_rate_percent", item.taxRate * 100, {
          itemIndex: item.index,
          score: 116,
          source: "receipt_parser",
          reason: "parsed line item tax rate",
        }),
      );
    }

    pushCandidate(
      candidateMap,
      "line_items[].amount_cents",
      createCandidate("line_items[].amount_cents", item.lineAmountCents, {
        itemIndex: item.index,
        normalizedValue: item.lineAmountCents,
        displayValue: String(item.lineAmountCents),
        score: 116,
        source: "receipt_parser",
        reason: "parsed line item amount",
      }),
    );
  }
}

function addDocumentCandidates(candidateMap, lines, text) {
  pushCandidates(
    candidateMap,
    "document.number",
    collectLabeledValueCandidates(
      lines,
      [/PI No\.?/i, /Invoice No\.?/i, /Voucher No\.?/i, /Bill No\.?/i, /Credit Note No\.?/i, /Debit Note No\.?/i],
      (value) => /^[A-Z0-9][A-Z0-9/-]{0,39}$/i.test(value),
      { inlineScore: 54, projectedScore: 46 },
    ).map((candidate) =>
      createCandidate("document.number", candidate.value, {
        score: candidate.score,
        source: "label_match",
        lineIndex: candidate.lineIndex,
        lineText: candidate.lineText,
        reason: candidate.reason,
      }),
    ),
  );

  pushCandidates(
    candidateMap,
    "document.date",
    collectLabeledValueCandidates(
      lines,
      [/Date\s*:?/i, /Ack Date/i, /\bDated\b/i, /Voucher Date/i],
      (value) => DATE_VALUE_PATTERN.test(value),
      { inlineScore: 54, projectedScore: 46 },
    ).map((candidate) =>
      createCandidate("document.date", candidate.value, {
        score: candidate.score,
        source: "label_match",
        lineIndex: candidate.lineIndex,
        lineText: candidate.lineText,
        reason: candidate.reason,
      }),
    ),
  );

  pushCandidates(
    candidateMap,
    "document.purchase_order_number",
    collectLabeledValueCandidates(
      lines,
      [/PO No\.?/i, /PO Number/i, /Purchase Order/i],
      (value) => /^[A-Z0-9][A-Z0-9/-]{0,39}$/i.test(value),
      { inlineScore: 44, projectedScore: 38 },
    ).map((candidate) =>
      createCandidate("document.purchase_order_number", candidate.value, {
        score: candidate.score,
        source: "label_match",
        lineIndex: candidate.lineIndex,
        lineText: candidate.lineText,
        reason: candidate.reason,
      }),
    ),
  );

  pushCandidates(
    candidateMap,
    "document.reference_number",
    collectLabeledValueCandidates(
      lines,
      [/Reference(?: No\.?)?/i, /Challan No\.?/i, /Order Ref/i],
      (value) => /^[A-Z0-9][A-Z0-9/-]{0,39}$/i.test(value),
      { inlineScore: 42, projectedScore: 36 },
    ).map((candidate) =>
      createCandidate("document.reference_number", candidate.value, {
        score: candidate.score,
        source: "label_match",
        lineIndex: candidate.lineIndex,
        lineText: candidate.lineText,
        reason: candidate.reason,
      }),
    ),
  );

  pushCandidates(
    candidateMap,
    "document.place_of_supply",
    collectLabeledValueCandidates(
      lines,
      [/Place of Supply/i, /State Name/i],
      (value) => /^[A-Za-z][A-Za-z\s().-]{1,60}$/.test(value),
      { inlineScore: 48, projectedScore: 40 },
    ).map((candidate) =>
      createCandidate("document.place_of_supply", candidate.value, {
        score: candidate.score,
        source: "label_match",
        lineIndex: candidate.lineIndex,
        lineText: candidate.lineText,
        reason: candidate.reason,
      }),
    ),
  );

  pushCandidates(
    candidateMap,
    "document.e_way_bill_number",
    collectLabeledValueCandidates(
      lines,
      [/E-?Way Bill(?: No\.?)?/i],
      (value) => /^[A-Z0-9][A-Z0-9/-]{3,39}$/i.test(value),
      { inlineScore: 48, projectedScore: 40 },
    ).map((candidate) =>
      createCandidate("document.e_way_bill_number", candidate.value, {
        score: candidate.score,
        source: "label_match",
        lineIndex: candidate.lineIndex,
        lineText: candidate.lineText,
        reason: candidate.reason,
      }),
    ),
  );

  if (/₹|\bINR\b|\bRs\.?\b/i.test(text)) {
    pushCandidate(
      candidateMap,
      "document.currency",
      createCandidate("document.currency", "INR", {
        score: 50,
        source: "currency_cue",
        reason: "matched INR currency cue",
      }),
    );
  }
}

function addPartyCandidates(candidateMap, lines) {
  const headingMarkers = buildHeadingMarkers(lines);
  let fallbackGstinRoleIndex = 0;
  const fallbackGstinRoles = ["seller", "buyer", "consignee"];

  for (const marker of headingMarkers) {
    const nextLine = nextNonEmptyLine(lines, marker.index);
    if (!nextLine || !isLikelyPartyName(nextLine.text)) {
      continue;
    }

    pushCandidate(
      candidateMap,
      `${marker.role}.name`,
      createCandidate(`${marker.role}.name`, nextLine.text, {
        score: 44,
        source: "heading_context",
        lineIndex: nextLine.lineIndex,
        lineText: nextLine.text,
        reason: `line after ${marker.role} heading`,
      }),
    );
  }

  for (let index = 0; index < lines.length; index += 1) {
    const text = collapseWhitespace(lines[index]);
    if (!text) {
      continue;
    }

    const role = inferPartyRoleForLine(index, headingMarkers, lines.length);
    if (isLikelyPartyName(text) && (isCompanyNameCandidate(text) || role)) {
      const assignedRole = role ?? (index <= Math.max(6, Math.floor(lines.length * 0.25)) ? "seller" : null);
      if (assignedRole) {
        pushCandidate(
          candidateMap,
          `${assignedRole}.name`,
          createCandidate(`${assignedRole}.name`, text, {
            score: scoreCompanyNameCandidate(text, index, lines.length, assignedRole),
            source: "company_heuristic",
            lineIndex: index,
            lineText: lines[index],
            reason: assignedRole === role ? "matched heading/section context" : "top-of-document company candidate",
          }),
        );
      }
    }

    for (const match of text.matchAll(GSTIN_PATTERN)) {
      const assignedRole =
        role ??
        fallbackGstinRoles[Math.min(fallbackGstinRoleIndex, fallbackGstinRoles.length - 1)] ??
        "seller";
      fallbackGstinRoleIndex += 1;

      pushCandidate(
        candidateMap,
        `${assignedRole}.gstin`,
        createCandidate(`${assignedRole}.gstin`, match[0], {
          score: role ? 46 : 38,
          source: "gstin_heuristic",
          lineIndex: index,
          lineText: lines[index],
          reason: role ? `GSTIN near ${assignedRole} section` : "GSTIN assigned by top-to-bottom fallback",
        }),
      );
    }
  }
}

function scoreCueAmountCandidate(candidate, cuePattern, options = {}) {
  let score = options.baseScore ?? 0;
  const lineText = candidate.lineText ?? "";
  const leftText = candidate.leftText ?? "";

  if (cuePattern.test(lineText)) {
    score += 18;
  }
  if (cuePattern.test(leftText)) {
    score += 10;
  }
  if (candidate.amountIsRightmostWord) {
    score += 2;
  }
  if (candidate.pageRightBucket === "edge" || candidate.pageRightBucket === "far_right") {
    score += 2;
  }
  if (candidate.lineItemCue) {
    score -= 5;
  }

  return score;
}

function addAmountCandidates(candidateMap, source) {
  let amountCandidates = [];
  let rankedTotalCandidates = [];

  try {
    amountCandidates = extractReceiptAmountCandidates(source);
  } catch {
    amountCandidates = [];
  }

  try {
    rankedTotalCandidates = rankReceiptTotalCandidates(source);
  } catch {
    rankedTotalCandidates = [];
  }

  for (const candidate of rankedTotalCandidates.slice(0, 6)) {
    pushCandidate(
      candidateMap,
      "amounts.grand_total_cents",
      createCandidate("amounts.grand_total_cents", candidate.amountCents, {
        normalizedValue: candidate.amountCents,
        displayValue: candidate.amountText,
        score: 72 + candidate.score,
        source: "total_ranker",
        lineIndex: candidate.lineIndex,
        lineText: candidate.lineText,
        reason: "ranked by receipt total teacher",
      }),
    );
  }

  for (const candidate of amountCandidates) {
    const lineText = candidate.lineText ?? "";

    if (/\btaxable\b/i.test(lineText) || /\btaxable\b/i.test(candidate.leftText ?? "")) {
      pushCandidate(
        candidateMap,
        "amounts.taxable_amount_cents",
        createCandidate("amounts.taxable_amount_cents", candidate.amountCents, {
          normalizedValue: candidate.amountCents,
          displayValue: candidate.amountText,
          score: scoreCueAmountCandidate(candidate, /\btaxable\b/i, { baseScore: 52 }),
          source: "amount_cue",
          lineIndex: candidate.lineIndex,
          lineText: candidate.lineText,
          reason: "matched taxable cue",
        }),
      );
    }

    if (/\bsub\s*total\b/i.test(lineText) || /\bsub\s*total\b/i.test(candidate.leftText ?? "")) {
      pushCandidate(
        candidateMap,
        "amounts.subtotal_cents",
        createCandidate("amounts.subtotal_cents", candidate.amountCents, {
          normalizedValue: candidate.amountCents,
          displayValue: candidate.amountText,
          score: scoreCueAmountCandidate(candidate, /\bsub\s*total\b/i, { baseScore: 48 }),
          source: "amount_cue",
          lineIndex: candidate.lineIndex,
          lineText: candidate.lineText,
          reason: "matched subtotal cue",
        }),
      );
    }

    if (/\b(?:discount|disc\.?)\b/i.test(lineText)) {
      pushCandidate(
        candidateMap,
        "amounts.discount_cents",
        createCandidate("amounts.discount_cents", candidate.amountCents, {
          normalizedValue: candidate.amountCents,
          displayValue: candidate.amountText,
          score: scoreCueAmountCandidate(candidate, /\b(?:discount|disc\.?)\b/i, { baseScore: 46 }),
          source: "amount_cue",
          lineIndex: candidate.lineIndex,
          lineText: candidate.lineText,
          reason: "matched discount cue",
        }),
      );
    }

    if (/\bround\s*off\b/i.test(lineText)) {
      pushCandidate(
        candidateMap,
        "amounts.round_off_cents",
        createCandidate("amounts.round_off_cents", candidate.amountCents, {
          normalizedValue: candidate.amountCents,
          displayValue: candidate.amountText,
          score: scoreCueAmountCandidate(candidate, /\bround\s*off\b/i, { baseScore: 46 }),
          source: "amount_cue",
          lineIndex: candidate.lineIndex,
          lineText: candidate.lineText,
          reason: "matched round-off cue",
        }),
      );
    }

    if (/\bIGST\b/i.test(lineText)) {
      pushCandidate(
        candidateMap,
        "taxes.igst_cents",
        createCandidate("taxes.igst_cents", candidate.amountCents, {
          normalizedValue: candidate.amountCents,
          displayValue: candidate.amountText,
          score: scoreCueAmountCandidate(candidate, /\bIGST\b/i, { baseScore: 50 }),
          source: "amount_cue",
          lineIndex: candidate.lineIndex,
          lineText: candidate.lineText,
          reason: "matched IGST cue",
        }),
      );
    }

    if (/\bCGST\b/i.test(lineText)) {
      pushCandidate(
        candidateMap,
        "taxes.cgst_cents",
        createCandidate("taxes.cgst_cents", candidate.amountCents, {
          normalizedValue: candidate.amountCents,
          displayValue: candidate.amountText,
          score: scoreCueAmountCandidate(candidate, /\bCGST\b/i, { baseScore: 50 }),
          source: "amount_cue",
          lineIndex: candidate.lineIndex,
          lineText: candidate.lineText,
          reason: "matched CGST cue",
        }),
      );
    }

    if (/\bSGST\b/i.test(lineText)) {
      pushCandidate(
        candidateMap,
        "taxes.sgst_cents",
        createCandidate("taxes.sgst_cents", candidate.amountCents, {
          normalizedValue: candidate.amountCents,
          displayValue: candidate.amountText,
          score: scoreCueAmountCandidate(candidate, /\bSGST\b/i, { baseScore: 50 }),
          source: "amount_cue",
          lineIndex: candidate.lineIndex,
          lineText: candidate.lineText,
          reason: "matched SGST cue",
        }),
      );
    }

    if (/\bCESS\b/i.test(lineText)) {
      pushCandidate(
        candidateMap,
        "taxes.cess_cents",
        createCandidate("taxes.cess_cents", candidate.amountCents, {
          normalizedValue: candidate.amountCents,
          displayValue: candidate.amountText,
          score: scoreCueAmountCandidate(candidate, /\bCESS\b/i, { baseScore: 50 }),
          source: "amount_cue",
          lineIndex: candidate.lineIndex,
          lineText: candidate.lineText,
          reason: "matched CESS cue",
        }),
      );
    }
  }
}

function candidateMapToObject(candidateMap) {
  return Object.fromEntries(
    [...candidateMap.entries()].map(([fieldId, candidates]) => [fieldId, sortCandidates(candidates)]),
  );
}

function flattenSchemaFields(schema) {
  return Object.values(schema.fields).flat();
}

function buildSelectedFieldMap(schema, fieldCandidates, voucherFamily) {
  const selectedFields = {
    "document.voucher_family": voucherFamily,
  };

  for (const field of flattenSchemaFields(schema)) {
    if (field.repeatable || field.id === "document.voucher_family") {
      continue;
    }

    selectedFields[field.id] = fieldCandidates[field.id]?.[0]?.value ?? null;
  }

  return selectedFields;
}

function mapParsedReceiptLineItem(item) {
  return {
    index: item.index,
    description: item.description,
    hsnSac: item.hsnSac,
    quantity: item.quantity,
    unit: item.quantityUnit,
    unitPriceCents: item.unitPriceCents,
    taxRatePercent: item.taxRate != null ? item.taxRate * 100 : null,
    amountCents: item.lineAmountCents,
  };
}

function buildTallyRecord(state) {
  const selected = state.selectedFields;

  return {
    voucherFamily: state.voucherFamily,
    supported: state.schema.supported,
    industry: state.industry,
    rejectionReason: state.schema.rejectionReason ?? null,
    document: {
      voucherFamily: state.voucherFamily,
      number: selected["document.number"],
      date: selected["document.date"],
      currency: selected["document.currency"],
      purchaseOrderNumber: selected["document.purchase_order_number"],
      referenceNumber: selected["document.reference_number"],
      placeOfSupply: selected["document.place_of_supply"],
      eWayBillNumber: selected["document.e_way_bill_number"],
    },
    seller: {
      name: selected["seller.name"],
      gstin: selected["seller.gstin"],
    },
    buyer: {
      name: selected["buyer.name"],
      gstin: selected["buyer.gstin"],
    },
    consignee:
      selected["consignee.name"] || selected["consignee.gstin"]
        ? {
            name: selected["consignee.name"],
            gstin: selected["consignee.gstin"],
          }
        : null,
    amounts: {
      taxableAmountCents: selected["amounts.taxable_amount_cents"],
      subtotalCents: selected["amounts.subtotal_cents"],
      discountCents: selected["amounts.discount_cents"],
      roundOffCents: selected["amounts.round_off_cents"],
      grandTotalCents: selected["amounts.grand_total_cents"],
    },
    taxes: {
      igstCents: selected["taxes.igst_cents"],
      cgstCents: selected["taxes.cgst_cents"],
      sgstCents: selected["taxes.sgst_cents"],
      cessCents: selected["taxes.cess_cents"],
    },
    lineItems: state.parsedReceipt?.items?.map(mapParsedReceiptLineItem) ?? [],
  };
}

export function buildTallyExtractionState(source, options = {}) {
  const classification = classifyTallyVoucherFamily(source);
  const normalizedSource = normalizeTallySource(source);
  const voucherFamily = options.voucherFamily ?? classification.selectedFamily.voucherFamily;
  const industry = options.industry ?? detectIndustry(classification.source);
  const schema = buildTallyVoucherSchema(voucherFamily, { industry });
  const parsedReceipt = schema.supported ? tryParseReceipt(classification.source) : null;

  const candidateMap = new Map();
  addVoucherFamilyCandidates(candidateMap, classification.rankedFamilies);

  if (schema.supported) {
    addParserCandidates(candidateMap, parsedReceipt);
    addDocumentCandidates(candidateMap, classification.lines, classification.source);
    addPartyCandidates(candidateMap, classification.lines);
    addAmountCandidates(candidateMap, normalizedSource);
  }

  const fieldCandidates = candidateMapToObject(candidateMap);
  const selectedFields = buildSelectedFieldMap(schema, fieldCandidates, voucherFamily);

  return {
    source: classification.source,
    pageCount: classification.pageCount,
    rows: classification.rows,
    lines: classification.lines,
    rankedVoucherFamilies: classification.rankedFamilies,
    voucherFamily,
    industry,
    schema,
    parsedReceipt,
    fieldCandidates,
    selectedFields,
  };
}

export function extractTallyFieldCandidates(source, options = {}) {
  return buildTallyExtractionState(source, options).fieldCandidates;
}

function buildTallyExtractionProgramFromState(state) {
  return [
    `OCR_VOUCHER pages=${state.pageCount} lines=${state.lines.length} family=${state.voucherFamily} industry=${state.industry}`,
    "CLASSIFY_VOUCHER_FAMILY",
    "SELECT_SCHEMA",
    "EXTRACT_FIELD_CANDIDATES",
    "EMIT_TALLY_RECORD",
    "HALT",
  ];
}

export function buildTallyExtractionProgram(source, options = {}) {
  const state = buildTallyExtractionState(source, options);
  return buildTallyExtractionProgramFromState(state);
}

export function runTallyExtractionPsvm(source, options = {}) {
  const state = buildTallyExtractionState(source, options);
  const result = buildTallyRecord(state);
  const snapshot = {
    voucherFamily: state.voucherFamily,
    supported: state.schema.supported,
    fieldCount: Object.keys(state.fieldCandidates).length,
  };

  return {
    source: state.source,
    program: buildTallyExtractionProgramFromState(state),
    state,
    trace: [
      {
        op: "CLASSIFY_VOUCHER_FAMILY",
        rankedFamilies: state.rankedVoucherFamilies.slice(0, 5),
        snapshot,
      },
      {
        op: "SELECT_SCHEMA",
        voucherFamily: state.voucherFamily,
        supported: state.schema.supported,
        industry: state.industry,
        rejectionReason: state.schema.rejectionReason ?? null,
        snapshot,
      },
      {
        op: "EXTRACT_FIELD_CANDIDATES",
        topFields: Object.entries(state.fieldCandidates)
          .slice(0, 12)
          .map(([fieldId, candidates]) => ({
            fieldId,
            topCandidate: candidates[0]?.displayValue ?? null,
          })),
        snapshot,
      },
      {
        op: "EMIT_TALLY_RECORD",
        recordSummary: {
          voucherFamily: result.voucherFamily,
          supported: result.supported,
          documentNumber: result.document.number,
          grandTotalCents: result.amounts.grandTotalCents,
        },
        snapshot,
      },
      {
        op: "HALT",
        snapshot,
      },
    ],
    result,
  };
}

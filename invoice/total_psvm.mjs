import { buildPlainTextReceiptSource, collapseWhitespace } from "./ocr_layout.mjs";

const MONEY_WORD_PATTERN = /^[0-9][0-9,]*\.\d{2}$/;
const CURRENCY_WORD_PATTERN = /^(?:₹|Rs\.?)$/i;
const EXPLICIT_TOTAL_CUE_PATTERN =
  /\b(?:grand\s+total|invoice\s+total|net\s+amount|amount\s+due|amount\s+payable|amount\s+chargeable|total)\b/i;
const SUBTOTAL_CUE_PATTERN = /\b(?:subtotal|sub\s+total|taxable)\b/i;
const TAX_CUE_PATTERN = /\b(?:igst|cgst|sgst|gst|tax)\b/i;
const SOFT_TOTAL_CUE_PATTERN = /\b(?:on account|balance due|amount chargeable|paid)\b/i;
const LINE_ITEM_CUE_PATTERN =
  /\b(?:qty|quantity|rate|unit|per|hsn|disc|description|goods|service)\b/i;
const METADATA_CUE_PATTERN =
  /\b(?:irn|ack|gstin|ifs|branch|bank|jurisdiction|phone|email|dispatch)\b/i;
const CUE_WORD_PATTERN =
  /^(?:grand|total|invoice|net|amount|due|payable|chargeable|on|account|balance|subtotal|taxable|igst|cgst|sgst|gst|tax|paid)$/i;
const STATEMENT_HEADER_PATTERN =
  /\b(?:account statement|bank statement|statement of account|mini statement)\b/i;
const STATEMENT_BALANCE_PATTERN =
  /\b(?:opening balance|closing balance|available balance|ledger balance|running balance)\b/i;
const STATEMENT_COLUMN_PATTERN =
  /\b(?:debit|credit|withdrawal|deposit|narration|transaction|txn|cheque|utr|imps|neft|upi)\b/i;
const STATEMENT_DATE_PATTERN =
  /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}-[A-Za-z]{3}-\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})\b/;

export const RECEIPT_TOTAL_PSVM_OPS = Object.freeze([
  "EXTRACT_AMOUNTS",
  "RANK_TOTAL_BRANCHES",
  "EMIT_TOTAL",
  "HALT",
]);

function parseMoneyToCents(value) {
  const normalized = String(value)
    .trim()
    .replace(/^Rs\.?\s*/i, "")
    .replace(/₹/g, "")
    .replace(/[,\s]/g, "");

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`Invalid money value: ${value}`);
  }

  const [whole, fraction = ""] = normalized.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function isStructuredReceiptSource(value) {
  return Boolean(value) && typeof value === "object" && Array.isArray(value.rows);
}

function isReceiptTotalState(value) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray(value.rows) &&
    Array.isArray(value.candidates)
  );
}

function normalizeWord(word, pageDefaults) {
  const pageWidth = Number.isFinite(word?.pageWidth) && word.pageWidth > 0 ? word.pageWidth : pageDefaults.pageWidth;
  const pageHeight =
    Number.isFinite(word?.pageHeight) && word.pageHeight > 0 ? word.pageHeight : pageDefaults.pageHeight;
  return {
    text: String(word?.text ?? "").trim(),
    xMin: Number.isFinite(word?.xMin) ? word.xMin : 0,
    xMax: Number.isFinite(word?.xMax) ? word.xMax : 0,
    yMin: Number.isFinite(word?.yMin) ? word.yMin : 0,
    yMax: Number.isFinite(word?.yMax) ? word.yMax : 0,
    pageIndex: Number.isInteger(word?.pageIndex) ? word.pageIndex : pageDefaults.pageIndex,
    pageWidth,
    pageHeight,
  };
}

function normalizeRow(row, rowIndex) {
  const pageIndex = Number.isInteger(row?.pageIndex) ? row.pageIndex : 0;
  const pageWidth = Number.isFinite(row?.pageWidth) && row.pageWidth > 0 ? row.pageWidth : 1;
  const pageHeight = Number.isFinite(row?.pageHeight) && row.pageHeight > 0 ? row.pageHeight : 1;
  const words = Array.isArray(row?.words)
    ? row.words
        .map((word) => normalizeWord(word, { pageIndex, pageWidth, pageHeight }))
        .filter((word) => word.text.length > 0)
        .sort((left, right) => {
          if (left.xMin !== right.xMin) {
            return left.xMin - right.xMin;
          }
          return left.yMin - right.yMin;
        })
    : [];

  const text =
    typeof row?.text === "string"
      ? collapseWhitespace(row.text)
      : collapseWhitespace(words.map((word) => word.text).join(" "));

  const xMin =
    Number.isFinite(row?.xMin) && row.xMin >= 0
      ? row.xMin
      : words.length > 0
        ? Math.min(...words.map((word) => word.xMin))
        : 0;
  const xMax =
    Number.isFinite(row?.xMax) && row.xMax >= 0
      ? row.xMax
      : words.length > 0
        ? Math.max(...words.map((word) => word.xMax))
        : 0;
  const yMin =
    Number.isFinite(row?.yMin) && row.yMin >= 0
      ? row.yMin
      : words.length > 0
        ? Math.min(...words.map((word) => word.yMin))
        : rowIndex;
  const yMax =
    Number.isFinite(row?.yMax) && row.yMax >= 0
      ? row.yMax
      : words.length > 0
        ? Math.max(...words.map((word) => word.yMax))
        : rowIndex + 1;

  return {
    rowIndex,
    pageIndex,
    pageWidth,
    pageHeight,
    xMin,
    xMax,
    yMin,
    yMax,
    words,
    text,
  };
}

function normalizeReceiptSource(source) {
  if (typeof source === "string") {
    return buildPlainTextReceiptSource(source);
  }

  if (!isStructuredReceiptSource(source)) {
    throw new Error("Receipt OCR source must be a string or structured OCR payload.");
  }

  const rows = source.rows.map((row, rowIndex) => normalizeRow(row, rowIndex));
  return {
    kind: "receipt_ocr_source",
    pageCount:
      Number.isInteger(source.pageCount) && source.pageCount > 0
        ? source.pageCount
        : Math.max(1, ...rows.map((row) => row.pageIndex + 1)),
    text:
      typeof source.text === "string" && source.text.trim()
        ? source.text
        : rows.map((row) => row.text).filter(Boolean).join("\n"),
    rows,
  };
}

function inferDocumentType(lines) {
  const header = lines.slice(0, 8).join(" ");
  if (/PROFORMA INVOICE/i.test(header)) {
    return "PROFORMA INVOICE";
  }
  if (/TAX INVOICE/i.test(header)) {
    return "TAX INVOICE";
  }
  if (/\bINVOICE\b/i.test(header)) {
    return "INVOICE";
  }
  return "RECEIPT";
}

function looksLikeAccountStatement(lines, documentType) {
  if (documentType !== "RECEIPT") {
    return false;
  }

  const text = lines.join("\n");
  const header = lines.slice(0, 10).join(" ");
  if (STATEMENT_HEADER_PATTERN.test(header)) {
    return true;
  }

  const dateRowCount = lines.filter((line) => STATEMENT_DATE_PATTERN.test(line)).length;
  const hasBalanceCue = STATEMENT_BALANCE_PATTERN.test(text);
  const hasDebitAndCredit = /\bdebit\b/i.test(text) && /\bcredit\b/i.test(text);
  const columnCueCount = [...text.matchAll(new RegExp(STATEMENT_COLUMN_PATTERN.source, "gi"))].length;

  return (
    (hasBalanceCue && dateRowCount >= 3) ||
    (hasDebitAndCredit && dateRowCount >= 3) ||
    (columnCueCount >= 5 && dateRowCount >= 3)
  );
}

function bucketLinePosition(lineIndex, lineCount) {
  if (lineCount <= 1) {
    return "middle";
  }

  const ratio = lineIndex / Math.max(1, lineCount - 1);
  if (ratio < 0.33) {
    return "top";
  }
  if (ratio < 0.66) {
    return "middle";
  }
  return "bottom";
}

function bucketRatio(ratio, thresholds, labels) {
  for (let index = 0; index < thresholds.length; index += 1) {
    if (ratio < thresholds[index]) {
      return labels[index];
    }
  }
  return labels[labels.length - 1];
}

function bucketPageRight(ratio) {
  return bucketRatio(ratio, [0.3, 0.55, 0.75, 0.9], [
    "left",
    "mid",
    "right",
    "far_right",
    "edge",
  ]);
}

function bucketPageLeft(ratio) {
  return bucketRatio(ratio, [0.15, 0.35, 0.55, 0.75], [
    "left_edge",
    "left",
    "middle",
    "right",
    "far_right",
  ]);
}

function bucketPageVertical(ratio) {
  return bucketRatio(ratio, [0.18, 0.5, 0.82], ["top", "upper_mid", "lower_mid", "bottom"]);
}

function bucketGapRatio(ratio) {
  return bucketRatio(ratio, [0.03, 0.08, 0.16], ["tight", "near", "wide", "far"]);
}

function bucketWidthRatio(ratio) {
  return bucketRatio(ratio, [0.05, 0.1, 0.18], ["compact", "medium", "wide", "very_wide"]);
}

function bucketWordCount(count) {
  if (count <= 3) {
    return "short";
  }
  if (count <= 8) {
    return "medium";
  }
  if (count <= 16) {
    return "long";
  }
  return "very_long";
}

function bucketAmountMagnitude(amountCents) {
  if (amountCents < 100_000) {
    return "tiny";
  }
  if (amountCents < 1_000_000) {
    return "small";
  }
  if (amountCents < 10_000_000) {
    return "medium";
  }
  if (amountCents < 100_000_000) {
    return "large";
  }
  return "huge";
}

function extractLineFeatures(rawLine) {
  const line = collapseWhitespace(rawLine);
  const explicitTotalCue =
    EXPLICIT_TOTAL_CUE_PATTERN.test(line) &&
    !SUBTOTAL_CUE_PATTERN.test(line) &&
    !/^Tax Amount\b/i.test(line);
  const subtotalCue = SUBTOTAL_CUE_PATTERN.test(line);
  const taxCue = TAX_CUE_PATTERN.test(line) && !explicitTotalCue;
  const softTotalCue = SOFT_TOTAL_CUE_PATTERN.test(line);
  const lineItemCue =
    LINE_ITEM_CUE_PATTERN.test(line) ||
    /^\d+\s+/.test(line) ||
    /(?:^|\s)(?:nos|pcs|kw|hrs|sets)\b/i.test(line);
  const metadataCue = METADATA_CUE_PATTERN.test(line);

  return {
    explicitTotalCue,
    subtotalCue,
    taxCue,
    softTotalCue,
    lineItemCue,
    metadataCue,
  };
}

function joinWordRange(words, startIndex, endIndex) {
  return collapseWhitespace(words.slice(startIndex, endIndex).map((word) => word.text).join(" "));
}

function findLastCueWord(words, beforeIndex) {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const normalized = words[index].text.replace(/[^A-Za-z]+/g, "");
    if (normalized && CUE_WORD_PATTERN.test(normalized)) {
      return words[index];
    }
  }
  return null;
}

function buildCandidateRowCues(row, amountStartWordIndex, amountEndWordIndex) {
  const leftText = joinWordRange(row.words, 0, amountStartWordIndex);
  const rightText = joinWordRange(row.words, amountEndWordIndex + 1, row.words.length);
  const explicitCueBeforeAmount =
    leftText.length > 0 &&
    EXPLICIT_TOTAL_CUE_PATTERN.test(leftText) &&
    !SUBTOTAL_CUE_PATTERN.test(leftText) &&
    !/^Tax Amount\b/i.test(leftText);
  const subtotalCueBeforeAmount = leftText.length > 0 && SUBTOTAL_CUE_PATTERN.test(leftText);
  const taxCueBeforeAmount =
    leftText.length > 0 && TAX_CUE_PATTERN.test(leftText) && !explicitCueBeforeAmount;
  const softTotalCueBeforeAmount =
    leftText.length > 0 && SOFT_TOTAL_CUE_PATTERN.test(leftText);
  const cueWord = findLastCueWord(row.words, amountStartWordIndex);
  const cueGapRatio = cueWord
    ? Math.max(0, (row.words[amountStartWordIndex].xMin - cueWord.xMax) / row.pageWidth)
    : null;

  return {
    leftText,
    rightText,
    explicitCueBeforeAmount,
    subtotalCueBeforeAmount,
    taxCueBeforeAmount,
    softTotalCueBeforeAmount,
    cueGapBucket: cueGapRatio === null ? "none" : bucketGapRatio(cueGapRatio),
  };
}

function buildMoneyWordRanges(row) {
  const moneyWords = [];

  for (let wordIndex = 0; wordIndex < row.words.length; wordIndex += 1) {
    const word = row.words[wordIndex];
    if (!MONEY_WORD_PATTERN.test(word.text)) {
      continue;
    }

    let amountStartWordIndex = wordIndex;
    let amountText = word.text;
    let hasCurrencyMarker = false;
    if (wordIndex > 0 && CURRENCY_WORD_PATTERN.test(row.words[wordIndex - 1].text)) {
      amountStartWordIndex = wordIndex - 1;
      amountText = `${row.words[wordIndex - 1].text} ${word.text}`;
      hasCurrencyMarker = true;
    }

    const startWord = row.words[amountStartWordIndex];
    moneyWords.push({
      amountStartWordIndex,
      amountEndWordIndex: wordIndex,
      amountText,
      hasCurrencyMarker,
      xMin: startWord.xMin,
      xMax: word.xMax,
      yMin: Math.min(startWord.yMin, word.yMin),
      yMax: Math.max(startWord.yMax, word.yMax),
    });
  }

  return moneyWords;
}

function formatCandidatePreview(candidate) {
  return `${candidate.amountText} @ line ${candidate.lineIndex + 1}`;
}

function formatAmountFeatures(candidates) {
  return candidates
    .slice(0, 6)
    .map((candidate) => `${candidate.amountMagnitudeBucket}_${candidate.amountRank}`)
    .join(" ");
}

function summarizeContextSegment(value) {
  const normalized = collapseWhitespace(value).toLowerCase();
  if (!normalized) {
    return "none";
  }

  const tokens = [];
  if (/(?:₹|rs\.?)/i.test(normalized)) {
    tokens.push("currency");
  }
  if (/[0-9][0-9,]*\.\d{2}/.test(normalized)) {
    tokens.push("money");
  }
  if (/\b\d+\.\d{3}\b/.test(normalized)) {
    tokens.push("qty_decimal");
  }
  if (/\bdr\b/.test(normalized)) {
    tokens.push("dr");
  }
  if (/\bcr\b/.test(normalized)) {
    tokens.push("cr");
  }

  const keywordMatches = normalized.match(
    /\b(?:grand|total|invoice|proforma|net|amount|due|payable|chargeable|on|account|balance|subtotal|sub|taxable|igst|cgst|sgst|gst|tax|paid|qty|quantity|unit|rate|hsn|disc|description|goods|service|round|off|tcs|kw|nos|pcs|bill|details|ship|buyer|seller)\b/g,
  );
  if (keywordMatches) {
    for (const token of keywordMatches) {
      if (!tokens.includes(token)) {
        tokens.push(token);
      }
    }
  }

  return tokens.length > 0 ? tokens.join(" ") : "text_only";
}

export function extractReceiptAmountCandidates(source) {
  const normalizedSource = normalizeReceiptSource(source);
  const rows = normalizedSource.rows;
  const candidates = [];

  rows.forEach((row, rowIndex) => {
    if (!row.text) {
      return;
    }

    const moneyRanges = buildMoneyWordRanges(row);
    if (moneyRanges.length === 0) {
      return;
    }

    const lineFeatures = extractLineFeatures(row.text);
    moneyRanges.forEach((moneyRange, tokenIndexOnLine) => {
      const rowCues = buildCandidateRowCues(
        row,
        moneyRange.amountStartWordIndex,
        moneyRange.amountEndWordIndex,
      );
      const amountCents = parseMoneyToCents(moneyRange.amountText);
      const amountRightRatio = moneyRange.xMax / row.pageWidth;
      const amountLeftRatio = moneyRange.xMin / row.pageWidth;
      const amountWidthRatio = Math.max(0, moneyRange.xMax - moneyRange.xMin) / row.pageWidth;
      const pageRightGapRatio = Math.max(0, row.pageWidth - moneyRange.xMax) / row.pageWidth;
      const pageYRatio = moneyRange.yMin / row.pageHeight;

      candidates.push({
        candidateIndex: candidates.length,
        amountText: moneyRange.amountText,
        amountCents,
        amountMagnitudeBucket: bucketAmountMagnitude(amountCents),
        lineIndex: rowIndex,
        pageIndex: row.pageIndex,
        lineText: row.text,
        prevLine: rowIndex > 0 ? rows[rowIndex - 1].text : "",
        nextLine: rowIndex + 1 < rows.length ? rows[rowIndex + 1].text : "",
        tokenIndexOnLine,
        amountCountOnLine: moneyRanges.length,
        positionBucket: bucketLinePosition(rowIndex, rows.length),
        fromBottom: rows.length - rowIndex - 1,
        amountXMin: moneyRange.xMin,
        amountXMax: moneyRange.xMax,
        amountYMin: moneyRange.yMin,
        amountYMax: moneyRange.yMax,
        amountRightRatio,
        amountLeftRatio,
        amountWidthRatio,
        pageRightGapRatio,
        pageYRatio,
        pageRightBucket: bucketPageRight(amountRightRatio),
        pageLeftBucket: bucketPageLeft(amountLeftRatio),
        pageYBucket: bucketPageVertical(pageYRatio),
        pageRightGapBucket: bucketGapRatio(pageRightGapRatio),
        amountWidthBucket: bucketWidthRatio(amountWidthRatio),
        rowWordBucket: bucketWordCount(row.words.length),
        rowWordCount: row.words.length,
        hasCurrencyMarker: moneyRange.hasCurrencyMarker,
        amountIsRightmostWord: moneyRange.amountEndWordIndex === row.words.length - 1,
        ...rowCues,
        ...lineFeatures,
      });
    });
  });

  const sortedByAmount = [...candidates].sort((left, right) => {
    if (right.amountCents !== left.amountCents) {
      return right.amountCents - left.amountCents;
    }
    return left.candidateIndex - right.candidateIndex;
  });
  const rankMap = new Map(
    sortedByAmount.map((candidate, index) => [candidate.candidateIndex, index + 1]),
  );

  return candidates.map((candidate) => ({
    ...candidate,
    amountRank: rankMap.get(candidate.candidateIndex),
  }));
}

export function buildReceiptTotalCandidateContext(state, candidate) {
  const flagTokens = [
    candidate.explicitTotalCue ? "cue_total" : "cue_not_total",
    candidate.softTotalCue ? "cue_soft_total" : "cue_not_soft_total",
    candidate.subtotalCue ? "cue_subtotal" : "cue_not_subtotal",
    candidate.taxCue ? "cue_tax" : "cue_not_tax",
    candidate.lineItemCue ? "cue_line_item" : "cue_not_line_item",
    candidate.metadataCue ? "cue_metadata" : "cue_not_metadata",
    candidate.amountCountOnLine > 1 ? "line_multi_amount" : "line_single_amount",
    candidate.explicitCueBeforeAmount ? "cue_before_total" : "cue_before_not_total",
    candidate.softTotalCueBeforeAmount ? "cue_before_soft_total" : "cue_before_not_soft_total",
    candidate.subtotalCueBeforeAmount ? "cue_before_subtotal" : "cue_before_not_subtotal",
    candidate.taxCueBeforeAmount ? "cue_before_tax" : "cue_before_not_tax",
    candidate.amountIsRightmostWord ? "word_rightmost" : "word_not_rightmost",
    candidate.hasCurrencyMarker ? "currency_marked" : "currency_unmarked",
  ];

  const tailExcerpt = state.lines
    .slice(Math.max(0, state.lines.length - 12))
    .map(collapseWhitespace)
    .filter(Boolean)
    .join(" <NL> ");

  return [
    `doc_${state.documentType.replace(/\s+/g, "_").toLowerCase()}`,
    `candidate_rank_${candidate.amountRank}`,
    `candidate_magnitude_${candidate.amountMagnitudeBucket}`,
    `candidate_line_${candidate.lineIndex}`,
    `candidate_page_${candidate.pageIndex}`,
    `candidate_token_${candidate.tokenIndexOnLine}`,
    `candidate_from_bottom_${candidate.fromBottom}`,
    `candidate_position_${candidate.positionBucket}`,
    `page_right_${candidate.pageRightBucket}`,
    `page_left_${candidate.pageLeftBucket}`,
    `page_y_${candidate.pageYBucket}`,
    `page_gap_${candidate.pageRightGapBucket}`,
    `amount_width_${candidate.amountWidthBucket}`,
    `row_words_${candidate.rowWordBucket}`,
    `cue_gap_${candidate.cueGapBucket}`,
    ...flagTokens,
    "top_amounts",
    formatAmountFeatures(state.candidates),
    "prev",
    summarizeContextSegment(candidate.prevLine),
    "left",
    summarizeContextSegment(candidate.leftText),
    "line",
    summarizeContextSegment(candidate.lineText),
    "right",
    summarizeContextSegment(candidate.rightText),
    "next",
    summarizeContextSegment(candidate.nextLine),
    "tail",
    summarizeContextSegment(tailExcerpt),
  ].join(" ");
}

export function buildReceiptTotalState(source) {
  const normalizedSource = normalizeReceiptSource(source);
  const lines = normalizedSource.rows.map((row) => row.text);
  const documentType = inferDocumentType(lines);
  if (looksLikeAccountStatement(lines, documentType)) {
    throw new Error(
      "Account statements are not supported yet. This receipt demo expects one payable invoice or receipt total, not running balances.",
    );
  }
  const candidates = extractReceiptAmountCandidates(normalizedSource);
  if (candidates.length === 0) {
    throw new Error("No money candidates found in OCR text.");
  }

  const baseState = {
    source: normalizedSource.text,
    pageCount: normalizedSource.pageCount,
    rows: normalizedSource.rows,
    lines,
    documentType,
    candidates: [],
  };

  const enrichedCandidates = candidates.map((candidate) => ({
    ...candidate,
    context: "",
  }));
  baseState.candidates = enrichedCandidates.map((candidate) => ({
    ...candidate,
    context: buildReceiptTotalCandidateContext(
      {
        ...baseState,
        candidates: enrichedCandidates,
      },
      candidate,
    ),
  }));
  return baseState;
}

function ensureReceiptTotalState(source) {
  return isReceiptTotalState(source) ? source : buildReceiptTotalState(source);
}

export function buildReceiptTotalProgram(source) {
  const state = ensureReceiptTotalState(source);
  return [
    `OCR_RECEIPT pages=${state.pageCount} lines=${state.lines.length} candidates=${state.candidates.length}`,
    "EXTRACT_AMOUNTS",
    "RANK_TOTAL_BRANCHES",
    "EMIT_TOTAL",
    "HALT",
  ];
}

export function scoreReceiptTotalTeacherCandidate(state, candidate) {
  let score = 0;

  if (candidate.explicitTotalCue) {
    score += 16;
  }
  if (candidate.explicitCueBeforeAmount) {
    score += 9;
  }
  if (candidate.softTotalCue) {
    score += 7;
  }
  if (candidate.softTotalCueBeforeAmount) {
    score += 4;
  }
  if (candidate.positionBucket === "bottom") {
    score += 3;
  }
  if (candidate.pageYBucket === "bottom") {
    score += 2;
  }
  if (candidate.fromBottom <= 3) {
    score += 2;
  }
  if (candidate.amountRank === 1) {
    score += 4;
  } else if (candidate.amountRank === 2) {
    score += 2;
  }
  if (candidate.tokenIndexOnLine === candidate.amountCountOnLine - 1) {
    score += 1;
  }
  if (candidate.amountIsRightmostWord) {
    score += 3;
  }
  if (candidate.hasCurrencyMarker) {
    score += 2;
  }
  if (candidate.pageRightBucket === "edge") {
    score += 6;
  } else if (candidate.pageRightBucket === "far_right") {
    score += 4;
  } else if (candidate.pageRightBucket === "right") {
    score += 2;
  }
  if (candidate.pageRightGapBucket === "tight") {
    score += 3;
  } else if (candidate.pageRightGapBucket === "near") {
    score += 1;
  }
  if (candidate.cueGapBucket === "tight") {
    score += 3;
  } else if (candidate.cueGapBucket === "near") {
    score += 2;
  }

  if (candidate.subtotalCue) {
    score -= 9;
  }
  if (candidate.subtotalCueBeforeAmount) {
    score -= 7;
  }
  if (candidate.taxCue) {
    score -= 10;
  }
  if (candidate.taxCueBeforeAmount) {
    score -= 8;
  }
  if (candidate.lineItemCue && !candidate.explicitTotalCue && !candidate.softTotalCue) {
    score -= 7;
  }
  if (candidate.metadataCue) {
    score -= 5;
  }
  if (candidate.amountCountOnLine > 1) {
    score -= candidate.explicitTotalCue || candidate.explicitCueBeforeAmount ? 6 : 3;
    if (candidate.tokenIndexOnLine !== candidate.amountCountOnLine - 1) {
      score -= 3;
    }
  }
  if (!candidate.amountIsRightmostWord && !candidate.explicitCueBeforeAmount) {
    score -= 2;
  }
  if (candidate.pageRightBucket === "left") {
    score -= 7;
  } else if (candidate.pageRightBucket === "mid") {
    score -= 2;
  }

  return score;
}

export function rankReceiptTotalCandidates(source, scorer = scoreReceiptTotalTeacherCandidate) {
  const state = ensureReceiptTotalState(source);
  return state.candidates
    .map((candidate) => ({
      ...candidate,
      score: scorer(state, candidate),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.amountCents !== left.amountCents) {
        return right.amountCents - left.amountCents;
      }
      return right.lineIndex - left.lineIndex;
    });
}

export function runReceiptTotalPsvm(source, options = {}) {
  const scorer = options.scorer ?? scoreReceiptTotalTeacherCandidate;
  const state = ensureReceiptTotalState(source);
  const rankedCandidates = rankReceiptTotalCandidates(state, scorer);
  const selectedCandidate = rankedCandidates[0];
  if (!selectedCandidate) {
    throw new Error("Receipt total PSVM found no legal candidates.");
  }

  const snapshot = {
    candidateCount: state.candidates.length,
    selectedCandidateIndex: selectedCandidate.candidateIndex,
    selectedAmountCents: selectedCandidate.amountCents,
  };

  return {
    source: state.source,
    program: buildReceiptTotalProgram(state),
    state,
    rankedCandidates,
    selectedCandidate,
    trace: [
      {
        op: "EXTRACT_AMOUNTS",
        candidateCount: state.candidates.length,
        snapshot,
      },
      {
        op: "RANK_TOTAL_BRANCHES",
        topCandidates: rankedCandidates.slice(0, 5).map((candidate) => ({
          candidateIndex: candidate.candidateIndex,
          score: candidate.score,
          preview: formatCandidatePreview(candidate),
        })),
        snapshot,
      },
      {
        op: "EMIT_TOTAL",
        candidateIndex: selectedCandidate.candidateIndex,
        amountText: selectedCandidate.amountText,
        amountCents: selectedCandidate.amountCents,
        lineText: selectedCandidate.lineText,
        snapshot,
      },
      {
        op: "HALT",
        snapshot,
      },
    ],
    result: {
      totalText: selectedCandidate.amountText,
      totalCents: selectedCandidate.amountCents,
    },
  };
}

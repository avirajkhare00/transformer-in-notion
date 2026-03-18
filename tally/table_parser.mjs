import { buildPlainTextReceiptSource, collapseWhitespace } from "../invoice/ocr_layout.mjs";

const MONEY_TOKEN_PATTERN = /(?:₹\s*)?(?:Rs\.?\s*)?[0-9][0-9,]*\.\d{2}/i;
const MONEY_TOKEN_GLOBAL_PATTERN = /(?:₹\s*)?(?:Rs\.?\s*)?[0-9][0-9,]*\.\d{2}/g;
const LEADING_SERIAL_PATTERN = /^\s*(\d{1,4})(?:[.)-]|\s+)/;
const HEADER_TOKEN_LIMIT = 64;
const HEADER_SCORE_THRESHOLD = 8;
const FOOTER_LEAD_PATTERN =
  /^(?:taxable|sub\s*total|grand\s*total|total(?:\s+amount)?|amount\s+(?:due|payable)|round\s*off|roundoff|igst|cgst|sgst|cess|tcs|rupees|inr|bank|declaration|terms|payment\s+term|e&oe|authorised|authorized)/i;
const HEADER_REPEAT_PATTERN =
  /\b(?:description|product|goods|item|particulars)\b/i;

function isStructuredSource(value) {
  return Boolean(value) && typeof value === "object" && Array.isArray(value.rows);
}

function normalizeLineItemSource(source) {
  if (typeof source === "string") {
    return buildPlainTextReceiptSource(source);
  }

  if (!isStructuredSource(source)) {
    throw new Error("Tally table parser requires OCR text or a structured OCR payload.");
  }

  return source;
}

function sortWords(words) {
  return [...(Array.isArray(words) ? words : [])].sort((left, right) => {
    if ((left.xMin ?? 0) !== (right.xMin ?? 0)) {
      return (left.xMin ?? 0) - (right.xMin ?? 0);
    }
    return (left.yMin ?? 0) - (right.yMin ?? 0);
  });
}

function wordCenterX(word) {
  return ((word?.xMin ?? 0) + (word?.xMax ?? 0)) / 2;
}

function cleanToken(value) {
  return String(value ?? "")
    .replace(/^[^A-Za-z0-9₹%/-]+/, "")
    .replace(/[^A-Za-z0-9₹%.:/-]+$/, "");
}

function parseMoneyToCents(value) {
  if (!value) {
    return null;
  }

  const matches = [...String(value).matchAll(MONEY_TOKEN_GLOBAL_PATTERN)];
  if (matches.length === 0) {
    return null;
  }

  const normalized = matches[matches.length - 1][0]
    .trim()
    .replace(/^Rs\.?\s*/i, "")
    .replace(/₹/g, "")
    .replace(/[,\s]/g, "");

  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const [whole, fraction = ""] = normalized.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function extractHsnValue(value) {
  const match = collapseWhitespace(String(value ?? "")).match(/\b\d{4,8}\b/);
  return match?.[0] ?? null;
}

function parseDecimalValue(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/,/g, "")
    .replace(/%/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return null;
  }
  return Number(normalized);
}

function parseLeadingSerial(words) {
  const firstWord = sortWords(words)[0];
  const cleaned = cleanToken(firstWord?.text ?? "");
  if (!/^\d{1,4}$/.test(cleaned)) {
    return null;
  }
  return Number(cleaned);
}

function extractLeadingSerialText(text) {
  const match = collapseWhitespace(text).match(LEADING_SERIAL_PATTERN);
  return match ? Number(match[1]) : null;
}

function extractMoneyTokens(words) {
  return sortWords(words)
    .map((word, index) => {
      const amountCents = parseMoneyToCents(word.text);
      if (amountCents == null) {
        return null;
      }
      return {
        index,
        text: word.text,
        amountCents,
        x: wordCenterX(word),
      };
    })
    .filter(Boolean);
}

function extractPercentTokens(words) {
  const sortedWords = sortWords(words);
  const tokens = [];

  for (let index = 0; index < sortedWords.length; index += 1) {
    const cleaned = cleanToken(sortedWords[index].text);
    const inlineMatch = cleaned.match(/^(\d+(?:\.\d+)?)%$/);
    if (inlineMatch) {
      tokens.push({
        index,
        percent: Number(inlineMatch[1]),
        x: wordCenterX(sortedWords[index]),
      });
      continue;
    }

    const numeric = parseDecimalValue(cleaned);
    if (numeric == null) {
      continue;
    }

    const nextCleaned = cleanToken(sortedWords[index + 1]?.text ?? "");
    if (nextCleaned === "%") {
      tokens.push({
        index,
        percent: numeric,
        x: wordCenterX(sortedWords[index]),
      });
    }
  }

  return tokens;
}

function extractHsnToken(words, stopIndex, excludedValues = new Set()) {
  const sortedWords = sortWords(words);

  for (let index = 0; index < sortedWords.length; index += 1) {
    if (stopIndex != null && index >= stopIndex) {
      break;
    }

    const cleaned = cleanToken(sortedWords[index].text);
    if (!/^\d{4,8}$/.test(cleaned)) {
      continue;
    }
    if (excludedValues.has(cleaned)) {
      continue;
    }
    return {
      token: cleaned,
      index,
      x: wordCenterX(sortedWords[index]),
    };
  }

  return null;
}

function collectHeaderAnchors(rows) {
  const serialPositions = [];
  const descriptionPositions = [];
  const hsnPositions = [];
  const batchPositions = [];
  const expiryPositions = [];
  const quantityPositions = [];
  const unitPositions = [];
  const taxPositions = [];
  const ratePositions = [];
  const amountPositions = [];
  const mrpPositions = [];
  const freePositions = [];
  const schemePositions = [];
  const serialNumberPositions = [];

  for (const row of rows) {
    for (const word of sortWords(row.words).slice(0, HEADER_TOKEN_LIMIT)) {
      const cleaned = cleanToken(word.text).toLowerCase();
      if (!cleaned) {
        continue;
      }

      const x = wordCenterX(word);
      if (/^(?:sr|sr\.|sl|sl\.|s\/n|sno|no|no\.)$/.test(cleaned)) {
        serialPositions.push(x);
      }
      if (/^(?:description|goods|product|particulars|item|items?)$/.test(cleaned)) {
        descriptionPositions.push(x);
      }
      if (cleaned.includes("hsn") || cleaned === "sac") {
        hsnPositions.push(x);
      }
      if (cleaned === "batch" || cleaned === "lot") {
        batchPositions.push(x);
      }
      if (cleaned === "expiry" || cleaned === "exp" || cleaned === "exp.") {
        expiryPositions.push(x);
      }
      if (cleaned === "qty" || cleaned === "qty." || cleaned === "quantity") {
        quantityPositions.push(x);
      }
      if (cleaned === "unit" || cleaned === "uom" || cleaned === "per") {
        unitPositions.push(x);
      }
      if (cleaned === "gst" || cleaned === "tax" || cleaned === "tax%" || cleaned === "%") {
        taxPositions.push(x);
      }
      if (cleaned === "rate" || cleaned === "price" || cleaned === "value") {
        ratePositions.push(x);
      }
      if (cleaned === "amount" || cleaned === "amt" || cleaned === "gross") {
        amountPositions.push(x);
      }
      if (cleaned === "mrp") {
        mrpPositions.push(x);
      }
      if (cleaned === "free") {
        freePositions.push(x);
      }
      if (cleaned === "scheme" || cleaned.startsWith("disc")) {
        schemePositions.push(x);
      }
      if (cleaned === "serial") {
        serialNumberPositions.push(x);
      }
    }
  }

  const anchors = {};
  if (serialPositions.length > 0) {
    anchors.serial = Math.min(...serialPositions);
  }
  if (descriptionPositions.length > 0) {
    anchors.description = Math.min(...descriptionPositions);
  }
  if (hsnPositions.length > 0) {
    anchors.hsnSac = Math.min(...hsnPositions);
  }
  if (batchPositions.length > 0) {
    anchors.batchNumber = Math.min(...batchPositions);
  }
  if (expiryPositions.length > 0) {
    anchors.expiryDate = Math.min(...expiryPositions);
  }
  if (quantityPositions.length > 0) {
    anchors.quantity = Math.min(...quantityPositions);
  }
  if (unitPositions.length > 0) {
    anchors.unit = Math.min(...unitPositions);
  }
  if (taxPositions.length > 0) {
    anchors.taxRate = Math.min(...taxPositions);
  }
  if (mrpPositions.length > 0) {
    anchors.mrp = Math.min(...mrpPositions);
  }
  if (freePositions.length > 0) {
    anchors.freeQuantity = Math.min(...freePositions);
  }
  if (schemePositions.length > 0) {
    anchors.schemeDiscount = Math.min(...schemePositions);
  }
  if (serialNumberPositions.length > 0) {
    anchors.serialNumber = Math.min(...serialNumberPositions);
  }
  if (amountPositions.length > 0) {
    anchors.amount = Math.max(...amountPositions);
  }
  if (ratePositions.length > 0) {
    const amountBoundary = anchors.amount ?? Number.POSITIVE_INFINITY;
    const usableRates = ratePositions.filter((position) => position < amountBoundary);
    anchors.unitPrice = Math.max(...(usableRates.length > 0 ? usableRates : ratePositions));
  }

  const clusterText = rows.map((row) => collapseWhitespace(row.text ?? "")).join(" ");
  const defaultUnitMatch = clusterText.match(/\(\s*([A-Za-z]{1,8})\s*\)/);

  return {
    anchors,
    defaultUnit: defaultUnitMatch?.[1] ?? null,
    clusterText,
  };
}

function scoreHeaderCluster(rows) {
  const { anchors, defaultUnit, clusterText } = collectHeaderAnchors(rows);
  let score = 0;

  if (anchors.description != null) {
    score += 4;
  }
  if (anchors.amount != null) {
    score += 4;
  }
  if (anchors.quantity != null) {
    score += 3;
  }
  if (anchors.unitPrice != null) {
    score += 2;
  }
  if (anchors.hsnSac != null) {
    score += 1;
  }
  if (anchors.taxRate != null) {
    score += 1;
  }
  if (anchors.batchNumber != null) {
    score += 1;
  }
  if (anchors.expiryDate != null) {
    score += 1;
  }
  if (anchors.freeQuantity != null) {
    score += 1;
  }
  if (anchors.schemeDiscount != null) {
    score += 1;
  }
  if (anchors.mrp != null) {
    score += 1;
  }
  if (defaultUnit) {
    score += 1;
  }

  if (!HEADER_REPEAT_PATTERN.test(clusterText) || !/\b(?:amount|qty|quantity|rate|price|gross)\b/i.test(clusterText)) {
    score = 0;
  }

  return {
    score,
    anchors,
    defaultUnit,
  };
}

function buildColumnLayout(anchors) {
  const ordered = Object.entries(anchors)
    .filter(([, x]) => typeof x === "number" && Number.isFinite(x))
    .map(([key, x]) => ({ key, x }))
    .sort((left, right) => left.x - right.x);

  return ordered.map((column, index) => ({
    key: column.key,
    x: column.x,
    left: index === 0 ? Number.NEGATIVE_INFINITY : (ordered[index - 1].x + column.x) / 2,
    right:
      index === ordered.length - 1 ? Number.POSITIVE_INFINITY : (column.x + ordered[index + 1].x) / 2,
  }));
}

function detectLineItemHeader(rows) {
  const maxStart = Math.min(rows.length, 48);
  let best = null;

  for (let startIndex = 0; startIndex < maxStart; startIndex += 1) {
    for (let size = 1; size <= 3; size += 1) {
      const endIndex = startIndex + size - 1;
      if (endIndex >= rows.length) {
        continue;
      }

      const clusterRows = rows.slice(startIndex, endIndex + 1);
      const scored = scoreHeaderCluster(clusterRows);
      if (scored.score < HEADER_SCORE_THRESHOLD) {
        continue;
      }

      const candidate = {
        startRowIndex: startIndex,
        endRowIndex: endIndex,
        size,
        score: scored.score,
        density: scored.score / size,
        anchors: scored.anchors,
        defaultUnit: scored.defaultUnit,
        columns: buildColumnLayout(scored.anchors),
      };

      if (
        !best ||
        candidate.score > best.score ||
        (candidate.score === best.score && candidate.density > best.density) ||
        (candidate.score === best.score &&
          candidate.density === best.density &&
          candidate.startRowIndex > best.startRowIndex)
      ) {
        best = candidate;
      }
    }
  }

  return best;
}

function collectColumnTexts(row, columns) {
  const buckets = new Map(columns.map((column) => [column.key, []]));

  for (const word of sortWords(row.words)) {
    const x = wordCenterX(word);
    const column = columns.find((candidate) => x >= candidate.left && x < candidate.right);
    if (!column) {
      continue;
    }

    const bucket = buckets.get(column.key);
    bucket.push(word);
  }

  return Object.fromEntries(
    [...buckets.entries()].map(([key, words]) => [key, collapseWhitespace(words.map((word) => word.text).join(" "))]),
  );
}

function extractDescriptionFromTokens(sortedWords, options = {}) {
  if (sortedWords.length === 0) {
    return "";
  }

  const startIndex = options.hasLeadingSerial ? 1 : 0;
  const stopIndex = [
    options.hsnIndex,
    options.batchIndex,
    options.expiryIndex,
    options.percentIndex,
    options.quantityIndex,
    options.unitPriceIndex,
    options.amountIndex,
  ]
    .filter((value) => Number.isInteger(value))
    .sort((left, right) => left - right)[0];

  const words = sortedWords.slice(startIndex, stopIndex ?? sortedWords.length);
  const text = collapseWhitespace(words.map((word) => word.text).join(" "));
  if (text) {
    return text.replace(LEADING_SERIAL_PATTERN, "").trim();
  }

  return "";
}

function extractDescriptionFromRow(row, columns, cells, fallbackStopX) {
  const sortedWords = sortWords(row.words);
  if (sortedWords.length === 0) {
    return "";
  }

  const serialRight = columns.find((column) => column.key === "serial")?.right ?? Number.NEGATIVE_INFINITY;
  const hasLeadingSerial = extractLeadingSerialText(row.text ?? "") != null;
  const stopX =
    typeof fallbackStopX === "number"
      ? fallbackStopX
      : columns.find((column) => ["hsnSac", "batchNumber", "expiryDate", "quantity", "taxRate", "unitPrice", "amount"].includes(column.key))?.left ??
        Number.POSITIVE_INFINITY;

  const words = sortedWords.filter((word) => {
    const x = wordCenterX(word);
    return x >= (hasLeadingSerial ? serialRight : Number.NEGATIVE_INFINITY) && x < stopX;
  });

  const text = collapseWhitespace(words.map((word) => word.text).join(" "));
  if (text) {
    return text.replace(LEADING_SERIAL_PATTERN, "").trim();
  }

  return "";
}

function parseQuantityWithUnit(value, defaultUnit = null) {
  const compact = collapseWhitespace(value ?? "");
  const match = compact.match(/(-?\d+(?:,\d{3})*(?:\.\d+)?)(?:\s+([A-Za-z][A-Za-z./-]{0,10}))?/);
  if (!match) {
    return {
      quantity: null,
      unit: defaultUnit,
    };
  }

  return {
    quantity: parseDecimalValue(match[1]),
    unit: match[2] ?? defaultUnit,
  };
}

function parsePercentValue(value) {
  const match = collapseWhitespace(value ?? "").match(/(-?\d+(?:\.\d+)?)\s*%/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function extractExpiryDate(value) {
  const match = collapseWhitespace(value ?? "").match(
    /\b(?:\d{1,2}[/-]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[A-Za-z]*[/-]?\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[A-Za-z]*\s+\d{2,4})\b/i,
  );
  return match?.[0] ?? null;
}

function extractBatchNumber(value) {
  const text = collapseWhitespace(String(value ?? ""));
  const hadLabel = /\b(?:batch|lot)\b/i.test(text);
  const cleaned = collapseWhitespace(text.replace(/\b(?:batch|lot|no|number)\b/gi, " "));
  const match = cleaned.match(/\b[A-Z0-9][A-Z0-9/-]{1,24}\b/i);
  if (!match) {
    return null;
  }
  if (!hadLabel && !/\d/.test(match[0])) {
    return null;
  }
  return match[0];
}

function extractSerialNumber(value) {
  const text = collapseWhitespace(String(value ?? ""));
  const hadLabel = /\b(?:serial|sr\.?\s*no|sr\s*no)\b/i.test(text);
  const cleaned = collapseWhitespace(text.replace(/\b(?:serial|sr|no|number)\b/gi, " "));
  const match = cleaned.match(/\b[A-Z0-9][A-Z0-9/-]{2,24}\b/i);
  if (!match) {
    return null;
  }
  if (!hadLabel && !(/\d/.test(match[0]) && /[A-Za-z]/.test(match[0]))) {
    return null;
  }
  return match[0];
}

function extractFallbackQuantity(sortedWords, serialIndex, hsnIndex, firstMoneyIndex, percentIndices, defaultUnit) {
  const maxIndex = firstMoneyIndex == null ? sortedWords.length : firstMoneyIndex;
  const excluded = new Set([serialIndex, hsnIndex, ...percentIndices].filter((index) => index != null));

  for (let index = maxIndex - 1; index >= 0; index -= 1) {
    if (excluded.has(index)) {
      continue;
    }

    const cleaned = cleanToken(sortedWords[index]?.text ?? "");
    const quantity = parseDecimalValue(cleaned);
    if (quantity == null) {
      continue;
    }
    if (cleaned.includes(".") && cleaned.split(".")[1].length > 4) {
      continue;
    }

    const nextToken = cleanToken(sortedWords[index + 1]?.text ?? "");
    const unit = /^[A-Za-z][A-Za-z./-]{0,10}$/.test(nextToken) ? nextToken : defaultUnit;
    return {
      quantity,
      unit,
      index,
    };
  }

  return {
    quantity: null,
    unit: defaultUnit,
    index: null,
  };
}

function parseItemRow(row, header, currentItem) {
  const rowText = collapseWhitespace(row.text ?? "");
  if (!rowText) {
    return { kind: "skip" };
  }

  const headerCluster = scoreHeaderCluster([row]);
  if (headerCluster.score >= HEADER_SCORE_THRESHOLD && HEADER_REPEAT_PATTERN.test(rowText)) {
    return { kind: "header_repeat" };
  }

  const leadingSerial = extractLeadingSerialText(rowText);
  if (!leadingSerial && FOOTER_LEAD_PATTERN.test(rowText)) {
    return { kind: "footer" };
  }

  const cells = collectColumnTexts(row, header.columns);
  const sortedWords = sortWords(row.words);
  const moneyTokens = extractMoneyTokens(sortedWords);
  const percentTokens = extractPercentTokens(sortedWords);
  const serial = parseDecimalValue(cells.serial) ?? leadingSerial ?? parseLeadingSerial(sortedWords);
  const amountToken = moneyTokens[moneyTokens.length - 1] ?? null;
  const unitPriceToken = moneyTokens.length >= 2 ? moneyTokens[moneyTokens.length - 2] : null;
  const excludedHsnValues = new Set(serial != null ? [String(serial)] : []);
  const hsnToken = extractHsnToken(
    sortedWords,
    amountToken?.index ?? null,
    excludedHsnValues,
  );
  const quantityFromCell = parseQuantityWithUnit(cells.quantity, header.defaultUnit);
  const fallbackQuantity = extractFallbackQuantity(
    sortedWords,
    leadingSerial != null ? 0 : null,
    hsnToken?.index ?? null,
    moneyTokens[0]?.index ?? null,
    percentTokens.map((token) => token.index),
    header.defaultUnit,
  );
  const quantity = quantityFromCell.quantity ?? fallbackQuantity.quantity;
  const unit = quantityFromCell.unit ?? fallbackQuantity.unit;
  const taxRatePercent = parsePercentValue(cells.taxRate) ?? percentTokens[0]?.percent ?? null;
  const description =
    extractDescriptionFromTokens(sortedWords, {
      hasLeadingSerial: leadingSerial != null,
      hsnIndex: hsnToken?.index ?? null,
      percentIndex: percentTokens[0]?.index ?? null,
      quantityIndex: fallbackQuantity.index ?? null,
      unitPriceIndex: unitPriceToken?.index ?? null,
      amountIndex: amountToken?.index ?? null,
    }) ||
    extractDescriptionFromRow(
      row,
      header.columns,
      cells,
      [header.columns.find((column) => column.key === "hsnSac")?.left, header.columns.find((column) => column.key === "batchNumber")?.left, header.columns.find((column) => column.key === "expiryDate")?.left, header.columns.find((column) => column.key === "quantity")?.left, header.columns.find((column) => column.key === "taxRate")?.left, header.columns.find((column) => column.key === "unitPrice")?.left, header.columns.find((column) => column.key === "amount")?.left]
        .filter((value) => typeof value === "number")
        .sort((left, right) => left - right)[0] ?? null,
    )
      .replace(LEADING_SERIAL_PATTERN, "")
      .trim();

  const lineItem = {
    index: serial != null ? serial - 1 : currentItem?.index != null ? currentItem.index : null,
    serialNumber: extractSerialNumber(cells.serialNumber),
    description,
    hsnSac: extractHsnValue(cells.hsnSac) ?? hsnToken?.token ?? null,
    batchNumber: extractBatchNumber(cells.batchNumber),
    expiryDate: extractExpiryDate(cells.expiryDate),
    quantity,
    unit: unit || null,
    freeQuantity: parseDecimalValue(cells.freeQuantity),
    mrpCents: parseMoneyToCents(cells.mrp),
    unitPriceCents: parseMoneyToCents(cells.unitPrice) ?? unitPriceToken?.amountCents ?? null,
    taxRatePercent,
    schemeDiscountCents: parseMoneyToCents(cells.schemeDiscount),
    amountCents: parseMoneyToCents(cells.amount) ?? amountToken?.amountCents ?? null,
    rowStartIndex: row.rowIndex,
    rowEndIndex: row.rowIndex,
    pageIndex: row.pageIndex ?? 0,
    source: "table_parser",
  };

  const hasNewItemSignal =
    lineItem.amountCents != null ||
    lineItem.unitPriceCents != null ||
    lineItem.hsnSac != null ||
    serial != null;

  if (!hasNewItemSignal) {
    const continuationText = collapseWhitespace(
      sortedWords
        .filter((word) => !MONEY_TOKEN_PATTERN.test(word.text))
        .map((word) => word.text)
        .join(" "),
    );

    if (currentItem && continuationText) {
      return {
        kind: "continuation",
        text: continuationText,
        batchNumber: extractBatchNumber(rowText),
        expiryDate: extractExpiryDate(rowText),
        serialNumber: extractSerialNumber(rowText),
      };
    }

    return { kind: "skip" };
  }

  if (!lineItem.description && currentItem && !serial && moneyTokens.length === 0) {
    return {
      kind: "continuation",
      text: rowText,
      batchNumber: extractBatchNumber(rowText),
      expiryDate: extractExpiryDate(rowText),
      serialNumber: extractSerialNumber(rowText),
    };
  }

  return {
    kind: "item",
    item: lineItem,
  };
}

function mergeLineItem(primary, fallback, index) {
  const merged = {
    index,
    description: primary?.description ?? fallback?.description ?? null,
    hsnSac: primary?.hsnSac ?? fallback?.hsnSac ?? null,
    quantity: primary?.quantity ?? fallback?.quantity ?? null,
    unit: primary?.unit ?? fallback?.unit ?? null,
    unitPriceCents: primary?.unitPriceCents ?? fallback?.unitPriceCents ?? null,
    taxRatePercent: primary?.taxRatePercent ?? fallback?.taxRatePercent ?? null,
    amountCents: primary?.amountCents ?? fallback?.amountCents ?? null,
    batchNumber: primary?.batchNumber ?? fallback?.batchNumber ?? null,
    expiryDate: primary?.expiryDate ?? fallback?.expiryDate ?? null,
    mrpCents: primary?.mrpCents ?? fallback?.mrpCents ?? null,
    serialNumber: primary?.serialNumber ?? fallback?.serialNumber ?? null,
    freeQuantity: primary?.freeQuantity ?? fallback?.freeQuantity ?? null,
    schemeDiscountCents: primary?.schemeDiscountCents ?? fallback?.schemeDiscountCents ?? null,
    rowStartIndex: primary?.rowStartIndex ?? fallback?.rowStartIndex ?? null,
    rowEndIndex: primary?.rowEndIndex ?? fallback?.rowEndIndex ?? null,
    pageIndex: primary?.pageIndex ?? fallback?.pageIndex ?? 0,
    source:
      primary?.source && fallback?.source && primary.source !== fallback.source
        ? `${primary.source}+${fallback.source}`
        : primary?.source ?? fallback?.source ?? "table_parser",
  };

  return merged;
}

export function mergeTallyLineItems(primaryItems = [], fallbackItems = []) {
  const merged = [];
  const count = Math.max(primaryItems.length, fallbackItems.length);

  for (let index = 0; index < count; index += 1) {
    const primary = primaryItems[index] ?? null;
    const fallback = fallbackItems[index] ?? null;
    if (!primary && !fallback) {
      continue;
    }

    merged.push(mergeLineItem(primary, fallback, index));
  }

  return merged;
}

export function extractTallyLineItems(source, options = {}) {
  const normalizedSource = normalizeLineItemSource(source);
  const header = detectLineItemHeader(normalizedSource.rows);
  if (!header) {
    return {
      header: null,
      items: [],
    };
  }

  const items = [];
  let currentItem = null;

  for (let index = header.endRowIndex + 1; index < normalizedSource.rows.length; index += 1) {
    const row = normalizedSource.rows[index];
    const parsedRow = parseItemRow(row, header, currentItem);

    if (parsedRow.kind === "header_repeat") {
      continue;
    }

    if (parsedRow.kind === "footer") {
      break;
    }

    if (parsedRow.kind === "continuation") {
      if (currentItem) {
        currentItem.description = collapseWhitespace(`${currentItem.description ?? ""} ${parsedRow.text}`.trim());
        currentItem.rowEndIndex = row.rowIndex;
        currentItem.batchNumber = currentItem.batchNumber ?? parsedRow.batchNumber ?? null;
        currentItem.expiryDate = currentItem.expiryDate ?? parsedRow.expiryDate ?? null;
        currentItem.serialNumber = currentItem.serialNumber ?? parsedRow.serialNumber ?? null;
      }
      continue;
    }

    if (parsedRow.kind !== "item") {
      continue;
    }

    if (currentItem) {
      items.push(currentItem);
    }

    currentItem = parsedRow.item;
  }

  if (currentItem) {
    items.push(currentItem);
  }

  const normalizedItems = items
    .map((item, index) => ({
      ...item,
      index: Number.isInteger(item.index) && item.index >= 0 ? item.index : index,
      description: collapseWhitespace(item.description ?? ""),
      unit: item.unit ? collapseWhitespace(item.unit) : null,
      batchNumber: item.batchNumber ? collapseWhitespace(item.batchNumber) : null,
      expiryDate: item.expiryDate ? collapseWhitespace(item.expiryDate) : null,
      serialNumber: item.serialNumber ? collapseWhitespace(item.serialNumber) : null,
    }))
    .filter(
      (item) =>
        item.description &&
        (item.amountCents != null || (item.quantity != null && item.unitPriceCents != null)),
    )
    .map((item) => ({
      ...item,
      amountCents:
        item.amountCents != null
          ? item.amountCents
          : item.quantity != null && item.unitPriceCents != null
            ? Math.round(item.quantity * item.unitPriceCents)
            : null,
    }));

  return {
    header,
    items: normalizedItems,
  };
}

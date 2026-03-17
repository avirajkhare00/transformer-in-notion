import { formatCents, runInvoicePsvm } from "./psvm.mjs";

const GSTIN_PATTERN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/g;
const DATE_VALUE_PATTERN = /^(?:\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}-[A-Za-z]{3}-\d{2,4})$/;
const MONEY_TOKEN_PATTERN = /(?:₹\s*)?(?:Rs\.?\s*)?[0-9][0-9,]*\.\d{2}/g;
const COMPANY_SUFFIX_PATTERN = /\b(?:LLP|LTD\.?|LIMITED|PRIVATE LIMITED|PVT\.?\s+LTD\.?)\b/i;
const DETAILED_ITEM_PATTERN =
  /^\s*(\d+)\s+(.+?)\s+(\d{4,8})\s+(\d+(?:\.\d+)?)\s*%\s+([0-9,]+(?:\.\d+)?)\s+([A-Za-z]+)\s+([0-9,]+\.\d{2})\s+([0-9,]+\.\d{2})\s+([A-Za-z]+)\s+((?:₹\s*)?(?:Rs\.?\s*)?[0-9][0-9,]*\.\d{2})\s*$/;
const SIMPLE_ITEM_PATTERN =
  /^\s*(\d+)\s+(.+?)\s+([0-9,]+(?:\.\d+)?)\s+((?:₹\s*)?(?:Rs\.?\s*)?[0-9][0-9,]*\.\d{2})\s+((?:₹\s*)?(?:Rs\.?\s*)?[0-9][0-9,]*\.\d{2})\s*$/;

export function normalizeReceiptText(source) {
  if (typeof source !== "string") {
    throw new Error("Receipt source must be a string.");
  }

  return source
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\u200b/g, "")
    .trim();
}

function collapseWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function extractColumns(value) {
  return value
    .split(/\s{2,}/)
    .map((part) => collapseWhitespace(part))
    .filter(Boolean);
}

function leadingColumnText(value) {
  const compact = extractColumns(value)[0];

  return compact ?? collapseWhitespace(value);
}

function parseMoneyToCents(value) {
  const normalized = String(value)
    .trim()
    .replace(/^Rs\.?\s*/i, "")
    .replace(/₹/g, "")
    .replace(/[,\s]/g, "");

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`Invalid receipt money value: ${value}`);
  }

  const [whole, fraction = ""] = normalized.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function parseQuantityValue(value) {
  const normalized = String(value).trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,3})?$/.test(normalized)) {
    throw new Error(`Invalid receipt quantity value: ${value}`);
  }

  const [whole, fraction = ""] = normalized.split(".");
  const thousandths = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
  return {
    value: thousandths / 1000,
    thousandths,
  };
}

function centsToDecimalString(cents) {
  return (cents / 100).toFixed(2);
}

function formatQuantity(value) {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(3).replace(/\.?0+$/, "");
}

function findLineIndex(lines, pattern, startIndex = 0) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (lines[index].match(pattern)) {
      return index;
    }
  }

  return -1;
}

function nextNonEmptyLine(lines, startIndex) {
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = leadingColumnText(lines[index]);
    if (line) {
      return line;
    }
  }

  return null;
}

function findDistinctGstins(text) {
  return [...new Set(text.match(GSTIN_PATTERN) ?? [])];
}

function cleanFieldCandidate(fragment) {
  return leadingColumnText(fragment.replace(/^[:\s]+/, ""));
}

function extractLabeledValue(lines, labelRegex, validator) {
  const pattern = new RegExp(labelRegex.source, labelRegex.flags.replace(/g/g, ""));

  for (let index = 0; index < lines.length; index += 1) {
    const match = pattern.exec(lines[index]);
    if (!match) {
      continue;
    }

    const labelIndex = match.index ?? lines[index].indexOf(match[0]);
    const inlineCandidate = cleanFieldCandidate(
      lines[index].slice(labelIndex + match[0].length),
    );
    if (validator(inlineCandidate)) {
      return inlineCandidate;
    }

    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 4); cursor += 1) {
      const projectedCandidate = cleanFieldCandidate(lines[cursor].slice(labelIndex));
      if (validator(projectedCandidate)) {
        return projectedCandidate;
      }
    }
  }

  return null;
}

function inferCurrency(text) {
  if (/₹|\bINR\b|\bRs\.?\b/i.test(text)) {
    return "INR";
  }

  return "USD";
}

function extractDocumentType(text) {
  if (/PROFORMA INVOICE/i.test(text)) {
    return "PROFORMA INVOICE";
  }

  if (/TAX INVOICE/i.test(text)) {
    return "TAX INVOICE";
  }

  if (/\bINVOICE\b/i.test(text)) {
    return "INVOICE";
  }

  return "RECEIPT";
}

function extractInvoiceNumber(lines) {
  return (
    extractLabeledValue(lines, /PI No\.?/i, (value) => /^[A-Z0-9][A-Z0-9/-]*$/i.test(value)) ??
    extractLabeledValue(lines, /Invoice No\.?/i, (value) => /^[A-Z0-9][A-Z0-9/-]*$/i.test(value))
  );
}

function extractDocumentDate(lines) {
  return (
    extractLabeledValue(lines, /Date\s*:/i, (value) => DATE_VALUE_PATTERN.test(value)) ??
    extractLabeledValue(lines, /Ack Date/i, (value) => DATE_VALUE_PATTERN.test(value)) ??
    extractLabeledValue(lines, /\bDated\b/i, (value) => DATE_VALUE_PATTERN.test(value))
  );
}

function isCompanyNameCandidate(line, excludedNames = new Set()) {
  const text = collapseWhitespace(line);
  if (!text) {
    return false;
  }

  if (excludedNames.has(text.toUpperCase())) {
    return false;
  }

  if (!COMPANY_SUFFIX_PATTERN.test(text)) {
    return false;
  }

  if (text.length > 80) {
    return false;
  }

  if (/[|:]/.test(text)) {
    return false;
  }

  if (
    /\b(?:INVOICE|DETAILS|DECLARATION|AUTHORISED|JURISDICTION|BANK|PAYMENT|BUYER|CONSIGNEE|GSTIN|GST NO|E-MAIL|PLACE OF SUPPLY|TOTAL|SUB TOTAL|TAXABLE)\b/i.test(
      text,
    )
  ) {
    return false;
  }

  return true;
}

function scoreCompanyName(text) {
  let score = 0;
  if (text.length <= 40) {
    score += 2;
  }
  if (!/[0-9]/.test(text)) {
    score += 1;
  }
  if (!text.includes(",")) {
    score += 1;
  }
  if (/[A-Z][a-z]/.test(text)) {
    score += 1;
  }
  return score;
}

function pickCompanyCandidate(lines, excluded = [], preferBottom = false) {
  const excludedNames = new Set(
    excluded.filter(Boolean).map((value) => collapseWhitespace(value).toUpperCase()),
  );
  const candidates = [];

  for (let index = 0; index < lines.length; index += 1) {
    for (const text of extractColumns(lines[index])) {
      if (!isCompanyNameCandidate(text, excludedNames)) {
        continue;
      }

      candidates.push({
        text,
        index,
        score: scoreCompanyName(text),
      });
    }
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return preferBottom ? right.index - left.index : left.index - right.index;
  });

  return candidates[0]?.text ?? null;
}

function findFirstGstin(lines) {
  return findDistinctGstins(lines.join("\n"))[0] ?? null;
}

function extractParties(lines, text) {
  const soldToIndex = findLineIndex(lines, /^Sold to$/i);
  if (soldToIndex >= 0) {
    const paymentIndex = findLineIndex(lines, /PAYMENT TERM/i, soldToIndex);
    const buyerLines = lines.slice(
      soldToIndex,
      paymentIndex > soldToIndex ? paymentIndex : soldToIndex + 12,
    );
    const buyerName = nextNonEmptyLine(lines, soldToIndex);
    const buyerGstin = findFirstGstin(buyerLines);
    const sellerGstin =
      findDistinctGstins(text).find((value) => value !== buyerGstin) ?? null;
    const sellerName = pickCompanyCandidate(lines, [buyerName], true);

    return {
      seller: {
        name: sellerName,
        gstin: sellerGstin,
      },
      buyer: {
        name: buyerName,
        gstin: buyerGstin,
      },
      consignee: null,
    };
  }

  const consigneeIndex = findLineIndex(lines, /^Consignee \(Ship to\)$/i);
  const buyerIndex = findLineIndex(lines, /^Buyer \(Bill to\)$/i);
  const sellerLines = lines.slice(
    0,
    consigneeIndex >= 0 ? consigneeIndex : Math.min(lines.length, 30),
  );
  const sellerName = pickCompanyCandidate(sellerLines);
  const sellerGstin = findFirstGstin(sellerLines);

  const tableIndex = findLineIndex(
    lines,
    /(?:^|\s)Sl\s+Description of Goods|Description of Goods/i,
    buyerIndex >= 0 ? buyerIndex : 0,
  );
  const buyerLines =
    buyerIndex >= 0
      ? lines.slice(
          buyerIndex,
          tableIndex > buyerIndex ? tableIndex : Math.min(lines.length, buyerIndex + 12),
        )
      : [];
  const consigneeLines =
    consigneeIndex >= 0
      ? lines.slice(
          consigneeIndex,
          buyerIndex > consigneeIndex
            ? buyerIndex
            : Math.min(lines.length, consigneeIndex + 12),
        )
      : [];

  const buyerName =
    (buyerIndex >= 0 ? nextNonEmptyLine(lines, buyerIndex) : null) ??
    (consigneeIndex >= 0 ? nextNonEmptyLine(lines, consigneeIndex) : null);
  const buyerGstin =
    (buyerIndex >= 0 ? findFirstGstin(buyerLines) : null) ??
    (consigneeIndex >= 0 ? findFirstGstin(consigneeLines) : null);
  const consigneeName = consigneeIndex >= 0 ? nextNonEmptyLine(lines, consigneeIndex) : null;
  const consigneeGstin = consigneeIndex >= 0 ? findFirstGstin(consigneeLines) : null;

  return {
    seller: {
      name: sellerName,
      gstin: sellerGstin,
    },
    buyer: {
      name: buyerName,
      gstin: buyerGstin,
    },
    consignee:
      consigneeName || consigneeGstin
        ? {
            name: consigneeName,
            gstin: consigneeGstin,
          }
        : null,
  };
}

function shouldStopDescription(line) {
  const text = collapseWhitespace(line);
  if (!text) {
    return true;
  }

  return /^(?:\d+\s+|IGST\b|CGST\b|SGST\b|GST\b|Bill Details:|On Account\b|Total\b|Amount Chargeable\b|HSN\/SAC\b|Tax Amount\b|Declaration\b|Company's Bank Details\b|Bank Name\b|A\/c No\b|Branch\b|SUBJECT TO\b)/i.test(
    text,
  );
}

function extractReceiptItems(lines) {
  const items = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const detailed = rawLine.match(DETAILED_ITEM_PATTERN);
    if (detailed) {
      const quantity = parseQuantityValue(detailed[5]);
      const descriptionLines = [collapseWhitespace(detailed[2])];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const continuation = collapseWhitespace(lines[cursor]);
        if (shouldStopDescription(continuation)) {
          break;
        }

        descriptionLines.push(continuation);
        cursor += 1;
      }

      items.push({
        index: Number(detailed[1]),
        description: descriptionLines.join(" "),
        hsnSac: detailed[3],
        taxRate: Number(detailed[4]) / 100,
        quantity: quantity.value,
        quantityThousandths: quantity.thousandths,
        quantityUnit: detailed[6],
        inclusiveUnitPriceCents: parseMoneyToCents(detailed[7]),
        unitPriceCents: parseMoneyToCents(detailed[8]),
        rateUnit: detailed[9],
        lineAmountCents: parseMoneyToCents(detailed[10]),
      });
      index = cursor - 1;
      continue;
    }

    const simple = rawLine.match(SIMPLE_ITEM_PATTERN);
    if (!simple) {
      continue;
    }

    const quantity = parseQuantityValue(simple[3]);
    items.push({
      index: Number(simple[1]),
      description: collapseWhitespace(simple[2]),
      hsnSac: null,
      taxRate: null,
      quantity: quantity.value,
      quantityThousandths: quantity.thousandths,
      quantityUnit: null,
      inclusiveUnitPriceCents: null,
      unitPriceCents: parseMoneyToCents(simple[4]),
      rateUnit: null,
      lineAmountCents: parseMoneyToCents(simple[5]),
    });
  }

  return items;
}

function extractRateFromText(text) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? Number(match[1]) / 100 : null;
}

function extractSummary(lines) {
  const taxLines = [];
  let taxableAmountCents = null;
  let subtotalAmountCents = null;
  let totalAmountCents = null;
  let tcsCents = null;
  let roundOffCents = null;

  for (const rawLine of lines) {
    const line = collapseWhitespace(rawLine);
    if (!line) {
      continue;
    }

    const moneyMatches = [...line.matchAll(MONEY_TOKEN_PATTERN)];
    const trailingAmount =
      moneyMatches.length > 0
        ? parseMoneyToCents(moneyMatches[moneyMatches.length - 1][0])
        : null;

    if (/^TAXABLE\b/i.test(line) && moneyMatches.length === 1) {
      taxableAmountCents = trailingAmount;
      continue;
    }

    if (/^Sub Total\b/i.test(line) && moneyMatches.length === 1) {
      subtotalAmountCents = trailingAmount;
      continue;
    }

    if (/\bTOTAL\b/i.test(line) && moneyMatches.length === 1) {
      totalAmountCents = trailingAmount;
      continue;
    }

    if (/^TCS\b/i.test(line)) {
      tcsCents = line.endsWith("-") ? 0 : trailingAmount;
      continue;
    }

    if (/^Round Off\b/i.test(line)) {
      roundOffCents = line.endsWith("-") ? 0 : trailingAmount;
      continue;
    }

    if (
      (/^(?:IGST|CGST|SGST)\b/i.test(line) || /^GST\b/i.test(line)) &&
      moneyMatches.length === 1
    ) {
      taxLines.push({
        label: collapseWhitespace(line.replace(MONEY_TOKEN_PATTERN, "")),
        rate: extractRateFromText(line),
        amountCents: trailingAmount,
      });
    }
  }

  return {
    taxableAmountCents,
    subtotalAmountCents,
    totalAmountCents,
    taxLines,
    tcsCents,
    roundOffCents,
  };
}

function uniqueRates(values) {
  const rates = [];
  for (const value of values) {
    if (typeof value !== "number" || Number.isNaN(value)) {
      continue;
    }

    if (!rates.some((candidate) => Math.abs(candidate - value) < 0.000001)) {
      rates.push(value);
    }
  }

  return rates;
}

function inferInvoiceTaxRate(receipt) {
  const explicitRates = uniqueRates([
    ...receipt.summary.taxLines.map((taxLine) => taxLine.rate),
    ...receipt.items.map((item) => item.taxRate),
  ]);

  if (explicitRates.length > 1) {
    throw new Error("Receipt uses multiple tax rates. The invoice PSVM only supports one rate.");
  }

  if (explicitRates.length === 1) {
    return explicitRates[0];
  }

  const declaredTaxCents = receipt.summary.taxLines.reduce(
    (sum, taxLine) => sum + taxLine.amountCents,
    0,
  );
  const taxableBaseCents =
    receipt.summary.taxableAmountCents ??
    receipt.items.reduce((sum, item) => sum + item.lineAmountCents, 0);

  if (declaredTaxCents > 0 && taxableBaseCents > 0) {
    return Math.round((declaredTaxCents / taxableBaseCents) * 10000) / 10000;
  }

  return 0;
}

function computeLineAmountCents(quantityThousandths, unitPriceCents) {
  return Math.round((quantityThousandths * unitPriceCents) / 1000);
}

function inferredUnitPriceCents(item, invoiceTaxRate) {
  if (typeof item.unitPriceCents === "number") {
    return item.unitPriceCents;
  }

  if (typeof item.inclusiveUnitPriceCents === "number" && invoiceTaxRate > 0) {
    return Math.round(item.inclusiveUnitPriceCents / (1 + invoiceTaxRate));
  }

  if (typeof item.lineAmountCents === "number") {
    return Math.round((item.lineAmountCents * 1000) / item.quantityThousandths);
  }

  return null;
}

function formatParty(party) {
  if (!party) {
    return "missing";
  }

  const name = party.name ?? "missing";
  return party.gstin ? `${name} (${party.gstin})` : name;
}

function formatMaybeAmount(cents, currency) {
  return typeof cents === "number" ? formatCents(cents, currency) : "missing";
}

function createCheck(kind, label, pass, expected = null, actual = null) {
  return {
    kind,
    label,
    pass,
    expected,
    actual,
  };
}

function createPresenceCheck(kind, label, value) {
  return createCheck(kind, label, Boolean(value), "present", value ?? "missing");
}

function createAmountCheck(kind, label, expectedCents, actualCents, currency) {
  return createCheck(
    kind,
    label,
    expectedCents === actualCents,
    formatMaybeAmount(expectedCents, currency),
    formatMaybeAmount(actualCents, currency),
  );
}

export function parseReceiptText(source) {
  const text = normalizeReceiptText(source);
  const lines = text.split("\n").map((line) => line.replace(/\s+$/, ""));
  const items = extractReceiptItems(lines);
  if (items.length === 0) {
    throw new Error("No receipt line items found in text.");
  }

  const parties = extractParties(lines, text);
  return {
    documentType: extractDocumentType(text),
    currency: inferCurrency(text),
    invoiceNumber: extractInvoiceNumber(lines),
    documentDate: extractDocumentDate(lines),
    seller: parties.seller,
    buyer: parties.buyer,
    consignee: parties.consignee,
    items,
    summary: extractSummary(lines),
  };
}

export function buildInvoiceFromReceipt(receipt) {
  const invoiceTaxRate = inferInvoiceTaxRate(receipt);
  const items = receipt.items.map((item) => {
    const unitPriceCents = inferredUnitPriceCents(item, invoiceTaxRate);
    if (unitPriceCents == null) {
      throw new Error(`Unable to infer unit price for receipt line ${item.index}.`);
    }

    return {
      label: item.description,
      quantity: item.quantity,
      unitPrice: centsToDecimalString(unitPriceCents),
      unit: item.quantityUnit ?? undefined,
    };
  });

  return {
    currency: receipt.currency,
    taxRate: invoiceTaxRate,
    items,
  };
}

export function verifyReceipt(source) {
  const receipt = typeof source === "string" ? parseReceiptText(source) : source;
  const invoice = buildInvoiceFromReceipt(receipt);
  const execution = runInvoicePsvm(JSON.stringify(invoice));
  const declaredTaxCents = receipt.summary.taxLines.reduce(
    (sum, taxLine) => sum + taxLine.amountCents,
    0,
  );
  const declaredGrossFromInclusiveRates = receipt.items.some(
    (item) => typeof item.inclusiveUnitPriceCents === "number",
  )
    ? receipt.items.reduce((sum, item) => {
        if (typeof item.inclusiveUnitPriceCents !== "number") {
          return sum;
        }

        return sum + computeLineAmountCents(item.quantityThousandths, item.inclusiveUnitPriceCents);
      }, 0)
    : null;

  const checks = [
    createPresenceCheck("metadata", "Invoice number", receipt.invoiceNumber),
    createPresenceCheck("metadata", "Seller name", receipt.seller?.name),
    createPresenceCheck("metadata", "Buyer name", receipt.buyer?.name),
    createPresenceCheck("metadata", "Seller GSTIN", receipt.seller?.gstin),
    createPresenceCheck("metadata", "Buyer GSTIN", receipt.buyer?.gstin),
  ];

  for (const item of receipt.items) {
    const unitPriceCents = inferredUnitPriceCents(item, invoice.taxRate);
    if (unitPriceCents == null || typeof item.lineAmountCents !== "number") {
      continue;
    }

    checks.push(
      createAmountCheck(
        "arithmetic",
        `Line ${item.index} amount`,
        computeLineAmountCents(item.quantityThousandths, unitPriceCents),
        item.lineAmountCents,
        receipt.currency,
      ),
    );
  }

  if (typeof receipt.summary.taxableAmountCents === "number") {
    checks.push(
      createAmountCheck(
        "arithmetic",
        "Taxable amount",
        execution.result.subtotalCents,
        receipt.summary.taxableAmountCents,
        receipt.currency,
      ),
    );
  }

  if (receipt.summary.taxLines.length > 0) {
    checks.push(
      createAmountCheck(
        "arithmetic",
        "Tax amount",
        execution.result.taxCents,
        declaredTaxCents,
        receipt.currency,
      ),
    );
  }

  if (typeof receipt.summary.totalAmountCents === "number") {
    checks.push(
      createAmountCheck(
        "arithmetic",
        "Total amount",
        execution.result.totalCents,
        receipt.summary.totalAmountCents,
        receipt.currency,
      ),
    );
  }

  if (
    typeof declaredGrossFromInclusiveRates === "number" &&
    typeof receipt.summary.totalAmountCents === "number"
  ) {
    checks.push(
      createAmountCheck(
        "arithmetic",
        "Inclusive rate cross-check",
        declaredGrossFromInclusiveRates,
        receipt.summary.totalAmountCents,
        receipt.currency,
      ),
    );
  }

  const issues = checks
    .filter((check) => !check.pass)
    .map((check) => `${check.label}: expected ${check.expected}, actual ${check.actual}`);

  return {
    ok: issues.length === 0,
    receipt,
    invoice,
    computed: {
      taxableAmountCents: execution.result.subtotalCents,
      taxAmountCents: execution.result.taxCents,
      totalAmountCents: execution.result.totalCents,
    },
    declared: {
      taxableAmountCents: receipt.summary.taxableAmountCents,
      taxAmountCents: receipt.summary.taxLines.length > 0 ? declaredTaxCents : null,
      totalAmountCents: receipt.summary.totalAmountCents,
    },
    checks,
    issues,
  };
}

export function formatReceiptVerificationReport(source) {
  const report =
    typeof source === "string" || !source || !Array.isArray(source.checks)
      ? verifyReceipt(source)
      : source;

  const lines = [];
  const title = [report.ok ? "PASS" : "FAIL", report.receipt.documentType];
  if (report.receipt.invoiceNumber) {
    title.push(report.receipt.invoiceNumber);
  }
  lines.push(title.join(" | "));

  if (report.receipt.documentDate) {
    lines.push(`Date: ${report.receipt.documentDate}`);
  }
  lines.push(`Seller: ${formatParty(report.receipt.seller)}`);
  lines.push(`Buyer: ${formatParty(report.receipt.buyer)}`);
  if (
    report.receipt.consignee?.name &&
    report.receipt.consignee.name !== report.receipt.buyer?.name
  ) {
    lines.push(`Consignee: ${formatParty(report.receipt.consignee)}`);
  }

  lines.push("Items:");
  for (const item of report.receipt.items) {
    const quantityLabel = `${formatQuantity(item.quantity)}${
      item.quantityUnit ? ` ${item.quantityUnit}` : ""
    }`;
    const parts = [
      `#${item.index} ${item.description}`,
      `qty ${quantityLabel}`,
      `net ${formatCents(item.unitPriceCents, report.receipt.currency)}`,
      `line ${formatCents(item.lineAmountCents, report.receipt.currency)}`,
    ];
    if (typeof item.inclusiveUnitPriceCents === "number") {
      parts.splice(
        3,
        0,
        `gross ${formatCents(item.inclusiveUnitPriceCents, report.receipt.currency)}`,
      );
    }
    lines.push(`  ${parts.join(" | ")}`);
  }

  lines.push(
    `Computed totals: taxable ${formatCents(
      report.computed.taxableAmountCents,
      report.receipt.currency,
    )} + tax ${formatCents(
      report.computed.taxAmountCents,
      report.receipt.currency,
    )} = total ${formatCents(report.computed.totalAmountCents, report.receipt.currency)}.`,
  );

  if (
    typeof report.declared.taxableAmountCents === "number" ||
    typeof report.declared.taxAmountCents === "number" ||
    typeof report.declared.totalAmountCents === "number"
  ) {
    lines.push(
      `Declared totals: taxable ${formatMaybeAmount(
        report.declared.taxableAmountCents,
        report.receipt.currency,
      )} + tax ${formatMaybeAmount(
        report.declared.taxAmountCents,
        report.receipt.currency,
      )} = total ${formatMaybeAmount(report.declared.totalAmountCents, report.receipt.currency)}.`,
    );
  }

  lines.push("Checks:");
  for (const check of report.checks) {
    const fragments = [`  ${check.pass ? "PASS" : "FAIL"} ${check.label}`];
    if (check.expected !== null) {
      fragments.push(`expected ${check.expected}`);
    }
    if (check.actual !== null) {
      fragments.push(`actual ${check.actual}`);
    }
    lines.push(fragments.join(" | "));
  }

  return lines.join("\n");
}

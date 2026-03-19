const STATE_RECORDS = Object.freeze([
  { canonical: "Andaman and Nicobar Islands", code: "35", aliases: ["Andaman & Nicobar Islands"] },
  { canonical: "Andhra Pradesh", code: "37", aliases: [] },
  { canonical: "Arunachal Pradesh", code: "12", aliases: [] },
  { canonical: "Assam", code: "18", aliases: [] },
  { canonical: "Bihar", code: "10", aliases: [] },
  { canonical: "Chandigarh", code: "04", aliases: [] },
  { canonical: "Chhattisgarh", code: "22", aliases: [] },
  { canonical: "Delhi", code: "07", aliases: ["NCT of Delhi", "New Delhi"] },
  { canonical: "Goa", code: "30", aliases: [] },
  { canonical: "Gujarat", code: "24", aliases: ["Gujrat"] },
  { canonical: "Haryana", code: "06", aliases: [] },
  { canonical: "Himachal Pradesh", code: "02", aliases: [] },
  { canonical: "Jammu and Kashmir", code: "01", aliases: [] },
  { canonical: "Jharkhand", code: "20", aliases: [] },
  { canonical: "Karnataka", code: "29", aliases: [] },
  { canonical: "Kerala", code: "32", aliases: [] },
  { canonical: "Ladakh", code: "38", aliases: [] },
  { canonical: "Lakshadweep", code: "31", aliases: [] },
  { canonical: "Madhya Pradesh", code: "23", aliases: [] },
  { canonical: "Maharashtra", code: "27", aliases: ["Maharastra"] },
  { canonical: "Manipur", code: "14", aliases: [] },
  { canonical: "Meghalaya", code: "17", aliases: [] },
  { canonical: "Mizoram", code: "15", aliases: [] },
  { canonical: "Nagaland", code: "13", aliases: [] },
  { canonical: "Odisha", code: "21", aliases: ["Orissa"] },
  { canonical: "Puducherry", code: "34", aliases: ["Pondicherry"] },
  { canonical: "Punjab", code: "03", aliases: [] },
  { canonical: "Rajasthan", code: "08", aliases: [] },
  { canonical: "Sikkim", code: "11", aliases: [] },
  { canonical: "Tamil Nadu", code: "33", aliases: ["Tamilnadu"] },
  { canonical: "Telangana", code: "36", aliases: [] },
  { canonical: "Tripura", code: "16", aliases: [] },
  { canonical: "Uttar Pradesh", code: "09", aliases: [] },
  { canonical: "Uttarakhand", code: "05", aliases: [] },
  { canonical: "West Bengal", code: "19", aliases: [] },
]);

const OCR_ALPHA_REPLACEMENTS = Object.freeze({
  "0": "O",
  "1": "I",
  "4": "A",
  "5": "S",
  "6": "G",
  "8": "B",
});

const NUMERIC_CONTEXT_REPLACEMENTS = Object.freeze({
  O: "0",
  o: "0",
  Q: "0",
  D: "0",
  I: "1",
  i: "1",
  l: "1",
  "|": "1",
  S: "5",
  s: "5",
  B: "8",
});

const MONTH_NAMES = Object.freeze([
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]);

const DOCUMENT_TITLE_STOPWORDS = new Set([
  "ACK",
  "BILL",
  "CASH",
  "COPY",
  "CREDIT",
  "DEBIT",
  "DUPLICATE",
  "INVOICE",
  "NOTE",
  "ORIGINAL",
  "PROFORMA",
  "PURCHASE",
  "RECEIPT",
  "RETAIL",
  "SALES",
  "TAX",
  "TRIPLICATE",
  "VOUCHER",
]);

const DOCUMENT_TITLE_CONNECTORS = new Set(["A", "AN", "FOR", "OF", "THE"]);

export function collapseWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeAlphaHeavyToken(token) {
  if (!/[A-Za-z]/.test(token) || !/\d/.test(token)) {
    return token;
  }

  const letterCount = token.match(/[A-Za-z]/g)?.length ?? 0;
  const digitCount = token.match(/\d/g)?.length ?? 0;
  if (letterCount < 3 || digitCount > letterCount) {
    return token;
  }

  return token.replace(/[014568]/g, (character) => OCR_ALPHA_REPLACEMENTS[character] ?? character);
}

export function normalizeAlphaHeavyText(value) {
  return String(value ?? "").replace(/[A-Za-z0-9]+/g, (token) => normalizeAlphaHeavyToken(token));
}

function normalizeStateLookupKey(value) {
  return normalizeAlphaHeavyText(collapseWhitespace(String(value ?? "")))
    .toUpperCase()
    .replace(/[.&]/g, " ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\bSTATE\b/g, " ")
    .replace(/\bUT\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STATE_CANONICAL_BY_LOOKUP = Object.create(null);
const STATE_CODE_BY_CANONICAL = Object.create(null);

for (const record of STATE_RECORDS) {
  const canonicalKey = normalizeStateLookupKey(record.canonical);
  STATE_CANONICAL_BY_LOOKUP[canonicalKey] = record.canonical;
  STATE_CODE_BY_CANONICAL[record.canonical.toUpperCase()] = record.code;
  for (const alias of record.aliases) {
    STATE_CANONICAL_BY_LOOKUP[normalizeStateLookupKey(alias)] = record.canonical;
  }
}

const STATE_LOOKUP_KEYS = Object.freeze(Object.keys(STATE_CANONICAL_BY_LOOKUP));

function* iterateTokenWindows(key) {
  const tokens = key.split(" ").filter(Boolean);
  for (let size = Math.min(tokens.length, 4); size >= 1; size -= 1) {
    for (let start = 0; start <= tokens.length - size; start += 1) {
      yield tokens.slice(start, start + size).join(" ");
    }
  }
}

function levenshteinDistance(left, right) {
  if (left === right) {
    return 0;
  }

  if (left.length === 0) {
    return right.length;
  }
  if (right.length === 0) {
    return left.length;
  }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array(right.length + 1);

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    current[0] = leftIndex + 1;
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const cost = left[leftIndex] === right[rightIndex] ? 0 : 1;
      current[rightIndex + 1] = Math.min(
        current[rightIndex] + 1,
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + cost,
      );
    }
    [previous, current] = [current, previous];
  }

  return previous[right.length];
}

function bestMonthName(value) {
  const key = normalizeAlphaHeavyText(collapseWhitespace(String(value ?? "")))
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  if (!key) {
    return null;
  }

  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const month of MONTH_NAMES) {
    const monthKey = month.toUpperCase();
    const maxDistance = monthKey.length <= 3 ? 1 : 2;
    if (Math.abs(key.length - monthKey.length) > maxDistance) {
      continue;
    }

    const distance = levenshteinDistance(key, monthKey);
    if (distance > maxDistance) {
      continue;
    }

    if (distance < bestDistance) {
      best = month;
      bestDistance = distance;
    }
  }

  return best;
}

function bestStateLookupKey(key) {
  if (!key) {
    return null;
  }

  for (const candidateKey of iterateTokenWindows(key)) {
    if (STATE_CANONICAL_BY_LOOKUP[candidateKey]) {
      return candidateKey;
    }
  }

  let bestKey = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidateKey of iterateTokenWindows(key)) {
    for (const knownKey of STATE_LOOKUP_KEYS) {
      const maxDistance = knownKey.length <= 6 ? 1 : 2;
      if (Math.abs(candidateKey.length - knownKey.length) > maxDistance) {
        continue;
      }

      const distance = levenshteinDistance(candidateKey, knownKey);
      if (distance > maxDistance) {
        continue;
      }

      if (distance < bestDistance || (distance === bestDistance && knownKey.length > (bestKey?.length ?? 0))) {
        bestKey = knownKey;
        bestDistance = distance;
      }
    }
  }

  return bestKey;
}

export function canonicalizeStateName(value) {
  const key = normalizeStateLookupKey(value);
  if (!key) {
    return null;
  }

  const bestKey = bestStateLookupKey(key);
  return bestKey ? STATE_CANONICAL_BY_LOOKUP[bestKey] ?? null : null;
}

export function resolveStateCodeFromPlace(value) {
  const canonical = canonicalizeStateName(value);
  return canonical ? STATE_CODE_BY_CANONICAL[canonical.toUpperCase()] ?? null : null;
}

export function looksLikeAddressText(value) {
  const text = collapseWhitespace(value);
  if (!text) {
    return false;
  }

  const normalized = normalizeAlphaHeavyText(text).toUpperCase();
  if (/\b\d{6}\b/.test(normalized)) {
    return true;
  }
  if (
    /\b(?:SHOP|PLOT|BLOCK|SECTOR|ROAD|RD|STREET|ST|AVENUE|AVE|LANE|LN|BUILDING|BLDG|TOWER|FLOOR|FLAT|HOUSE|NEAR|OPP(?:OSITE)?|ESTATE|PLAZA|PARK|NAGAR|CITY|DISTRICT|VILLAGE|INDIA|PIN|PINCODE)\b/.test(
      normalized,
    )
  ) {
    return true;
  }
  if ((text.includes(",") || text.includes("-")) && (canonicalizeStateName(text) || /\bINDIA\b/.test(normalized))) {
    return true;
  }
  return /[0-9]{3,}/.test(normalized) && /,/.test(text);
}

function isNumericContextCharacter(character) {
  return /[0-9.,]/.test(character ?? "");
}

export function normalizeNumericLikeText(value) {
  const text = collapseWhitespace(String(value ?? ""));
  if (!text) {
    return "";
  }

  const characters = [...text];
  for (let index = 0; index < characters.length; index += 1) {
    const replacement = NUMERIC_CONTEXT_REPLACEMENTS[characters[index]];
    if (!replacement) {
      continue;
    }

    if (
      isNumericContextCharacter(characters[index - 1]) ||
      isNumericContextCharacter(characters[index + 1])
    ) {
      characters[index] = replacement;
    }
  }

  return characters.join("");
}

export function canonicalizeDateText(value) {
  const text = collapseWhitespace(normalizeNumericLikeText(String(value ?? "")));
  if (!text) {
    return null;
  }

  const slashMatch = text.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})$/);
  if (slashMatch) {
    return `${slashMatch[1]}/${slashMatch[2]}/${slashMatch[3]}`;
  }

  const dashMatch = text.match(/^(\d{1,2})\s*-\s*([A-Za-z]{3,9})\s*-\s*(\d{2,4})$/);
  if (dashMatch) {
    const month = bestMonthName(dashMatch[2]);
    return month ? `${dashMatch[1]}-${month}-${dashMatch[3]}` : null;
  }

  const spacedMatch = text.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})$/);
  if (spacedMatch) {
    const month = bestMonthName(spacedMatch[2]);
    return month ? `${spacedMatch[1]} ${month} ${spacedMatch[3]}` : null;
  }

  return null;
}

export function normalizeUnitValue(value) {
  const text = collapseWhitespace(normalizeAlphaHeavyText(String(value ?? "")));
  if (!text) {
    return null;
  }

  const compact = text.toUpperCase().replace(/[^A-Z]/g, "");
  if (!compact) {
    return null;
  }

  const canonical = {
    NO: "NOS",
    NOS: "NOS",
    PC: "PCS",
    PCS: "PCS",
    PIECE: "PCS",
    PIECES: "PCS",
    UNIT: "UNITS",
    UNITS: "UNITS",
    HR: "HRS",
    HRS: "HRS",
    HOUR: "HRS",
    HOURS: "HRS",
    SET: "SETS",
    SETS: "SETS",
    KW: "KW",
    KWP: "KW",
    KWH: "KWH",
  }[compact];

  return canonical ?? compact;
}

function normalizeBusinessSuffixes(value) {
  return collapseWhitespace(String(value ?? ""))
    .replace(/\bL\s+LP\b/gi, "LLP")
    .replace(/\bPVT\.?\s+LID\b/gi, "Pvt Ltd")
    .replace(/\bPRIVATE\s+LID\b/gi, "Private Ltd")
    .replace(/\bLID\b/gi, "Ltd")
    .replace(/\bLTD\.?\b/gi, "Ltd")
    .replace(/\bLIMITED\b/gi, "Limited");
}

export function looksLikeDocumentTitleText(value) {
  const tokens = normalizeAlphaHeavyText(collapseWhitespace(String(value ?? "")))
    .toUpperCase()
    .replace(/[^A-Z ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !DOCUMENT_TITLE_CONNECTORS.has(token));
  if (tokens.length === 0 || tokens.length > 4) {
    return false;
  }

  return tokens.every((token) => DOCUMENT_TITLE_STOPWORDS.has(token));
}

export function normalizePartyNameText(value) {
  return normalizeBusinessSuffixes(collapseWhitespace(normalizeAlphaHeavyText(String(value ?? ""))));
}

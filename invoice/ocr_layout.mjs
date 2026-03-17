const TSV_HEADER = "level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";
const WORD_ROW_LEVEL = 5;
const PAGE_ROW_LEVEL = 1;
const SAME_ROW_Y_TOLERANCE = 2.5;
const SAME_ROW_HEIGHT_FACTOR = 0.45;

export function normalizeOcrText(source) {
  if (typeof source !== "string") {
    throw new Error("OCR source must be a string.");
  }

  return source
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\u200b/g, "")
    .trim();
}

export function collapseWhitespace(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function createPlainWord(token, lineIndex, pageWidth) {
  return {
    text: token.text,
    xMin: token.start,
    xMax: token.end,
    yMin: lineIndex,
    yMax: lineIndex + 1,
    pageIndex: 0,
    pageWidth,
    pageHeight: 1,
  };
}

function tokenizePlainLine(rawLine, lineIndex, pageWidth) {
  const tokens = [];
  for (const match of rawLine.matchAll(/\S+/g)) {
    tokens.push(
      createPlainWord(
        {
          text: match[0],
          start: match.index,
          end: match.index + match[0].length,
        },
        lineIndex,
        pageWidth,
      ),
    );
  }
  return tokens;
}

function finalizeRow(row, rowIndex) {
  const words = [...row.words].sort((left, right) => {
    if (left.xMin !== right.xMin) {
      return left.xMin - right.xMin;
    }
    return left.yMin - right.yMin;
  });
  const xMin = words.length > 0 ? Math.min(...words.map((word) => word.xMin)) : 0;
  const xMax = words.length > 0 ? Math.max(...words.map((word) => word.xMax)) : 0;
  const yMin = words.length > 0 ? Math.min(...words.map((word) => word.yMin)) : row.yCenter;
  const yMax = words.length > 0 ? Math.max(...words.map((word) => word.yMax)) : row.yCenter;

  return {
    rowIndex,
    pageIndex: row.pageIndex,
    pageWidth: row.pageWidth,
    pageHeight: row.pageHeight,
    xMin,
    xMax,
    yMin,
    yMax,
    words,
    text: collapseWhitespace(words.map((word) => word.text).join(" ")),
  };
}

function groupWordsIntoRows(words, pageWidth, pageHeight, pageIndex, startingRowIndex) {
  const rows = [];
  const sortedWords = [...words].sort((left, right) => {
    const leftY = (left.yMin + left.yMax) / 2;
    const rightY = (right.yMin + right.yMax) / 2;
    if (leftY !== rightY) {
      return leftY - rightY;
    }
    return left.xMin - right.xMin;
  });

  let currentRow = null;
  for (const word of sortedWords) {
    const yCenter = (word.yMin + word.yMax) / 2;
    const wordHeight = Math.max(1, word.yMax - word.yMin);
    const tolerance = currentRow
      ? Math.max(
          SAME_ROW_Y_TOLERANCE,
          Math.max(currentRow.averageHeight, wordHeight) * SAME_ROW_HEIGHT_FACTOR,
        )
      : SAME_ROW_Y_TOLERANCE;

    if (currentRow && Math.abs(yCenter - currentRow.yCenter) <= tolerance) {
      const previousCount = currentRow.words.length;
      currentRow.words.push(word);
      currentRow.yCenter =
        (currentRow.yCenter * previousCount + yCenter) / (previousCount + 1);
      currentRow.averageHeight =
        (currentRow.averageHeight * previousCount + wordHeight) / (previousCount + 1);
      continue;
    }

    if (currentRow) {
      rows.push(finalizeRow(currentRow, startingRowIndex + rows.length));
    }

    currentRow = {
      pageIndex,
      pageWidth,
      pageHeight,
      words: [word],
      yCenter,
      averageHeight: wordHeight,
    };
  }

  if (currentRow) {
    rows.push(finalizeRow(currentRow, startingRowIndex + rows.length));
  }

  return rows;
}

export function buildPlainTextReceiptSource(source) {
  const text = normalizeOcrText(source);
  const rawLines = text.split("\n");
  const pageWidth = Math.max(1, ...rawLines.map((line) => line.length));
  const pageHeight = Math.max(1, rawLines.length);
  const rows = rawLines.map((rawLine, rowIndex) => {
    const words = tokenizePlainLine(rawLine, rowIndex, pageWidth);
    return {
      rowIndex,
      pageIndex: 0,
      pageWidth,
      pageHeight,
      xMin: words.length > 0 ? Math.min(...words.map((word) => word.xMin)) : 0,
      xMax: words.length > 0 ? Math.max(...words.map((word) => word.xMax)) : 0,
      yMin: rowIndex,
      yMax: rowIndex + 1,
      words,
      text: collapseWhitespace(rawLine),
    };
  });

  return {
    kind: "receipt_ocr_source",
    text,
    pageCount: 1,
    rows,
  };
}

function parseTsvRow(line) {
  const parts = line.split("\t");
  if (parts.length < 12) {
    return null;
  }
  return {
    level: Number(parts[0]),
    pageNumber: Number(parts[1]),
    left: Number(parts[6]),
    top: Number(parts[7]),
    width: Number(parts[8]),
    height: Number(parts[9]),
    text: parts[11],
  };
}

export function parsePdftotextTsv(tsv) {
  const normalized = String(tsv).trim();
  if (!normalized) {
    throw new Error("Empty pdftotext TSV payload.");
  }

  const lines = normalized.split(/\r?\n/);
  if (lines[0] !== TSV_HEADER) {
    throw new Error("Unexpected pdftotext TSV header.");
  }

  const pages = new Map();
  const wordsByPage = new Map();

  for (const line of lines.slice(1)) {
    const row = parseTsvRow(line);
    if (!row) {
      continue;
    }

    if (row.level === PAGE_ROW_LEVEL && row.text === "###PAGE###") {
      pages.set(row.pageNumber, {
        pageIndex: row.pageNumber - 1,
        width: row.width,
        height: row.height,
      });
      continue;
    }

    if (row.level !== WORD_ROW_LEVEL) {
      continue;
    }

    const page = pages.get(row.pageNumber) ?? {
      pageIndex: row.pageNumber - 1,
      width: 1,
      height: 1,
    };
    const words = wordsByPage.get(row.pageNumber) ?? [];
    words.push({
      text: row.text,
      xMin: row.left,
      xMax: row.left + row.width,
      yMin: row.top,
      yMax: row.top + row.height,
      pageIndex: page.pageIndex,
      pageWidth: page.width,
      pageHeight: page.height,
    });
    wordsByPage.set(row.pageNumber, words);
  }

  const orderedPageNumbers = [...wordsByPage.keys()].sort((left, right) => left - right);
  const rows = [];
  for (const pageNumber of orderedPageNumbers) {
    const page = pages.get(pageNumber) ?? {
      pageIndex: pageNumber - 1,
      width: 1,
      height: 1,
    };
    rows.push(
      ...groupWordsIntoRows(
        wordsByPage.get(pageNumber) ?? [],
        page.width,
        page.height,
        page.pageIndex,
        rows.length,
      ),
    );
  }

  if (rows.length === 0) {
    throw new Error("pdftotext TSV did not contain any words.");
  }

  return {
    kind: "receipt_ocr_source",
    text: rows.map((row) => row.text).filter(Boolean).join("\n"),
    pageCount: Math.max(1, orderedPageNumbers.length),
    rows,
  };
}

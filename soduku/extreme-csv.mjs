import { createReadStream } from "node:fs";
import readline from "node:readline";

const EXPECTED_COLUMNS = 4;

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }

    if (char === ",") {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

export async function* streamExtremeSudokuCsv(csvPath) {
  const input = createReadStream(csvPath, { encoding: "utf8" });
  const rl = readline.createInterface({
    input,
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  let rowIndex = -1;
  let header = null;

  try {
    for await (const rawLine of rl) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      rowIndex += 1;
      const values = parseCsvLine(line);

      if (!header) {
        header = values;
        continue;
      }

      if (values.length !== EXPECTED_COLUMNS) {
        throw new Error(
          `Expected ${EXPECTED_COLUMNS} CSV columns at row ${rowIndex + 1}, got ${values.length}.`,
        );
      }

      const [source, question, answer, rating] = values;
      yield {
        rowIndex,
        source,
        question,
        answer,
        rating: Number(rating),
      };
    }
  } finally {
    rl.close();
    input.close();
  }
}

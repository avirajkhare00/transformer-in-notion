# Invoice PSVM

This directory now contains two related PSVM examples:

- invoice arithmetic: exact invoice JSON in, canonical calculator trace out
- OCR receipt total selection: raw OCR text in, legal money candidates ranked, exact total emitted

Both follow the same repo rule:

`code owns legality, the model only scores ambiguity`

## Files

- `psvm.mjs` - exact invoice calculator PSVM and canonical trace generator
- `export_dataset.mjs` - synthetic dataset generator for invoice next-op supervision
- `train_transformer.py` - tiny next-op transformer trainer/exporter for `psvm.mjs`
- `worker.mjs` - browser worker for the invoice next-op demo
- `model.mjs` - browser-side model loader for invoice next-op prediction
- `ocr_layout.mjs` - plain-text and `pdftotext -tsv` row/layout normalization
- `total_psvm.mjs` - exact OCR receipt total PSVM
- `export_total_dataset.mjs` - synthetic OCR-style receipt dataset generator for total selection
- `train_total_selector.py` - binary `TOTAL` vs `NOT_TOTAL` selector trainer
- `receipt.mjs` - deterministic parser/verifier for known `pdftotext -layout` receipt layouts
- `receipt.test.mjs` - parser/verifier coverage
- `total_psvm.test.mjs` - OCR-total PSVM coverage
- `../scripts/extract_receipt_total_candidates.mjs` - CLI candidate extractor for OCR text or PDFs
- `../scripts/predict_receipt_total.py` - local model inference over extracted candidates
- `../scripts/verify_receipt_pdf.mjs` - deterministic PDF parser/verifier CLI

## OCR Receipt Total PSVM

The OCR-total path is intentionally narrow:

`OCR text -> EXTRACT_AMOUNTS -> RANK_TOTAL_BRANCHES -> EMIT_TOTAL -> HALT`

What remains exact:

- OCR text normalization
- PDF row reconstruction from `pdftotext -tsv`
- money-span extraction
- candidate legality and context building
- layout cues such as right-edge alignment and cue-before-amount position
- deterministic teacher scoring
- final total emission

What the model does:

- score each legal candidate as `TOTAL` or `NOT_TOTAL`

This is the same pattern as Sudoku:

`state -> model ranks legal branches -> exact runtime executes`

not:

`OCR text -> model invents the answer`

The current OCR-total lane is intentionally invoice/receipt-shaped. It expects one payable or final document total. Bank/account statements with running balances are rejected instead of forcing a guess.

The first Tally-oriented schema draft for broader voucher extraction now lives in `invoice/tally_schema.mjs`. It defines voucher families, a shared field surface, industry extensions, and explicit reject semantics for statement-like documents.

## How It Works In AI/ML Terms

The OCR-total path is a constrained ranking problem, not free-form generation.

Pipeline:

1. Normalize the source into OCR rows.
   - Plain text uses approximate row and character positions.
   - `pdftotext -tsv` keeps real page coordinates.
2. Extract every legal money candidate from the rows.
   - Each candidate is an amount already present in the document.
3. Build a structured context string for each candidate.
   - lexical cues: `total`, `amount due`, `subtotal`, `gst`, `paid`
   - row context: previous line, current line, next line
   - layout cues: right-edge position, vertical position, cue-before-amount gap
   - document context: top amounts, tail excerpt, document type
4. Score each candidate.
   - `Teacher` mode uses deterministic heuristic weights.
   - `Local model` uses a small transformer trained as a binary selector: `TOTAL` vs `NOT_TOTAL`.
5. Rank all legal candidates and emit the top one.
   - The runtime returns one existing amount from the OCR, not a newly generated string.

So the learning problem is:

`candidate context -> probability(this candidate is the final total)`

not:

`full OCR text -> invent a number`

This is why it fits the repo's PSVM pattern:

`code generates legal branches -> model ranks branches -> code emits answer`

## How It Works In Plain English

Think of it as a smart multiple-choice test.

1. The code scans the OCR text and collects every number that looks like money.
2. For each number, it looks at nearby words and layout clues.
   - Is the line saying `TOTAL`?
   - Is the amount at the far right?
   - Is it near the bottom?
   - Is it on a tax line or subtotal line instead?
3. The system scores all those candidate amounts.
4. It returns the best-scoring amount.

So it does not "calculate a total from scratch" and it does not "hallucinate a number." It chooses one number that already exists in the OCR text.

## Current Limitations

- It is built for invoices and receipts that have one final payable total.
- Bank/account statements are rejected because they contain running balances, not one payable total.
- Plain OCR text is weaker than `pdftotext -tsv` because plain text loses true page boundaries and real geometry.
- Multi-page documents are supported only loosely today.
  - The system can rank candidates across the whole document.
  - It does not yet have a hard "prefer the last page final total" rule.
- It does not prove totals by arithmetic.
  - If a document has `subtotal + tax = total`, that relationship is useful, but the current ranker does not fully verify it.
- OCR quality still matters.
  - Bad OCR can break amount extraction, cue words, or row structure.
- The browser demo does not parse PDFs directly.
  - You need to paste OCR text or pasted `pdftotext -tsv` output.

Best current practice:

- use structured `pdftotext -tsv` when possible
- use invoice/receipt-shaped documents
- avoid feeding account statements or long generic tabular reports
- treat the result as a ranked selection system, not a universal document parser

## Local Training Flow

Generate the arithmetic next-op dataset:

```bash
node invoice/export_dataset.mjs
```

Train the arithmetic next-op student:

```bash
<python-env>/bin/python invoice/train_transformer.py --skip-export
```

Generate the OCR-total selector dataset:

```bash
node invoice/export_total_dataset.mjs --count 2000
```

Train the OCR-total selector and keep the raw checkpoint:

```bash
<python-env>/bin/python invoice/train_total_selector.py --skip-export
```

Train and export the OCR-total selector bundle under `invoice/models/`:

```bash
<python-env>/bin/python invoice/train_total_selector.py
```

The export step requires `optimum-cli` in that Python environment.

## CLI Smoke Tests

Extract legal total candidates from OCR text or a PDF:

```bash
node scripts/extract_receipt_total_candidates.mjs receipt.pdf
```

Score those candidates with a local selector model:

```bash
<python-env>/bin/python scripts/predict_receipt_total.py \
  --model-dir invoice/training/invoice-total-selector \
  receipt.pdf
```

Run the deterministic parser/verifier for known layouts:

```bash
node scripts/verify_receipt_pdf.mjs receipt.pdf
```

PDF input requires `pdftotext` in `PATH`.

## Browser Demo

Serve the repo root and open:

```bash
python3 -m http.server 8000
```

Then visit:

- `http://localhost:8000/receipt.html`

The page accepts pasted OCR text or pasted `pdftotext -tsv` output, and supports both:

- `Teacher` - deterministic receipt-total heuristic
- `Local model` - browser-local ONNX selector under `invoice/models/invoice-total-selector/`

Account statements are not supported in this demo because they usually contain many balances rather than one payable total.

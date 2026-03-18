# Tally Voucher PSVM

This directory contains the broader Tally-style document extraction lane:

`OCR/layout -> voucher family -> schema -> legal field candidates -> exact runtime emits Tally-shaped record`

It follows the same repo rule as Sudoku and the invoice total selector:

`code owns legality, the model only scores ambiguity`

Today this lane is deterministic-first, with an optional tiny local BERT field selector on top of the same legal candidate surface. The PSVM still creates the legal voucher and field choices, applies schema and accounting constraints, and emits the structured record.

## Files

- `schema.mjs` - voucher families, shared core fields, and industry extensions
- `psvm.mjs` - voucher-family classifier and schema-aligned field extractor
- `resolver.mjs` - constraint-guided field resolver over top-ranked scalar candidates
- `table_parser.mjs` - OCR-row table parser for repeatable line items and industry columns
- `harness.mjs` - adversarial failure-mode harness for candidate recall, ranking accuracy, and instability
- `model-common.mjs` - shared field-candidate context builder and selection helpers
- `model.mjs` - browser-local transformer inference over legal Tally candidates
- `worker.mjs` - browser worker for the Tally extraction demo
- `demo-samples.mjs` - sample OCR presets for the Tally extraction demo
- `export_field_dataset.mjs` - synthetic Tally field-candidate dataset generator
- `train_field_selector.py` - tiny BERT trainer/exporter for Tally field selection
- `model.test.mjs` - model-selection logic coverage on the demo presets
- `schema.test.mjs` - voucher schema coverage
- `psvm.test.mjs` - extraction PSVM coverage
- `table_parser.test.mjs` - line-item table parsing coverage for text and structured OCR
- `harness.test.mjs` - adversarial harness coverage and aggregate metric checks
- `../tally.html` - browser demo for voucher-family classification and Tally-shaped output
- `app.mjs` - basic browser UI for OCR/TSV input, summary fields, and emitted JSON

## How It Works In AI/ML Terms

This is a constrained information-extraction problem, not free-form generation.

The dominant bottleneck is not raw model size. It is candidate coverage under bad structure:

`P(correct) = candidate recall × ranking accuracy × constraint/mapping correctness`

So the ranker matters, but the parser and the legal candidate surface matter more.

The harness in `harness.mjs` tracks that explicitly with:

- candidate recall
- top-1 field accuracy
- instability rate
- line-item candidate recall

Pipeline:

1. Normalize the source into OCR rows.
   - Plain text uses approximate rows.
   - `pdftotext -tsv` keeps real page coordinates.
2. Classify the likely voucher family.
   - sales invoice
   - purchase invoice
   - proforma invoice
   - credit note
   - debit note
   - account statement
   - unknown document
3. Load the schema for that family.
   - shared invoice fields
   - party fields
   - tax and total fields
   - optional industry extensions for pharma, medical, trading, and stockist flows
4. Generate legal candidates for each field.
   - nearby label/value spans
   - weak-label and implicit header spans like `#7782`, `Client`, `Supply:`, and `Final Amount`
   - GSTINs, dates, invoice numbers, totals
   - row-aware table parsing for line items, including multiline descriptions and common industry columns
5. Rank field candidates.
   - `Runtime` mode uses deterministic heuristic scores from the PSVM
   - `Local model` mode uses a tiny BERT text classifier over the same legal candidates
6. Resolve the best consistent scalar field set.
   - bounded top-k search over the ranked candidates
   - mutual exclusion for IGST vs CGST/SGST
   - GST state-regime checks from GSTIN and place of supply
   - subtotal / tax / grand-total consistency when enough evidence exists
7. Emit a Tally-shaped record or reject the document.

So the core learning problem in the model path is:

`field candidate context -> probability(this candidate is the right value for this schema field)`

not:

`raw OCR text -> hallucinated accounting JSON`

## How It Works In Plain English

Think of it as a document clerk with a checklist.

1. It first decides what kind of voucher the document looks like.
2. Once it knows the family, it knows which fields are even allowed.
3. It looks around the OCR text for likely values for those fields.
   - invoice number
   - invoice date
   - GSTIN
   - buyer and seller names
   - subtotal, tax, and total
   - line items, quantities, rates, amounts, and some industry fields when a table is visible
4. It ranks likely values for each field.
5. It runs a small resolver to keep the final field set globally consistent.
6. If the document looks like a statement or the OCR is too weak, it rejects instead of forcing a wrong invoice output.

So it is not trying to magically rewrite garbage OCR into perfect accounting data. It is using a voucher-type checklist and only filling values it can defend.

## Current Limitations

- This is not a generic parser for every table-heavy business document.
- Account statements are rejected instead of being squeezed into invoice output.
- OCR quality still matters. Bad scans can break labels, rows, GSTINs, and dates.
- Common invoice line-item tables are now parsed directly from OCR rows, but arbitrary or highly irregular tables are still weak.
- Voucher-type coverage is broad but not complete. New Tally mechanisms should be added as schema and extractor extensions, not guessed.
- Industry support is extension-based today. Pharma, medical, trading, and stockist fields are modeled, but real customer layouts will still need tuning.
- The local model is still lightweight. It is a tiny transformer trained on synthetic candidate contexts, not a large document foundation model.
- PDF conversion is not supported in the browser demo. You need to paste OCR text or `pdftotext -tsv`.
- The output is Tally-shaped JSON, not native Tally import XML.

## Browser Demo

Serve the repo root and open:

```bash
python3 -m http.server 8000
```

Then visit:

- `http://localhost:8000/tally.html`

The page accepts pasted OCR text or pasted `pdftotext -tsv` output. PDF upload is rejected on purpose in this version. The basic demo shows:

- run summary
- selected scalar fields
- parsed line items inside the emitted record JSON
- emitted Tally-shaped record JSON

## Adversarial Harness

Run the failure-mode harness locally:

```bash
node scripts/evaluate_tally_harness.mjs
```

Optional flags:

- `--json` for machine-readable output
- `--no-baseline` to remove the clean control cases
- `--seed <int>` to vary the OCR-corruption mutations deterministically

The harness is organized by failure class instead of document type:

- `candidate_missing`
- `ranking_ambiguity`
- `structural_inconsistency`
- `numeric_ambiguity`
- `ocr_corruption`
- `layout_drift`
- `implicit_field`

This is the current intended regression surface for parser work. If candidate recall is low, model changes should not be the first response.

## Best Current Use

- use `pdftotext -tsv` when possible
- use invoice, credit-note, debit-note, and similar voucher-shaped documents
- keep statement-like ledgers and bank statements out of this lane
- treat the result as structured extraction with validation, not a universal OCR-to-ERP converter

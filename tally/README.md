# Tally Voucher PSVM

This directory contains the broader Tally-style document extraction lane:

`OCR/layout -> voucher family -> schema -> legal field candidates -> exact runtime emits Tally-shaped record`

It follows the same repo rule as Sudoku and the invoice total selector:

`code owns legality, the model only scores ambiguity`

Today this lane is deterministic-first. The PSVM creates legal voucher and field choices from noisy OCR, applies schema and accounting constraints, and emits a structured record. A learned field-ranker can be added on top of the same candidate surface later.

## Files

- `schema.mjs` - voucher families, shared core fields, and industry extensions
- `psvm.mjs` - voucher-family classifier and schema-aligned field extractor
- `worker.mjs` - browser worker for the Tally extraction demo
- `demo-samples.mjs` - sample OCR presets for the Tally extraction demo
- `schema.test.mjs` - voucher schema coverage
- `psvm.test.mjs` - extraction PSVM coverage
- `../tally.html` - browser demo for voucher-family classification and Tally-shaped output
- `app.mjs` - browser UI wiring for voucher-family and field-candidate inspection

## How It Works In AI/ML Terms

This is a constrained information-extraction problem, not free-form generation.

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
   - GSTINs, dates, invoice numbers, totals
   - parser-assisted totals and line items when the layout matches known invoice shapes
5. Rank and select candidates.
   - today this is deterministic heuristic scoring
   - later the same surface can support a learned field selector
6. Emit a Tally-shaped record or reject the document.

So the core learning problem, once a model is added, is:

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
4. It picks the strongest candidates and fills a Tally-shaped record.
5. If the document looks like a statement or the OCR is too weak, it rejects instead of forcing a wrong invoice output.

So it is not trying to magically rewrite garbage OCR into perfect accounting data. It is using a voucher-type checklist and only filling values it can defend.

## Current Limitations

- This is not a generic parser for every table-heavy business document.
- Account statements are rejected instead of being squeezed into invoice output.
- OCR quality still matters. Bad scans can break labels, rows, GSTINs, and dates.
- Line-item extraction is still partial. Scalar document fields are stronger than arbitrary table reconstruction.
- Voucher-type coverage is broad but not complete. New Tally mechanisms should be added as schema and extractor extensions, not guessed.
- Industry support is extension-based today. Pharma, medical, trading, and stockist fields are modeled, but real customer layouts will still need tuning.
- There is no trained field-ranking model yet. The current browser demo is deterministic-first.
- The output is Tally-shaped JSON, not native Tally import XML.

## Browser Demo

Serve the repo root and open:

```bash
python3 -m http.server 8000
```

Then visit:

- `http://localhost:8000/tally.html`

The page accepts pasted OCR text or pasted `pdftotext -tsv` output. It shows:

- ranked voucher families
- selected scalar fields
- emitted Tally-shaped record JSON
- grouped field candidates
- PSVM trace and readable log

## Best Current Use

- use `pdftotext -tsv` when possible
- use invoice, credit-note, debit-note, and similar voucher-shaped documents
- keep statement-like ledgers and bank statements out of this lane
- treat the result as structured extraction with validation, not a universal OCR-to-ERP converter

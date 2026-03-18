# docd Extraction Pipeline — Complete Technical Specification

> **Purpose:** This document is a standalone reference for any LLM or developer to recreate the docd extraction, validation, and classification logic from scratch. Every schema, rule, tolerance, data structure, and orchestration decision is documented here with exact values.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Document Type Configuration](#2-document-type-configuration)
3. [JSON Schema — Indian GST Invoice](#3-json-schema--indian-gst-invoice)
4. [Schema Registry & Versioning](#4-schema-registry--versioning)
5. [Provider Interface](#5-provider-interface)
6. [Document Classification](#6-document-classification)
7. [PDF Intelligence — Digital vs Scanned Detection](#7-pdf-intelligence--digital-vs-scanned-detection)
8. [Pipeline Orchestration](#8-pipeline-orchestration)
9. [Validation Engine](#9-validation-engine)
10. [Validation Rules — Invoice](#10-validation-rules--invoice)
11. [Validation Rules — Common](#11-validation-rules--common)
12. [Validation Rules — Party Matching](#12-validation-rules--party-matching)
13. [Retry & Tier Escalation](#13-retry--tier-escalation)
14. [Caching Strategy](#14-caching-strategy)
15. [Expected Output Format](#15-expected-output-format)
16. [Field Hints — LLM Extraction Guidance](#16-field-hints--llm-extraction-guidance)
17. [Indian Number Words Parser](#17-indian-number-words-parser)
18. [GSTIN Format & Validation](#18-gstin-format--validation)
19. [Error Hint Generation for LLM Retry](#19-error-hint-generation-for-llm-retry)
20. [Training Samples](#20-training-samples)
21. [Integration Points](#21-integration-points)

---

## 1. System Overview

docd is a document intelligence system that:

1. **Classifies** uploaded PDFs into document types (invoice, bank statement, etc.)
2. **Parses** PDFs into structured text (markdown) using OCR/LLM
3. **Extracts** structured JSON data from the parsed text using a JSON Schema
4. **Validates** the extracted data against domain-specific rules (arithmetic, GSTIN, tax logic)
5. **Retries** extraction with error hints when validation fails
6. **Caches** results to avoid redundant API calls

The system is designed for Indian GST invoices used by Chartered Accountant (CA) firms, but the architecture supports any document type.

### Architecture Pattern

```
PDF → [Classify] → DocType
                      ↓
                  [Parse] → Markdown text
                      ↓
                  [Extract] → Raw JSON (matches schema)
                      ↓
                  [Validate] → PASS / WARN / FAIL
                      ↓
                  If FAIL → [Build hints] → [Re-extract with hints] → loop
                  If PASS/WARN → Done (cache result)
```

---

## 2. Document Type Configuration

A `DocumentType` configures the extraction behavior for a class of documents.

### Data Model

```
DocumentType {
    ID                 string       // UUID
    TenantID           string       // Multi-tenant isolation
    CompanyID          string       // Optional: scopes party matching to a specific company
    Name               string       // "invoice", "bank_statement", "purchase_order"
    Description        string       // Human-readable description
    ActiveSchemaVer    int          // Currently active schema version number
    ParsingInstruction string       // Custom instruction text passed to the parsing LLM
    ParseTier          string       // "auto" | "fast" | "cost_effective" | "agentic" | "agentic_plus"
    ExtractMode        string       // "fast" | "balanced" | "multimodal" | "premium"
    ValidationRules    []string     // Which rule sets to run: ["invoice", "common", "party"]
    CreatedAt          timestamp
    UpdatedAt          timestamp
}
```

### Parse Tiers (LlamaParse)

| Tier | Cost | Quality | Use Case |
|------|------|---------|----------|
| `fast` | Lowest | Basic text extraction | Simple digital PDFs |
| `cost_effective` | Low | Good for clean digital docs | Default for digital PDFs |
| `agentic` | Medium | LLM-enhanced parsing | Scanned docs, complex layouts |
| `agentic_plus` | Highest | Best quality, multi-model | Handwritten, rotated, degraded scans |
| `auto` | Varies | System decides based on PDF analysis | Default when not specified |

### Extract Modes (LlamaExtract)

| Mode | Cost | Quality | Use Case |
|------|------|---------|----------|
| `FAST` | Lowest | Quick extraction | Simple schemas, high volume |
| `BALANCED` | Medium | Good accuracy/cost ratio | Default for digital PDFs |
| `MULTIMODAL` | Higher | Vision + text combined | Default for scanned PDFs |
| `PREMIUM` | Highest | Best accuracy | Final retry, complex invoices |

> **Critical:** Mode values must be UPPERCASE when sent to LlamaExtract API.

---

## 3. JSON Schema — Indian GST Invoice

The schema defines every field that can be extracted from an Indian GST invoice. Field `description` values serve as LLM instructions — they directly affect extraction quality.

### Constraints for LlamaExtract Compatibility

- Root type must be `"object"` with `"properties"`
- **NO** `$ref`, `$defs`, `oneOf`, `anyOf`, `allOf`
- **NO** `type: ["string", "null"]` — use single type only
- All types must be flat/inline
- Nested objects and arrays are allowed, but definitions must be inline

### Complete Schema

```json
{
  "type": "object",
  "properties": {

    "invoice_type": {
      "type": "string",
      "description": "Invoice type. One of: Tax Invoice, Bill of Supply, Credit Note, Debit Note, Proforma Invoice, Revised Invoice, Delivery Challan"
    },
    "invoice_number": {
      "type": "string",
      "description": "Invoice/document number. Alphanumeric, max 16 chars, may include / and - e.g. INV/2024-25/001"
    },
    "invoice_date": {
      "type": "string",
      "description": "Date of invoice in DD/MM/YYYY format"
    },
    "original_invoice_number": {
      "type": "string",
      "description": "Original invoice reference for Credit Notes or Debit Notes or Revised invoices"
    },
    "original_invoice_date": {
      "type": "string",
      "description": "Date of original invoice being referenced"
    },
    "financial_year": {
      "type": "string",
      "description": "Financial year in YYYY-YY format e.g. 2024-25. Infer from invoice date if not printed."
    },

    "irn": {
      "type": "string",
      "description": "Invoice Reference Number (IRN). Exactly 64 hexadecimal characters. Present on e-invoices from suppliers above Rs 10 Cr turnover."
    },
    "irn_ack_number": {
      "type": "string",
      "description": "IRN acknowledgement number from IRP portal"
    },
    "irn_ack_date": {
      "type": "string",
      "description": "IRN acknowledgement date"
    },
    "qr_code_present": {
      "type": "boolean",
      "description": "Whether a QR code is visually present on the invoice"
    },

    "reverse_charge": {
      "type": "boolean",
      "description": "Whether reverse charge applies. True if invoice says Reverse Charge Yes or RCM Y"
    },
    "supply_type": {
      "type": "string",
      "description": "Type of supply: B2B, B2C, Export WithPayment, Export UnderLUT, SEZ WithPayment, SEZ WithoutPayment, Deemed Export"
    },
    "place_of_supply": {
      "type": "string",
      "description": "Place of supply state name and/or 2-digit state code. Determines whether CGST+SGST or IGST applies."
    },
    "place_of_supply_code": {
      "type": "integer",
      "description": "2-digit numeric state code for place of supply. Range 01-38 or 97/99."
    },

    "eway_bill_number": {
      "type": "string",
      "description": "12-digit E-Way Bill number if printed"
    },
    "vehicle_number": {
      "type": "string",
      "description": "Vehicle registration number e.g. MH12AB1234"
    },
    "lr_gr_number": {
      "type": "string",
      "description": "Lorry Receipt or Goods Receipt number"
    },
    "transport_mode": {
      "type": "string",
      "description": "Mode of transport: Road, Rail, Air, Ship"
    },

    "po_number": {
      "type": "string",
      "description": "Buyer Purchase Order number if referenced"
    },
    "po_date": {
      "type": "string",
      "description": "PO date if mentioned"
    },

    "currency": {
      "type": "string",
      "description": "Currency code. INR for domestic. ISO 4217 for exports e.g. USD, EUR."
    },

    "seller": {
      "type": "object",
      "description": "Supplier/seller details. Usually top-left block labelled From, Sold By, Supplier.",
      "properties": {
        "legal_name":    { "type": "string", "description": "Legal registered name of the entity as per GST registration" },
        "trade_name":    { "type": "string", "description": "Trade name if different from legal name" },
        "gstin":         { "type": "string", "description": "GST Identification Number. Exactly 15 characters. Format: 2-digit state code + 5 alpha + 4 digits + 1 alpha + 1 alphanumeric + Z + 1 alphanumeric. Example: 27AABCU9603R1ZM" },
        "pan":           { "type": "string", "description": "PAN number. 10 characters. Can be extracted from GSTIN chars 3-12." },
        "address_line1": { "type": "string", "description": "First address line: flat/door/plot number, building name" },
        "address_line2": { "type": "string", "description": "Second address line: street, road, area, locality" },
        "city":          { "type": "string", "description": "City name" },
        "state":         { "type": "string", "description": "State name e.g. Maharashtra, Gujarat" },
        "state_code":    { "type": "integer", "description": "2-digit state code from GST. First 2 digits of GSTIN. E.g. 27 for Maharashtra." },
        "pincode":       { "type": "string", "description": "6-digit Indian PIN code. Must start with 1-8." },
        "phone":         { "type": "string", "description": "Phone or mobile number" },
        "email":         { "type": "string", "description": "Email address" }
      }
    },

    "buyer": {
      "type": "object",
      "description": "Buyer/bill-to party. Usually top-right block labelled Bill To, Buyer, Consignee.",
      "properties": {
        "legal_name":    { "type": "string", "description": "Legal registered name of the entity as per GST registration" },
        "trade_name":    { "type": "string", "description": "Trade name if different from legal name" },
        "gstin":         { "type": "string", "description": "GST Identification Number. Exactly 15 characters." },
        "pan":           { "type": "string", "description": "PAN number. 10 characters." },
        "address_line1": { "type": "string", "description": "First address line" },
        "address_line2": { "type": "string", "description": "Second address line" },
        "city":          { "type": "string", "description": "City name" },
        "state":         { "type": "string", "description": "State name" },
        "state_code":    { "type": "integer", "description": "2-digit GST state code" },
        "pincode":       { "type": "string", "description": "6-digit PIN code" },
        "phone":         { "type": "string", "description": "Phone or mobile number" },
        "email":         { "type": "string", "description": "Email address" }
      }
    },

    "ship_to": {
      "type": "object",
      "description": "Ship-to/delivery address if different from buyer. Third address block if present.",
      "properties": {
        "legal_name":    { "type": "string", "description": "Name of the ship-to party" },
        "gstin":         { "type": "string", "description": "GSTIN of ship-to party" },
        "address_line1": { "type": "string", "description": "First address line" },
        "address_line2": { "type": "string", "description": "Second address line" },
        "city":          { "type": "string", "description": "City name" },
        "state":         { "type": "string", "description": "State name" },
        "state_code":    { "type": "integer", "description": "2-digit GST state code" },
        "pincode":       { "type": "string", "description": "6-digit PIN code" }
      }
    },

    "line_items": {
      "type": "array",
      "description": "All line items in the invoice table. Each row = one LineItem. Exclude subtotal rows and page total rows.",
      "items": {
        "type": "object",
        "properties": {
          "sl_no":            { "type": "integer", "description": "Serial number of line item" },
          "description":      { "type": "string",  "description": "Full item or service description. Capture multi-line descriptions completely." },
          "hsn_code":         { "type": "string",  "description": "HSN code for goods (4, 6 or 8 digits) or SAC code for services (6 digits starting with 99). Extract exactly as printed." },
          "uom":              { "type": "string",  "description": "Unit of measurement: NOS, KGS, MTR, LTR, PCS, BOX, SET, PKT, DZN, SQM, CFT, etc." },
          "quantity":         { "type": "number",  "description": "Billed quantity. May have up to 4 decimal places." },
          "rate":             { "type": "number",  "description": "Rate per unit before discount. May have up to 6 decimal places." },
          "gross_amount":     { "type": "number",  "description": "Gross amount = quantity x rate before discount" },
          "discount_percent": { "type": "number",  "description": "Discount percentage if mentioned" },
          "discount_amount":  { "type": "number",  "description": "Total discount amount for this line" },
          "taxable_value":    { "type": "number",  "description": "Taxable value = gross amount minus discount. Base for GST calculation." },
          "gst_rate":         { "type": "number",  "description": "Total GST rate percentage for this line. Valid values: 0, 0.1, 0.25, 1.5, 3, 5, 12, 18, 28" },
          "cgst_rate":        { "type": "number",  "description": "CGST rate = half of total GST rate. Only for intra-state supply." },
          "cgst_amount":      { "type": "number",  "description": "CGST tax amount" },
          "sgst_rate":        { "type": "number",  "description": "SGST rate. Must equal CGST rate. Only for intra-state supply." },
          "sgst_amount":      { "type": "number",  "description": "SGST tax amount" },
          "igst_rate":        { "type": "number",  "description": "IGST rate = CGST + SGST combined. Only for inter-state supply." },
          "igst_amount":      { "type": "number",  "description": "IGST tax amount" },
          "line_total":       { "type": "number",  "description": "Total for this line = taxable value + all taxes" }
        }
      }
    },

    "footer": {
      "type": "object",
      "description": "Summary totals, tax breakup, and payment details block at bottom of invoice.",
      "properties": {
        "total_taxable_value": { "type": "number", "description": "Sum of all taxable values across all lines" },
        "total_discount":      { "type": "number", "description": "Total discount amount across all lines" },
        "tax_breakup": {
          "type": "array",
          "description": "Rate-wise GST summary table. One row per GST rate slab.",
          "items": {
            "type": "object",
            "properties": {
              "taxable_value": { "type": "number", "description": "Taxable value for this GST rate slab" },
              "cgst_rate":     { "type": "number", "description": "CGST rate percentage" },
              "cgst_amount":   { "type": "number", "description": "CGST tax amount for this slab" },
              "sgst_rate":     { "type": "number", "description": "SGST rate percentage" },
              "sgst_amount":   { "type": "number", "description": "SGST tax amount" },
              "igst_rate":     { "type": "number", "description": "IGST rate percentage" },
              "igst_amount":   { "type": "number", "description": "IGST tax amount" }
            }
          }
        },
        "total_cgst":        { "type": "number", "description": "Total CGST amount" },
        "total_sgst":        { "type": "number", "description": "Total SGST amount" },
        "total_igst":        { "type": "number", "description": "Total IGST amount" },
        "other_charges":     { "type": "number", "description": "Other charges like freight, packing, insurance" },
        "round_off":         { "type": "number", "description": "Rounding adjustment, can be positive or negative, usually within plus/minus 1" },
        "grand_total":       { "type": "number", "description": "Final invoice total in figures (numbers)" },
        "grand_total_words": { "type": "string", "description": "Grand total written in words. Indian format: Rupees X Lakhs Y Thousand Z and Paise P Only" },
        "payment_terms":     { "type": "string", "description": "Payment terms e.g. Net 30, Immediate, Due on delivery" },
        "due_date":          { "type": "string", "description": "Payment due date in DD/MM/YYYY format" },
        "bank_details": {
          "type": "object",
          "description": "Bank account details for payment if printed on invoice",
          "properties": {
            "account_number": { "type": "string", "description": "Bank account number" },
            "ifsc_code":      { "type": "string", "description": "IFSC code, format: 4 alpha + 0 + 6 alphanumeric e.g. HDFC0001234" },
            "bank_name":      { "type": "string", "description": "Name of the bank" },
            "branch":         { "type": "string", "description": "Branch name or city" }
          }
        }
      }
    }
  }
}
```

### Field Categories

| Category | Fields | Purpose |
|----------|--------|---------|
| **Header** | invoice_type, invoice_number, invoice_date, financial_year | Core identification |
| **E-Invoice** | irn, irn_ack_number, irn_ack_date, qr_code_present | E-invoice compliance |
| **Credit/Debit Note** | original_invoice_number, original_invoice_date | Reference to original |
| **Tax Determination** | reverse_charge, supply_type, place_of_supply, place_of_supply_code | GST tax type selection |
| **Transport** | eway_bill_number, vehicle_number, lr_gr_number, transport_mode | E-Way Bill details |
| **Purchase Order** | po_number, po_date | Buyer PO reference |
| **Seller** | seller.* (12 fields) | Supplier identity and address |
| **Buyer** | buyer.* (12 fields) | Buyer identity and address |
| **Ship To** | ship_to.* (8 fields) | Delivery address |
| **Line Items** | line_items[].* (17 fields per line) | Item-level detail |
| **Footer** | footer.* (totals, tax breakup, bank, payment) | Summary and payment |

---

## 4. Schema Registry & Versioning

Schemas are versioned per document type. Only one version is active at a time.

### Operations

| Operation | Description |
|-----------|-------------|
| `CreateSchema(docTypeID, jsonSchema, fieldHints)` | Creates next version (auto-increments) |
| `GetActive(docTypeID)` | Returns currently active schema |
| `Activate(docTypeID, version)` | Sets a version as active, deactivates others |
| `List(docTypeID)` | Lists all versions (newest first) |
| `CreateDefaultInvoiceSchema(docTypeID)` | Creates the built-in Indian invoice schema as v1 |

### Schema Enrichment

Before extraction, field hints are merged into the schema's `description` fields:

```
Original:  "description": "Invoice date in DD/MM/YYYY format"
With hint: "description": "Invoice date in DD/MM/YYYY format HINT: Look for date near invoice number, usually in header area."
```

This enrichment is done at runtime, not persisted — the original schema stays clean.

### Schema Validation Rules

- Must be valid JSON
- Root `type` must be `"object"`
- Must have `"properties"` at root level

---

## 5. Provider Interface

The extraction system is provider-agnostic. Any backend can implement this interface:

```
Provider {
    Name() → string                                           // "llamaindex", "azure", "google"
    Parse(PDF, tier, language, instruction) → (text, pages, credits, jobID)
    Extract(text, schema, mode, hints) → (data, confidence, pageCount, tokensUsed)
    Classify(PDF, categories) → (category, confidence)
}
```

### Parse Input/Output

**Input:**
- `PDF` — raw bytes
- `Tier` — parsing quality level (see Parse Tiers table)
- `Language` — e.g. `"en"`, `"hi"`
- `Instruction` — custom instruction text for this document type

**Output:**
- `Text` — extracted markdown/structured text
- `Pages` — page count
- `CreditsUsed` — provider credit consumption
- `JobID` — provider-specific job reference

### Extract Input/Output

**Input:**
- `Text` — from Parse step (markdown)
- `PDF` — raw bytes (some providers need this)
- `Schema` — JSON Schema defining target fields
- `Mode` — extraction quality level (see Extract Modes table)
- `Hints` — error hints from previous validation failures (for retry)

**Output:**
- `Data` — extracted JSON matching the schema
- `Confidence` — 0.0 to 1.0
- `PageCount` — from extraction metadata
- `TokensUsed` — from extraction metadata

### Classify Input/Output

**Input:**
- `PDF` — raw bytes
- `Categories` — list of possible document types, e.g. `["invoice", "bank_statement", "receipt"]`

**Output:**
- `Category` — matched category string
- `Confidence` — 0.0 to 1.0

---

## 6. Document Classification

Classification uses the LlamaCloud classification API to determine which document type a PDF belongs to.

### How It Works

1. Create a classification agent with the list of possible categories
2. Upload the PDF to the agent
3. Receive: `{ category: "invoice", confidence: 0.92 }`

### API Endpoints (LlamaCloud)

```
POST /classification/agents          → Create agent with categories
POST /classification/agents/{id}/classify → Upload PDF for classification
```

### Usage

Classification is optional. If the document type is known upfront (e.g., user selects "invoice" when uploading), classification is skipped. It's useful for:

- Auto-categorizing bulk uploads
- Routing documents to the correct schema
- Confidence-based human review triggers

---

## 7. PDF Intelligence — Digital vs Scanned Detection

The system analyzes raw PDF bytes to infer whether a document is digital (text-based) or scanned (image-based), then selects appropriate parse tier and extract mode.

### Detection Algorithm

```
looksDigitalPDF(fileName, pdfBytes):
    # Filename heuristics (if name contains these, assume scanned)
    if fileName contains "scan" or "photo" or "cam" → return false (scanned)

    # Structural analysis of PDF bytes
    fontMarkers  = count("/Font" in pdfBytes)
    textMarkers  = count(" BT" or "\nBT" in pdfBytes)    # BT = Begin Text operator
    imageMarkers = count("/Subtype /Image" in pdfBytes)

    # Decision: digital if has fonts+text, or fonts with no images
    return (fontMarkers >= 2 AND textMarkers >= 1) OR (fontMarkers > 0 AND imageMarkers == 0)
```

### Tier/Mode Selection Based on Detection

| PDF Type | Parse Tier | Extract Mode |
|----------|-----------|--------------|
| Digital | `cost_effective` | `balanced` |
| Scanned | `agentic` | `multimodal` |

---

## 8. Pipeline Orchestration

The pipeline runs the complete extraction flow with caching, retry, and validation.

### Full Pipeline Flow

```
Pipeline.Run(Request) → Result

1. LOAD CONFIG
   ├─ Get DocumentType (tier, mode, validation rules, parsing instruction)
   └─ Get Active Schema (JSON Schema + field hints)

2. CACHE CHECK
   ├─ Key = sha256(PDF bytes) + ":" + schemaVersion + ":" + providerName
   ├─ If hit AND NOT forceReextract → return cached result immediately
   └─ Cache stores: ParsedText, ExtractedData, ValidationResult, SchemaVersion, Provider

3. PARSE (once per PDF)
   ├─ Determine tier: override > docType.parseTier > auto-detect
   ├─ Provider.Parse(PDF, tier, "en", parsingInstruction)
   └─ Result: markdown text, page count, credits used

4. ENRICH SCHEMA
   └─ Merge field hints into schema descriptions (adds " HINT: ..." suffix)

5. EXTRACT-VALIDATE LOOP (1 to maxAttempts, default 3)
   │
   ├─ EXTRACT
   │  ├─ If hints exist from previous failure: prepend to text as:
   │  │   "EXTRACTION HINTS (from previous validation failures, please correct these):\n"
   │  │   "- hint1\n- hint2\n\n---\n\n{original text}"
   │  ├─ Get or create extraction agent (cached by sha256(schema+mode))
   │  └─ Provider.Extract(text, enrichedSchema, mode, hints)
   │
   ├─ VALIDATE
   │  ├─ Run all configured rule sets against extracted data
   │  ├─ Classify each rule result as error (blocks) or warning (informational)
   │  └─ Compute score: 1.0 - (errors × 0.15) - (warnings × 0.05)
   │
   ├─ TRACK BEST
   │  └─ Keep attempt with highest validation score
   │
   ├─ DECIDE
   │  ├─ If PASS or WARN → stop (warnings can't be fixed by retry)
   │  ├─ If FAIL and more attempts left → build hints, continue loop
   │  └─ If FAIL and penultimate attempt + tierEscalation → re-parse at higher tier
   │
   └─ TIER ESCALATION (on attempt == maxAttempts - 1)
      └─ cost_effective → agentic → agentic_plus (re-parse with better tier)

6. CACHE RESULT
   └─ Store with 30-day TTL

7. RETURN
   ├─ JobID, Status, Attempts, FromCache
   ├─ ExtractedData (JSON), ValidationResult
   ├─ ParsedText, Provider, CreditsUsed, DurationMs
   └─ Status is always "complete" even if validation failed (the data is the best we got)
```

### Pipeline Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MaxAttempts` | 3 | Maximum extract-validate cycles |
| `TierEscalation` | false | Whether to re-parse at higher tier on final attempt |

### Extraction Job Status Lifecycle

```
pending → parsing → extracting → validating → complete
                                            → failed (all attempts errored)
```

---

## 9. Validation Engine

The validation engine runs configurable rule sets against extracted JSON data.

### Architecture

```
Engine {
    ruleSets: map[name] → RuleSet

    Validate(data, ruleSetNames) → ValidationResult
    BuildHints(result) → []string
}

RuleSet {
    Name: string         // "invoice", "common", "party"
    Rules: []Rule
}

Rule {
    Name: string                                   // "gstin_checksum", "line_arithmetic", etc.
    Check: func(data) → []ValidationError
}
```

### Validation Result

```
ValidationResult {
    Status:   "PASS" | "WARN" | "FAIL"
    Errors:   []ValidationError    // Hard failures (trigger retry)
    Warnings: []ValidationError    // Soft issues (informational only)
    Score:    float64              // 0.0 to 1.0
}

ValidationError {
    Rule:    string    // "line_arithmetic"
    Field:   string    // "line_items[2].gross_amount"
    Message: string    // "Line 3: qty(10)×rate(500)=5000 but got 500"
    Hint:    string    // Natural-language hint for LLM retry
}
```

### Status Determination

```
if any errors    → FAIL
if only warnings → WARN
if nothing       → PASS
```

### Score Calculation

```
score = 1.0 - (error_count × 0.15) - (warning_count × 0.05)
score = max(score, 0.0)
```

### Warning vs Error Classification

Rules are classified as **warning** (never trigger retry) or **error** (trigger retry):

| Rule | Classification | Rationale |
|------|---------------|-----------|
| `words_vs_figures` | WARNING | Printed discrepancy, can't be fixed by re-extraction |
| `round_off_check` | WARNING | Rounding is inherent to the invoice, not an extraction error |
| `party_match` | WARNING | Party name matching is advisory, not a data quality issue |
| All others | ERROR | Indicates incorrect extraction that may improve on retry |

---

## 10. Validation Rules — Invoice

Rule set name: `"invoice"`

### Rule 1: `gstin_checksum`

**Purpose:** Validates GSTIN format for seller and buyer.

**Fields checked:** `seller.gstin`, `buyer.gstin`

**Algorithm:**
```
1. Trim whitespace, uppercase
2. Length must be exactly 15
3. Regex: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}Z[A-Z0-9]{1}$/
4. State code (first 2 digits): must be 01-38, 97, or 99
5. Character at position 13 (0-indexed) must be 'Z'
```

**Example error:**
```
Field:   "seller.gstin"
Message: "Seller GSTIN "27AABCU9603R1XM" fails format/checksum validation"
Hint:    "The seller GSTIN '27AABCU9603R1XM' appears invalid. Please re-extract the GSTIN
          exactly as printed on the invoice. It must be 15 characters: 2 digits + 5 letters +
          4 digits + 1 letter + 1 alphanumeric + Z + 1 alphanumeric."
```

### Rule 2: `line_arithmetic`

**Purpose:** Verifies `quantity × rate = gross_amount` for each line item.

**Tolerance:** ±1.0

**Skip condition:** Any of quantity, rate, or gross_amount is null/missing.

**Example error:**
```
Field:   "line_items[2].gross_amount"
Message: "Line 3: qty(10.00) × rate(500.00) = 5000.00 but extracted gross_amount=500.00"
Hint:    "Line 3 arithmetic error: quantity(10.00) multiplied by rate(500.00) should equal
          5000.00, but the extracted gross_amount is 500.00. Please re-check this line item's
          quantity, rate, and gross amount."
```

### Rule 3: `line_taxable_value`

**Purpose:** Verifies `gross_amount - discount_amount = taxable_value` for each line item.

**Tolerance:** ±1.0

**Skip condition:** gross_amount or taxable_value is null. Discount defaults to 0 if missing.

**Example error:**
```
Field:   "line_items[0].taxable_value"
Message: "Line 1: gross(5000.00) - discount(200.00) = 4800.00 but extracted taxable_value=5000.00"
```

### Rule 4: `cgst_equals_sgst`

**Purpose:** CGST rate must always equal SGST rate (they are each half of the total GST rate).

**Tolerance:** ±0.01

**Skip condition:** Either cgst_rate or sgst_rate is null.

**Example error:**
```
Field:   "line_items[0]"
Message: "Line 1: CGST rate(9.00%) ≠ SGST rate(4.50%)"
```

### Rule 5: `cgst_igst_exclusion`

**Purpose:** CGST/SGST and IGST are mutually exclusive on any single line item. A line uses CGST+SGST (intra-state) OR IGST (inter-state), never both.

**Condition:** Both cgst_amount > 0 AND igst_amount > 0 on the same line.

**Example error:**
```
Field:   "line_items[0]"
Message: "Line 1: Both CGST(450.00) and IGST(900.00) are present — they are mutually exclusive"
```

### Rule 6: `footer_taxable_total`

**Purpose:** Sum of all line item taxable_value fields must equal footer.total_taxable_value.

**Tolerance:** ±2.0

**Skip condition:** Footer or total_taxable_value is null, or no line items exist.

**Example error:**
```
Field:   "footer.total_taxable_value"
Message: "Sum of line taxable values (48000.00) ≠ footer total_taxable_value (50000.00)"
```

### Rule 7: `footer_tax_totals`

**Purpose:** Sum of all line CGST/SGST/IGST amounts must equal corresponding footer totals.

**Tolerance:** ±2.0 (for each tax type independently)

**Checks three sums independently:**
- Sum of line cgst_amount vs footer.total_cgst
- Sum of line sgst_amount vs footer.total_sgst
- Sum of line igst_amount vs footer.total_igst

### Rule 8: `grand_total_check`

**Purpose:** Verifies the grand total equation:
```
grand_total = total_taxable_value + total_cgst + total_sgst + total_igst + total_cess + other_charges + round_off
```

**Tolerance:** ±2.0

**Skip condition:** Footer, grand_total, or total_taxable_value is null.

### Rule 9: `words_vs_figures` (WARNING)

**Purpose:** Cross-checks grand_total (number) against grand_total_words (text).

**Tolerance:** ±1.0

**Uses:** Indian number words parser (see Section 17).

**Skip condition:** Either field is missing, or words can't be parsed.

### Rule 10: `round_off_check` (WARNING)

**Purpose:** Round-off amount should be within ±1.00 (standard accounting practice).

**Condition:** `|round_off| > 1.0`

---

## 11. Validation Rules — Common

Rule set name: `"common"`

### Rule 1: `required_fields`

**Purpose:** Ensures critical fields are present and not null.

**Required fields:**
- `invoice_number`
- `invoice_date`

**Example error:**
```
Field:   "invoice_number"
Message: "Invoice Number is missing or null"
Hint:    "The Invoice Number field is missing. This is usually prominently displayed on the
          document. Please look for it and extract it."
```

### Rule 2: `date_format`

**Purpose:** Validates that date fields look like actual dates.

**Fields checked:** `invoice_date`, `original_invoice_date`

**Algorithm:**
```
1. Split on /, -, or . separator
2. Must have at least 2 parts
3. First part must be all digits (1-4 chars)
```

This is intentionally lenient — it accepts DD/MM/YYYY, YYYY-MM-DD, D.M.YY, etc.

---

## 12. Validation Rules — Party Matching

Rule set name: `"party"`

This rule set is **dynamic** — it's only registered when the document type is scoped to a specific company that has Tally ledger data.

### Rule: `party_match` (WARNING)

**Purpose:** Matches extracted seller/buyer names against the company's Tally ledger database.

**Fields checked:** `seller.name`, `buyer.name`

**Matching algorithm:**
```
1. Search company's ledgers for the party name
2. If no results found → warning "Party not found in Tally ledgers"
3. If results found, check for exact match (case-insensitive):
   a. Match against ledger.Name
   b. Match against ledger.Alias
   c. Match against ledger.MailingName
4. If no exact match → warning "No exact match; closest: <name>"
5. If exact match → no warning
```

---

## 13. Retry & Tier Escalation

### Retry Logic

When validation returns FAIL:
1. Build natural-language hints from validation errors
2. Prepend hints to the parsed text as:
   ```
   EXTRACTION HINTS (from previous validation failures, please correct these):
   - hint 1
   - hint 2

   ---

   {original parsed text}
   ```
3. Re-extract with the same schema but enriched text

Only FAIL-level errors generate retry hints. Warnings are excluded because:
- They represent issues in the source document, not extraction errors
- Re-extraction cannot fix printed discrepancies

### Tier Escalation

On the penultimate attempt (attempt == maxAttempts - 1), if `tierEscalation` is enabled:

```
Parse tier escalation:
  cost_effective → agentic → agentic_plus

Extract mode escalation:
  fast → balanced → multimodal → premium
```

The system re-parses the PDF at the higher tier, producing better markdown, then extracts again.

### Best Result Selection

Across all attempts, the system tracks the attempt with the **highest validation score**. Even if no attempt achieves PASS, the best result is returned as "complete" with its validation errors attached.

---

## 14. Caching Strategy

### Cache Key Format

```
{sha256(PDF bytes)}:{schemaVersion}:{providerName}
```

Example: `a3b4c5d6...f7:2:llamaindex`

### Cached Data

```
CachedResult {
    ParsedText       string          // Markdown from parse step
    ExtractedData    json.RawMessage // Extracted JSON
    ValidationResult json.RawMessage // Serialized ValidationResult
    SchemaVersion    int
    Provider         string
    CachedAt         timestamp
}
```

### Cache Behavior

- **TTL:** 30 days
- **Bypass:** Set `ForceReextract: true` to skip cache
- **Invalidation:** Cache key includes schema version, so schema changes automatically invalidate
- **Hit:** Returns immediately with `FromCache: true`, no API calls made

---

## 15. Expected Output Format

### Extraction Job Record

```json
{
  "id": "uuid",
  "tenant_id": "uuid",
  "doc_type_id": "uuid",
  "document_id": "uuid",
  "company_id": "uuid",
  "schema_version": 1,
  "input_file_name": "invoice_001.pdf",
  "status": "complete",
  "attempts": 2,
  "from_cache": false,
  "force_reextract": false,
  "parsed_text": "# Invoice\n\nInvoice No: INV/2024-25/001\n...",
  "extracted_data": { ... },
  "validation_result": {
    "status": "WARN",
    "errors": [],
    "warnings": [
      {
        "rule": "words_vs_figures",
        "field": "footer.grand_total_words",
        "message": "Amount in words (parsed: 48500.00) ≠ grand_total in figures (48450.00)",
        "hint": "..."
      }
    ],
    "score": 0.95
  },
  "provider_used": "llamaindex",
  "credits_used": 3,
  "duration_ms": 12500,
  "created_at": "2024-12-15T10:30:00Z"
}
```

### Extracted Data Example (matching schema)

```json
{
  "invoice_type": "Tax Invoice",
  "invoice_number": "INV/2024-25/001",
  "invoice_date": "15/12/2024",
  "financial_year": "2024-25",
  "currency": "INR",
  "reverse_charge": false,
  "supply_type": "B2B",
  "place_of_supply": "Maharashtra",
  "place_of_supply_code": 27,

  "seller": {
    "legal_name": "ABC Trading Co Pvt Ltd",
    "gstin": "27AABCU9603R1ZM",
    "pan": "AABCU9603R",
    "address_line1": "Plot 42, MIDC Industrial Area",
    "city": "Pune",
    "state": "Maharashtra",
    "state_code": 27,
    "pincode": "411018"
  },

  "buyer": {
    "legal_name": "XYZ Enterprises LLP",
    "gstin": "27AADFX1234E1Z5",
    "address_line1": "Shop No 5, Market Complex",
    "city": "Mumbai",
    "state": "Maharashtra",
    "state_code": 27,
    "pincode": "400001"
  },

  "line_items": [
    {
      "sl_no": 1,
      "description": "Steel Rods 12mm TMT Fe500D",
      "hsn_code": "72142090",
      "uom": "KGS",
      "quantity": 500,
      "rate": 85.50,
      "gross_amount": 42750.00,
      "discount_amount": 0,
      "taxable_value": 42750.00,
      "gst_rate": 18,
      "cgst_rate": 9,
      "cgst_amount": 3847.50,
      "sgst_rate": 9,
      "sgst_amount": 3847.50,
      "line_total": 50445.00
    }
  ],

  "footer": {
    "total_taxable_value": 42750.00,
    "total_cgst": 3847.50,
    "total_sgst": 3847.50,
    "round_off": -0.50,
    "grand_total": 50444.50,
    "grand_total_words": "Rupees Fifty Thousand Four Hundred Forty Four and Paise Fifty Only",
    "payment_terms": "Net 30"
  }
}
```

---

## 16. Field Hints — LLM Extraction Guidance

Field hints are supplementary instructions merged into schema descriptions at extraction time. They tell the LLM **where to look** on the document.

### Default Invoice Field Hints

| Field Path | Hint |
|------------|------|
| `seller.gstin` | Look in the top-left or top section, near 'GSTIN', 'GST No', or 'GST IN'. Exactly 15 alphanumeric characters. |
| `buyer.gstin` | Look in the 'Bill To', 'Buyer', or 'Consignee' section. Exactly 15 alphanumeric characters. |
| `line_items` | Extract every row from the item table. Exclude subtotal rows, running totals, and blank rows. |
| `footer.grand_total` | The final amount in figures. Usually the largest number on the invoice, near 'Total', 'Grand Total', or 'Net Payable'. |
| `footer.grand_total_words` | The total amount written out in words. Usually says 'Rupees ... Only' or 'INR ... Only'. |
| `footer.tax_breakup` | Rate-wise GST summary table, usually near the bottom. One row per GST rate slab. |

### How Hints Are Applied

```
schema.properties["seller.gstin"].description =
    "GST Identification Number. Exactly 15 characters. Format: ..."
    + " HINT: Look in the top-left or top section, near 'GSTIN', 'GST No', or 'GST IN'."
```

---

## 17. Indian Number Words Parser

Parses Indian number format words to a float value. Used by `words_vs_figures` validation.

### Supported Format

```
"Rupees [X] Lakhs [Y] Thousand [Z] Hundred [W] and Paise [P] Only"
```

### Parser Algorithm

```
1. Normalize: lowercase, trim
2. Strip prefixes: "rupees ", "inr ", "rs. ", "rs "
3. Strip suffixes: " only", " only.", "."
4. Split on " and paise " or " and X paise"
5. Parse main part and paise separately

Token parsing:
- Word values: zero=0, one=1, ..., ninety=90
- Multipliers: hundred=100, thousand=1000, lakh/lakhs/lac/lacs=100000, crore/crores=10000000
- Hyphens converted to spaces: "twenty-three" → "twenty three"
- "and" ignored

Accumulation:
- current = running sub-total
- total = accumulated total
- When multiplier ≥ 100000 (lakh/crore): total += current × multiplier, current = 0
- When multiplier == 1000: total += current × multiplier, current = 0
- When multiplier == 100: current *= multiplier
- Final: total += current
```

### Examples

| Input | Parsed Value |
|-------|-------------|
| "Rupees Fifty Thousand Four Hundred Forty Four and Paise Fifty Only" | 50444.50 |
| "INR Two Lakhs Thirty Five Thousand Six Hundred Only" | 235600.00 |
| "Rs. One Crore Twenty Lakhs" | 12000000.00 |

---

## 18. GSTIN Format & Validation

### GSTIN Structure (15 characters)

```
Position:  01  02  03  04  05  06  07  08  09  10  11  12  13  14  15
Type:      D   D   A   A   A   A   A   D   D   D   D   A   AN  Z   AN
Example:   2   7   A   A   B   C   U   9   6   0   3   R   1   Z   M

D = Digit, A = Alpha, AN = Alphanumeric
```

| Positions | Meaning |
|-----------|---------|
| 1-2 | State code (01-38, 97, 99) |
| 3-12 | PAN number |
| 13 | Entity number within state (1-9, A-Z) |
| 14 | Always 'Z' |
| 15 | Check digit |

### Indian State Codes

| Code | State | Code | State |
|------|-------|------|-------|
| 01 | Jammu & Kashmir | 20 | Jharkhand |
| 02 | Himachal Pradesh | 21 | Odisha |
| 03 | Punjab | 22 | Chhattisgarh |
| 04 | Chandigarh | 23 | Madhya Pradesh |
| 05 | Uttarakhand | 24 | Gujarat |
| 06 | Haryana | 25 | Daman & Diu |
| 07 | Delhi | 26 | Dadra & Nagar Haveli |
| 08 | Rajasthan | 27 | Maharashtra |
| 09 | Uttar Pradesh | 28 | Andhra Pradesh (old) |
| 10 | Bihar | 29 | Karnataka |
| 11 | Sikkim | 30 | Goa |
| 12 | Arunachal Pradesh | 31 | Lakshadweep |
| 13 | Nagaland | 32 | Kerala |
| 14 | Manipur | 33 | Tamil Nadu |
| 15 | Mizoram | 34 | Puducherry |
| 16 | Tripura | 35 | Andaman & Nicobar |
| 17 | Meghalaya | 36 | Telangana |
| 18 | Assam | 37 | Andhra Pradesh (new) |
| 19 | West Bengal | 38 | Ladakh |
| 97 | Other Territory | 99 | Centre Jurisdiction |

---

## 19. Error Hint Generation for LLM Retry

When validation fails, the system generates natural-language hints that guide the LLM on what to fix during re-extraction.

### Hint Format

Each validation error has a pre-written `Hint` field. If the Hint is empty, the `Message` is used instead.

### How Hints Reach the LLM

Hints are prepended to the parsed text before re-upload:

```markdown
EXTRACTION HINTS (from previous validation failures, please correct these):
- Line 3 arithmetic error: quantity(10.00) multiplied by rate(500.00) should equal 5000.00, but the extracted gross_amount is 500.00. Please re-check this line item's quantity, rate, and gross amount.
- The seller GSTIN '27AABCU9603R1XM' appears invalid. Please re-extract the GSTIN exactly as printed on the invoice.

---

# Invoice

Invoice No: INV/2024-25/001
Date: 15/12/2024
...
```

### Key Design Decisions

1. Only FAIL-level errors generate hints (not warnings)
2. Hints are in natural language, not structured data
3. Hints tell the LLM both what's wrong AND what to do about it
4. The LLM sees both the original text and the hints, so it can re-read the source

---

## 20. Training Samples

The system supports training samples — pairs of (PDF, expected JSON) used to test and refine extraction quality.

```
TrainingSample {
    ID                string
    DocTypeID         string
    DocumentID        string           // Reference to stored PDF
    ExpectedJSON      json.RawMessage  // Human-verified correct extraction
    LastExtractedJSON json.RawMessage  // Last automated extraction attempt
    LastValidation    json.RawMessage  // Validation result of last attempt
    CreatedAt         timestamp
}
```

### Usage

1. Upload a PDF and manually create the correct expected JSON
2. Run extraction pipeline on the PDF
3. Compare `LastExtractedJSON` against `ExpectedJSON`
4. Use the diff to improve schemas, field hints, or parsing instructions
5. Track validation results over time to measure improvement

---

## 21. Integration Points

### LlamaCloud API Endpoints Used

| Service | Method | Endpoint | Purpose |
|---------|--------|----------|---------|
| LlamaParse | POST | `/parsing/upload` | Upload PDF for parsing |
| LlamaParse | GET | `/parsing/job/{id}` | Poll parse status |
| LlamaParse | GET | `/parsing/job/{id}/result/markdown` | Get parsed markdown |
| LlamaExtract | POST | `/extraction/extraction-agents` | Create extraction agent with schema |
| LlamaExtract | POST | `/extraction/jobs/file` | Upload file for extraction |
| LlamaExtract | GET | `/extraction/jobs/{id}` | Poll extraction status |
| LlamaExtract | GET | `/extraction/jobs/{id}/result` | Get extraction result |
| LlamaClassify | POST | `/classification/agents` | Create classification agent |
| LlamaClassify | POST | `/classification/agents/{id}/classify` | Classify a PDF |

### API Authentication

```
Authorization: Bearer {LLAMA_CLOUD_API_KEY}
```

### Base URL

```
https://api.cloud.llamaindex.ai/api/v1
```

### Extraction Result Parsing

The API result format varies. The parser handles three shapes:

1. **Array of page results:** `[{ "data": {...}, "extraction_metadata": {...} }]`
2. **Single object with data:** `{ "data": {...}, "extraction_metadata": {...} }`
3. **Raw JSON:** The extracted fields directly

The parser always extracts the innermost `data` field. Metadata (`total_tokens`, `total_pages`) is extracted from `extraction_metadata` if present.

### Agent Caching

Extraction agents are cached in-memory by `sha256(schema + mode)`. This avoids creating a new agent for every extraction when the same schema and mode are used repeatedly. The cache lives for the lifetime of the process.

---

## Appendix A: Tolerance Values Summary

| Rule | Tolerance | Unit |
|------|-----------|------|
| `line_arithmetic` (qty × rate = gross) | ±1.0 | currency |
| `line_taxable_value` (gross - discount = taxable) | ±1.0 | currency |
| `cgst_equals_sgst` | ±0.01 | percentage |
| `footer_taxable_total` | ±2.0 | currency |
| `footer_tax_totals` (CGST/SGST/IGST) | ±2.0 | currency |
| `grand_total_check` | ±2.0 | currency |
| `words_vs_figures` | ±1.0 | currency |
| `round_off_check` | ±1.0 | absolute value |

## Appendix B: Valid GST Rates

```
0, 0.1, 0.25, 1.5, 3, 5, 12, 18, 28
```

For intra-state supply: CGST = SGST = GST_rate / 2
For inter-state supply: IGST = GST_rate

## Appendix C: Indian GST Tax Logic Quick Reference

| Seller State = Buyer State? | Tax Type | Rates |
|-----------------------------|----------|-------|
| Yes (intra-state) | CGST + SGST | Each = half of GST rate |
| No (inter-state) | IGST only | Full GST rate |
| Never | Both CGST and IGST | **Invalid** — mutually exclusive |

## Appendix D: Document Status Flow

```
Extraction Job:   pending → parsing → extracting → validating → complete | failed
Review Item:      extracting → pending_review → approved | rejected → exported
                  extracting → duplicate (if same content hash already processed)
```


function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

function createField(id, label, options = {}) {
  return deepFreeze({
    id,
    label,
    type: options.type ?? "string",
    group: options.group ?? "document",
    requirement: options.requirement ?? "optional",
    repeatable: options.repeatable ?? false,
    sourceHints: options.sourceHints ?? [],
    description: options.description ?? "",
  });
}

const CORE_DOCUMENT_FIELDS = [
  createField("document.voucher_family", "Voucher Family", {
    requirement: "required",
    sourceHints: ["invoice", "debit note", "credit note", "proforma"],
    description: "Canonical voucher family chosen by the classifier/runtime.",
  }),
  createField("document.number", "Document Number", {
    requirement: "required",
    sourceHints: ["invoice no", "voucher no", "pi no", "bill no"],
    description: "Printed invoice or voucher number.",
  }),
  createField("document.date", "Document Date", {
    requirement: "required",
    sourceHints: ["date", "dated", "ack date"],
    description: "Primary invoice or voucher date.",
  }),
  createField("document.currency", "Currency", {
    requirement: "required",
    sourceHints: ["INR", "Rs.", "₹"],
    description: "Document currency inferred from OCR or issuer defaults.",
  }),
  createField("document.purchase_order_number", "Purchase Order Number", {
    sourceHints: ["po no", "po number"],
    description: "Upstream purchase order reference when printed.",
  }),
  createField("document.reference_number", "Reference Number", {
    sourceHints: ["reference", "challan no", "order ref"],
    description: "Secondary business reference used by some issuers.",
  }),
  createField("document.place_of_supply", "Place of Supply", {
    sourceHints: ["place of supply", "state"],
    description: "GST place of supply or destination state.",
  }),
  createField("document.e_way_bill_number", "E-Way Bill Number", {
    sourceHints: ["e-way bill", "eway bill"],
    description: "Optional logistics reference for Indian invoices.",
  }),
];

const CORE_PARTY_FIELDS = [
  createField("seller.name", "Seller Name", {
    group: "party",
    requirement: "required",
    sourceHints: ["from", "supplier", "seller"],
    description: "Issuer or supplier legal/trading name.",
  }),
  createField("seller.gstin", "Seller GSTIN", {
    group: "party",
    requirement: "conditional",
    sourceHints: ["gstin", "gst no", "uin"],
    description: "Issuer GSTIN when applicable.",
  }),
  createField("buyer.name", "Buyer Name", {
    group: "party",
    requirement: "conditional",
    sourceHints: ["buyer", "bill to", "sold to"],
    description: "Buyer or billed party name.",
  }),
  createField("buyer.gstin", "Buyer GSTIN", {
    group: "party",
    requirement: "conditional",
    sourceHints: ["buyer gstin", "bill to gstin"],
    description: "Buyer GSTIN when present on the document.",
  }),
  createField("consignee.name", "Consignee Name", {
    group: "party",
    sourceHints: ["ship to", "consignee"],
    description: "Separate consignee/ship-to party when distinct from buyer.",
  }),
  createField("consignee.gstin", "Consignee GSTIN", {
    group: "party",
    sourceHints: ["ship to gstin", "consignee gstin"],
    description: "Consignee GSTIN if separately printed.",
  }),
];

const CORE_AMOUNT_FIELDS = [
  createField("amounts.taxable_amount_cents", "Taxable Amount", {
    group: "amount",
    type: "money_cents",
    requirement: "conditional",
    sourceHints: ["taxable", "assessable value"],
    description: "Taxable value before tax additions.",
  }),
  createField("amounts.subtotal_cents", "Subtotal", {
    group: "amount",
    type: "money_cents",
    sourceHints: ["subtotal", "sub total"],
    description: "Subtotal before tax and rounding adjustments.",
  }),
  createField("amounts.discount_cents", "Discount", {
    group: "amount",
    type: "money_cents",
    sourceHints: ["discount", "disc."],
    description: "Header-level discount if explicitly printed.",
  }),
  createField("amounts.round_off_cents", "Round Off", {
    group: "amount",
    type: "money_cents",
    sourceHints: ["round off"],
    description: "Final round-off adjustment near the grand total.",
  }),
  createField("amounts.grand_total_cents", "Grand Total", {
    group: "amount",
    type: "money_cents",
    requirement: "required",
    sourceHints: ["grand total", "invoice total", "amount due", "amount payable", "total"],
    description: "Final payable amount for invoice-shaped documents.",
  }),
];

const CORE_TAX_FIELDS = [
  createField("taxes.igst_cents", "IGST Amount", {
    group: "tax",
    type: "money_cents",
    sourceHints: ["igst"],
    description: "Integrated GST amount.",
  }),
  createField("taxes.cgst_cents", "CGST Amount", {
    group: "tax",
    type: "money_cents",
    sourceHints: ["cgst"],
    description: "Central GST amount.",
  }),
  createField("taxes.sgst_cents", "SGST Amount", {
    group: "tax",
    type: "money_cents",
    sourceHints: ["sgst"],
    description: "State GST amount.",
  }),
  createField("taxes.cess_cents", "CESS Amount", {
    group: "tax",
    type: "money_cents",
    sourceHints: ["cess"],
    description: "CESS amount when applicable.",
  }),
];

const CORE_LINE_ITEM_FIELDS = [
  createField("line_items[].description", "Description", {
    group: "line_item",
    repeatable: true,
    requirement: "required",
    sourceHints: ["description", "particulars", "item"],
    description: "Line item description extracted from item rows.",
  }),
  createField("line_items[].hsn_sac", "HSN/SAC", {
    group: "line_item",
    repeatable: true,
    sourceHints: ["hsn", "sac"],
    description: "HSN/SAC classification code for the line item.",
  }),
  createField("line_items[].quantity", "Quantity", {
    group: "line_item",
    type: "decimal",
    repeatable: true,
    sourceHints: ["qty", "quantity"],
    description: "Quantity for the line item.",
  }),
  createField("line_items[].unit", "Unit", {
    group: "line_item",
    repeatable: true,
    sourceHints: ["unit", "uom"],
    description: "Printed unit of measure.",
  }),
  createField("line_items[].unit_price_cents", "Unit Price", {
    group: "line_item",
    type: "money_cents",
    repeatable: true,
    sourceHints: ["rate", "price"],
    description: "Line item unit price before discounts and tax.",
  }),
  createField("line_items[].tax_rate_percent", "Tax Rate Percent", {
    group: "line_item",
    type: "decimal",
    repeatable: true,
    sourceHints: ["gst %", "tax %"],
    description: "Printed line-level GST/tax rate percent.",
  }),
  createField("line_items[].amount_cents", "Line Amount", {
    group: "line_item",
    type: "money_cents",
    repeatable: true,
    requirement: "required",
    sourceHints: ["amount"],
    description: "Extended amount for the line item.",
  }),
];

const INDUSTRY_EXTENSION_FIELDS = deepFreeze({
  generic: [],
  pharma: [
    createField("line_items[].batch_number", "Batch Number", {
      group: "line_item",
      repeatable: true,
      sourceHints: ["batch", "batch no"],
      description: "Pharma/manufacturing batch identifier.",
    }),
    createField("line_items[].expiry_date", "Expiry Date", {
      group: "line_item",
      repeatable: true,
      sourceHints: ["expiry", "exp", "use before"],
      description: "Expiry date for medicine or regulated inventory.",
    }),
    createField("line_items[].mrp_cents", "MRP", {
      group: "line_item",
      type: "money_cents",
      repeatable: true,
      sourceHints: ["mrp"],
      description: "Maximum retail price printed on pharma items.",
    }),
  ],
  medical: [
    createField("line_items[].batch_number", "Batch Number", {
      group: "line_item",
      repeatable: true,
      sourceHints: ["batch", "lot"],
      description: "Medical stock batch identifier.",
    }),
    createField("line_items[].expiry_date", "Expiry Date", {
      group: "line_item",
      repeatable: true,
      sourceHints: ["expiry", "exp"],
      description: "Expiry date for medical inventory when printed.",
    }),
    createField("line_items[].serial_number", "Serial Number", {
      group: "line_item",
      repeatable: true,
      sourceHints: ["serial no", "sr no"],
      description: "Serialized medical device identifier when applicable.",
    }),
  ],
  trading: [
    createField("document.transport_reference", "Transport Reference", {
      sourceHints: ["lr no", "transport", "vehicle no"],
      description: "Transport or logistics reference used by trading invoices.",
    }),
    createField("line_items[].scheme_discount_cents", "Scheme Discount", {
      group: "line_item",
      type: "money_cents",
      repeatable: true,
      sourceHints: ["scheme", "discount"],
      description: "Trade scheme discount applied on the line item.",
    }),
  ],
  stockist: [
    createField("document.dispatch_reference", "Dispatch Reference", {
      sourceHints: ["dispatch", "challan", "delivery note"],
      description: "Dispatch/challan reference used by stockists.",
    }),
    createField("line_items[].free_quantity", "Free Quantity", {
      group: "line_item",
      type: "decimal",
      repeatable: true,
      sourceHints: ["free", "scheme"],
      description: "Free quantity supplied under scheme/stockist terms.",
    }),
    createField("line_items[].scheme_discount_cents", "Scheme Discount", {
      group: "line_item",
      type: "money_cents",
      repeatable: true,
      sourceHints: ["scheme", "discount"],
      description: "Scheme discount commonly printed on stockist invoices.",
    }),
  ],
});

export const TALLY_VOUCHER_FAMILIES = deepFreeze({
  sales_invoice: {
    id: "sales_invoice",
    label: "Sales Invoice",
    supported: true,
    class: "invoice",
    sourceHints: ["tax invoice", "invoice", "sales"],
    validators: [
      "document_has_number",
      "document_has_date",
      "invoice_has_grand_total",
      "seller_or_issuer_present",
    ],
  },
  purchase_invoice: {
    id: "purchase_invoice",
    label: "Purchase Invoice",
    supported: true,
    class: "invoice",
    sourceHints: ["purchase", "inward invoice"],
    validators: [
      "document_has_number",
      "document_has_date",
      "invoice_has_grand_total",
      "seller_or_supplier_present",
    ],
  },
  proforma_invoice: {
    id: "proforma_invoice",
    label: "Proforma Invoice",
    supported: true,
    class: "invoice",
    sourceHints: ["proforma invoice"],
    validators: [
      "document_has_number",
      "document_has_date",
      "invoice_has_grand_total",
    ],
  },
  credit_note: {
    id: "credit_note",
    label: "Credit Note",
    supported: true,
    class: "note",
    sourceHints: ["credit note"],
    validators: [
      "document_has_number",
      "document_has_date",
      "note_has_reference_or_amount",
    ],
  },
  debit_note: {
    id: "debit_note",
    label: "Debit Note",
    supported: true,
    class: "note",
    sourceHints: ["debit note"],
    validators: [
      "document_has_number",
      "document_has_date",
      "note_has_reference_or_amount",
    ],
  },
  account_statement: {
    id: "account_statement",
    label: "Account Statement",
    supported: false,
    class: "statement",
    sourceHints: ["statement of account", "account statement", "ledger"],
    rejectionReason:
      "Account statements contain running balances and need a separate ledger-oriented PSVM.",
    validators: [],
  },
});

export const TALLY_SCHEMA_CORE = deepFreeze({
  document: CORE_DOCUMENT_FIELDS,
  parties: CORE_PARTY_FIELDS,
  amounts: CORE_AMOUNT_FIELDS,
  taxes: CORE_TAX_FIELDS,
  lineItems: CORE_LINE_ITEM_FIELDS,
});

export const TALLY_INDUSTRY_EXTENSIONS = INDUSTRY_EXTENSION_FIELDS;

export function listVoucherFamilies() {
  return Object.keys(TALLY_VOUCHER_FAMILIES);
}

export function listSupportedIndustries() {
  return Object.keys(TALLY_INDUSTRY_EXTENSIONS);
}

export function buildTallyVoucherSchema(voucherFamily, options = {}) {
  const voucher = TALLY_VOUCHER_FAMILIES[voucherFamily];
  if (!voucher) {
    throw new Error(`Unknown voucher family: ${voucherFamily}`);
  }

  const industry = options.industry ?? "generic";
  const industryFields = TALLY_INDUSTRY_EXTENSIONS[industry];
  if (!industryFields) {
    throw new Error(`Unknown industry extension: ${industry}`);
  }

  return {
    voucherFamily: voucher.id,
    voucherLabel: voucher.label,
    supported: voucher.supported,
    class: voucher.class,
    industry,
    rejectionReason: voucher.rejectionReason ?? null,
    validators: [...voucher.validators],
    fields: {
      document: [...TALLY_SCHEMA_CORE.document],
      parties: [...TALLY_SCHEMA_CORE.parties],
      amounts: [...TALLY_SCHEMA_CORE.amounts],
      taxes: [...TALLY_SCHEMA_CORE.taxes],
      lineItems: [...TALLY_SCHEMA_CORE.lineItems, ...industryFields],
    },
  };
}

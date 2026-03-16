export const INVOICE_PSVM_OPS = Object.freeze([
  "READ_ITEM",
  "LINE_TOTAL",
  "ADD_SUBTOTAL",
  "APPLY_TAX",
  "EMIT_TOTAL",
  "HALT",
]);

export const DEFAULT_INVOICE = JSON.stringify(
  {
    currency: "USD",
    taxRate: 0.0825,
    items: [
      { label: "Design sprint", quantity: 2, unitPrice: "150.00" },
      { label: "Prototype build", quantity: 3, unitPrice: "240.00" },
      { label: "QA pass", quantity: 1, unitPrice: "95.50" },
    ],
  },
  null,
  2,
);

function parseMoneyToCents(value) {
  if (typeof value === "number") {
    return Math.round(value * 100);
  }

  if (typeof value !== "string") {
    throw new Error("Invoice prices must be numbers or decimal strings.");
  }

  const normalized = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`Invalid money value: ${value}`);
  }

  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return cents;
}

function parseTaxRate(rate) {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) {
    throw new Error("Invoice taxRate must be a non-negative number.");
  }

  return Math.round(rate * 10000);
}

export function parseInvoice(source) {
  const invoice = JSON.parse(source);
  if (!invoice || typeof invoice !== "object") {
    throw new Error("Invoice must be a JSON object.");
  }

  if (!Array.isArray(invoice.items) || invoice.items.length === 0) {
    throw new Error("Invoice must contain at least one line item.");
  }

  const currency = typeof invoice.currency === "string" ? invoice.currency : "USD";
  const taxBasisPoints = parseTaxRate(invoice.taxRate ?? 0);

  const items = invoice.items.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Line item ${index + 1} must be an object.`);
    }

    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`Line item ${index + 1} quantity must be a positive integer.`);
    }

    const unitCents = parseMoneyToCents(item.unitPrice);
    if (unitCents < 0) {
      throw new Error(`Line item ${index + 1} unitPrice must be non-negative.`);
    }

    return {
      label: typeof item.label === "string" && item.label.trim() ? item.label : `Item ${index + 1}`,
      quantity,
      unitCents,
    };
  });

  return {
    currency,
    taxBasisPoints,
    items,
  };
}

export function buildInvoiceProgram(source) {
  const invoice = parseInvoice(source);
  return [
    `INVOICE items=${invoice.items.length} tax_bp=${invoice.taxBasisPoints}`,
    "FOR_EACH_ITEM READ_ITEM LINE_TOTAL ADD_SUBTOTAL",
    "APPLY_TAX EMIT_TOTAL HALT",
  ];
}

export function createEmptyInvoiceSnapshot() {
  return {
    processedItems: 0,
    subtotalCents: 0,
    taxCents: 0,
    totalCents: 0,
  };
}

export function buildInvoiceOpContext(invoice, snapshot, historyOps) {
  return [
    `currency_${invoice.currency}`,
    `items_${invoice.items.length}`,
    `taxbp_${invoice.taxBasisPoints}`,
    `processed_${snapshot.processedItems}`,
    `subtotal_${snapshot.subtotalCents}`,
    `tax_${snapshot.taxCents}`,
    `total_${snapshot.totalCents}`,
    "history",
    ...(historyOps.length > 0 ? historyOps : ["NONE"]),
  ].join(" ");
}

export function createInvoiceExecutionState() {
  return {
    currentItemIndex: 0,
    currentLineCents: null,
    phase: "READ_ITEM",
    halted: false,
    processedItems: 0,
    subtotalCents: 0,
    taxCents: 0,
    totalCents: 0,
  };
}

function snapshotFromState(state) {
  return {
    processedItems: state.processedItems,
    subtotalCents: state.subtotalCents,
    taxCents: state.taxCents,
    totalCents: state.totalCents,
  };
}

function finalizeEvent(event, state) {
  return {
    ...event,
    snapshot: snapshotFromState(state),
  };
}

function createEvent(op, fields = {}) {
  return {
    op,
    ...fields,
  };
}

function emitEvent(trace, event, onEvent) {
  trace.push(event);

  if (onEvent) {
    const { snapshot, ...fields } = event;
    onEvent(fields, snapshot);
  }
}

export function getInvoiceLegalOps(invoice, state) {
  if (state.halted) {
    return [];
  }

  if (state.currentItemIndex < invoice.items.length) {
    return [state.phase];
  }

  if (state.phase === "APPLY_TAX" || state.phase === "EMIT_TOTAL" || state.phase === "HALT") {
    return [state.phase];
  }

  return [];
}

export function executeInvoiceOp(invoice, previousState, op) {
  const legalOps = getInvoiceLegalOps(invoice, previousState);
  if (!legalOps.includes(op)) {
    throw new Error(
      `Illegal invoice op ${op}. Expected ${legalOps.length > 0 ? legalOps.join(", ") : "no legal ops"}.`,
    );
  }

  const state = {
    currentItemIndex: previousState.currentItemIndex,
    currentLineCents: previousState.currentLineCents,
    phase: previousState.phase,
    halted: previousState.halted,
    processedItems: previousState.processedItems,
    subtotalCents: previousState.subtotalCents,
    taxCents: previousState.taxCents,
    totalCents: previousState.totalCents,
  };

  switch (op) {
    case "READ_ITEM": {
      const item = invoice.items[state.currentItemIndex];
      state.phase = "LINE_TOTAL";
      return {
        state,
        event: finalizeEvent(
          createEvent("READ_ITEM", {
            index: state.currentItemIndex,
            label: item.label,
            quantity: item.quantity,
            unitCents: item.unitCents,
          }),
          state,
        ),
      };
    }
    case "LINE_TOTAL": {
      const item = invoice.items[state.currentItemIndex];
      state.currentLineCents = item.quantity * item.unitCents;
      state.phase = "ADD_SUBTOTAL";
      return {
        state,
        event: finalizeEvent(
          createEvent("LINE_TOTAL", {
            index: state.currentItemIndex,
            quantity: item.quantity,
            unitCents: item.unitCents,
            lineCents: state.currentLineCents,
          }),
          state,
        ),
      };
    }
    case "ADD_SUBTOTAL": {
      if (typeof state.currentLineCents !== "number") {
        throw new Error("ADD_SUBTOTAL requires a computed line total.");
      }

      const index = state.currentItemIndex;
      state.subtotalCents += state.currentLineCents;
      state.processedItems += 1;
      state.currentItemIndex += 1;
      state.currentLineCents = null;
      state.phase =
        state.currentItemIndex < invoice.items.length ? "READ_ITEM" : "APPLY_TAX";
      return {
        state,
        event: finalizeEvent(
          createEvent("ADD_SUBTOTAL", {
            index,
            subtotalCents: state.subtotalCents,
          }),
          state,
        ),
      };
    }
    case "APPLY_TAX": {
      state.taxCents = Math.round((state.subtotalCents * invoice.taxBasisPoints) / 10000);
      state.totalCents = state.subtotalCents + state.taxCents;
      state.phase = "EMIT_TOTAL";
      return {
        state,
        event: finalizeEvent(
          createEvent("APPLY_TAX", {
            taxCents: state.taxCents,
            totalCents: state.totalCents,
          }),
          state,
        ),
      };
    }
    case "EMIT_TOTAL": {
      state.phase = "HALT";
      return {
        state,
        event: finalizeEvent(
          createEvent("EMIT_TOTAL", {
            subtotalCents: state.subtotalCents,
            taxCents: state.taxCents,
            totalCents: state.totalCents,
          }),
          state,
        ),
      };
    }
    case "HALT": {
      state.halted = true;
      return {
        state,
        event: finalizeEvent(createEvent("HALT"), state),
      };
    }
    default:
      throw new Error(`Unsupported invoice op: ${op}`);
  }
}

export function formatCents(cents, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatInvoiceEvent(event, currency = "USD") {
  switch (event.op) {
    case "READ_ITEM":
      return `READ_ITEM #${event.index + 1} ${event.label}`;
    case "LINE_TOTAL":
      return `LINE_TOTAL #${event.index + 1} ${event.quantity} x ${formatCents(event.unitCents, currency)} -> ${formatCents(event.lineCents, currency)}`;
    case "ADD_SUBTOTAL":
      return `ADD_SUBTOTAL -> ${formatCents(event.subtotalCents, currency)}`;
    case "APPLY_TAX":
      return `APPLY_TAX -> ${formatCents(event.taxCents, currency)} (total ${formatCents(event.totalCents, currency)})`;
    case "EMIT_TOTAL":
      return `EMIT_TOTAL subtotal=${formatCents(event.subtotalCents, currency)} tax=${formatCents(event.taxCents, currency)} total=${formatCents(event.totalCents, currency)}`;
    case "HALT":
      return "HALT";
    default:
      return event.op;
  }
}

export function runInvoicePsvm(source, options = {}) {
  const { onEvent } = options;
  const invoice = parseInvoice(source);
  const trace = [];
  let state = createInvoiceExecutionState();

  while (!state.halted) {
    const [op] = getInvoiceLegalOps(invoice, state);
    if (!op) {
      throw new Error("Invoice PSVM reached a state with no legal ops before HALT.");
    }

    const step = executeInvoiceOp(invoice, state, op);
    state = step.state;
    emitEvent(trace, step.event, onEvent);
  }

  return {
    invoice,
    program: buildInvoiceProgram(source),
    trace,
    result: {
      subtotalCents: state.subtotalCents,
      taxCents: state.taxCents,
      totalCents: state.totalCents,
    },
  };
}

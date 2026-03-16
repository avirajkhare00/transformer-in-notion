# Invoice PSVM

This directory is the first small web-app proof of concept for the
problem-shaped VM idea.

## Current prototype

The implementation lives in:

- `index.html` - standalone browser demo
- `app.mjs` - UI wiring for the invoice page
- `worker.mjs` - worker-side execution loop
- `psvm.mjs` - invoice-calculator PSVM and canonical trace generator

## Why this example matters

Invoice calculation is a better first "real world" example than a large puzzle
because it is:

- exact
- easy to verify
- legible to non-ML users
- small enough for browser-local execution
- naturally expressible as a short canonical trace

## Current op set

- `LOAD_INVOICE`
- `READ_ITEM`
- `PARSE_QTY`
- `PARSE_PRICE`
- `MUL_LINE_TOTAL`
- `ADD_SUBTOTAL`
- `APPLY_TAX`
- `EMIT_TOTAL`
- `HALT`

This is intentionally narrow. The goal is to prove the value of a
task-specific execution substrate before adding a local transformer on top of
it.

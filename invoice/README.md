# Invoice PSVM

This directory is the first small web-app proof of concept for the
problem-shaped VM idea.

## Current prototype

The implementation lives in:

- `index.html` - standalone browser demo
- `app.mjs` - UI wiring for the invoice page
- `worker.mjs` - worker-side execution loop
- `psvm.mjs` - invoice-calculator PSVM and canonical trace generator
- `export_dataset.mjs` - synthetic dataset generator for next-op supervision
- `train_transformer.py` - tiny invoice next-op transformer trainer/exporter

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

## Teacher and student

The current split is:

- `teacher` - the deterministic PSVM in `psvm.mjs`
- `student` - the tiny classifier trained to predict the next PSVM op from context

The first learned target is intentionally small:

- input: normalized execution context
- output: next op in the invoice PSVM

That is not full trace generation yet. It is the first honest learned step.

## Local training flow

Generate a synthetic dataset:

```bash
node invoice/export_dataset.mjs
```

Train the first invoice student model:

```bash
.venv/bin/python invoice/train_transformer.py --skip-export
```

Use `--skip-export` for local smoke tests and training iteration. Drop that flag
when you want the ONNX export under `invoice/models/`.

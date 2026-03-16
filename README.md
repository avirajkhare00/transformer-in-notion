# Transformer in Notion

This repo is a small embeddable demo site for Notion pages.

Version 1 deliberately keeps the stack simple:

- Tic-tac-toe with a visible perfect-play solver trace
- Sudoku with an animated solving trace
- Static files only, so GitHub Pages can host it directly

The current demos are deterministic browser-side solvers, not an ML runtime yet.
That is intentional. The embed story is the point first:

`Notion page -> embed block -> hosted app -> browser runtime`

Once this shape feels right, the solver logic can be replaced with:

- a tiny in-browser model
- a WASM runtime
- or a hybrid model + executor path

## Local development

Serve the repo root with any static file server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Files

- `index.html` - page shell and demo layout
- `styles.css` - visual system tuned for an iframe or Notion embed
- `app.mjs` - UI wiring and animations
- `logic/tictactoe.mjs` - minimax engine
- `logic/sudoku.mjs` - traced backtracking solver

## GitHub Pages

The workflow in `.github/workflows/pages.yml` publishes the repo root as a Pages site.
Once Pages is enabled, the resulting URL can be pasted straight into a Notion embed block.

## Next steps

- Replace one or both solvers with a WASM runtime
- Add a tiny transformer-backed demo with visible token or state traces
- Add puzzle presets and difficulty levels
- Add a tighter mobile/embed height mode for narrower Notion columns

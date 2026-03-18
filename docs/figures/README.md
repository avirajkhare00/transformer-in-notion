# Figure Pipeline

This paper uses generated figures instead of hand-positioned TikZ layouts.

Tools:

- `d2` for system and pipeline diagrams
- `dot` / Graphviz for ranked flow diagrams
- `octave-cli` with `gnuplot` for benchmark charts

Source files live in [src](./src).
Rendered assets are written to [out](./out).

Regenerate everything with:

```bash
./docs/figures/render.sh
```

The paper includes the generated PDF assets from `docs/figures/out/`.

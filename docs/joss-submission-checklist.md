# JOSS Submission Checklist

## Paper package

- [x] JOSS paper source at [paper.md](/Users/avirajkhare/hack2/transformers/transformer-in-notion/paper.md)
- [x] bibliography at [paper.bib](/Users/avirajkhare/hack2/transformers/transformer-in-notion/paper.bib)
- [x] generated JOSS paper PDF at [paper.pdf](/Users/avirajkhare/hack2/transformers/transformer-in-notion/paper.pdf)
- [x] software-focused framing rather than a pure theory framing
- [x] AI usage disclosure included

## Repository basics

- [x] open-source license in [LICENSE](/Users/avirajkhare/hack2/transformers/transformer-in-notion/LICENSE)
- [x] public repository with runnable demos
- [x] top-level README
- [x] dedicated [CITATION.cff](/Users/avirajkhare/hack2/transformers/transformer-in-notion/CITATION.cff)
- [x] short citation section in [README.md](/Users/avirajkhare/hack2/transformers/transformer-in-notion/README.md)
- [x] multiple working examples: Sudoku, invoice, Tally, Weiqi

## Still worth tightening before JOSS submission

- [x] add explicit versioned release for the submission artifact
- [x] archive the release with Zenodo DOI `10.5281/zenodo.19087723`
- [ ] verify installation instructions from a clean machine
- [ ] make sure at least one minimal automated smoke path is documented end to end
- [ ] consider a short architecture figure for the JOSS paper README and docs
- [x] replace placeholder version/date values after the submission release changed

## Framing guidance

The JOSS paper should sell this repository as:

- software
- AI
- systems
- artifact

It should not try to prove the entire research thesis inside the JOSS paper.
That broader argument belongs in the arXiv paper:

- [paper-idea-problem-shaped-vms.md](/Users/avirajkhare/hack2/transformers/transformer-in-notion/docs/paper-idea-problem-shaped-vms.md)

## Suggested software citation keys

- repository / software artifact: `@khare2026trl`
- broad research paper / preprint: `@khare2026paper`

## Immediate next steps

1. run a clean-start install check
2. document a minimal automated smoke path
3. do one final prose pass after the release metadata is frozen
4. submit the JOSS paper using the archived release and DOI

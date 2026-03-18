# JOSS Submission Checklist

## Current status

- submitted to JOSS on 18 March 2026
- rejected at pre-review in `openjournals/joss-reviews#10227`
- immediate blocker: repository public-development history was too new for
  JOSS's scope/significance expectations
- paper issue also noted: missing `Research impact statement` section, now fixed
- practical next window: re-evaluate after at least six months of public repo
  history, not before September 2026

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

## Still worth tightening before JOSS resubmission

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

1. keep the repository active in public with releases, issues, and pull requests
2. keep the JOSS paper current with software changes, but do not resubmit yet
3. use the arXiv path for the broader research paper now
4. revisit JOSS only after the repository has a longer public history

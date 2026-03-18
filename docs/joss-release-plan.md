# JOSS Release and Tag Plan

## Goal

Create a stable, citable software artifact for the JOSS submission.

## Current archival release

- release version: `v0.1.1`
- release title: `Transformer Runtime Lab v0.1.1`
- Zenodo DOI: `10.5281/zenodo.19087723`
- release purpose: first Zenodo-backed archival release for the JOSS submission

## Why a release is needed

JOSS evaluates a specific software artifact, not only a moving repository head.
The submission package should therefore point to:

- a fixed git tag
- a GitHub release
- an archived release with a DOI

## Recommended sequence

1. Make sure `main` contains the final submission files:
   - [paper.md](/Users/avirajkhare/hack2/transformers/transformer-in-notion/paper.md)
   - [paper.bib](/Users/avirajkhare/hack2/transformers/transformer-in-notion/paper.bib)
   - [paper.pdf](/Users/avirajkhare/hack2/transformers/transformer-in-notion/paper.pdf)
   - [CITATION.cff](/Users/avirajkhare/hack2/transformers/transformer-in-notion/CITATION.cff)
2. Tag the release:

```bash
git tag -a v0.1.1 -m "Zenodo-ready archival release"
git push origin v0.1.1
```

3. Create the GitHub release from that tag.
4. Archive the tagged release with Zenodo or Figshare to mint a DOI.
5. If a DOI is minted, update:
   - [CITATION.cff](/Users/avirajkhare/hack2/transformers/transformer-in-notion/CITATION.cff)
   - [paper.bib](/Users/avirajkhare/hack2/transformers/transformer-in-notion/paper.bib)
   - [paper.md](/Users/avirajkhare/hack2/transformers/transformer-in-notion/paper.md)
6. Regenerate [paper.pdf](/Users/avirajkhare/hack2/transformers/transformer-in-notion/paper.pdf) if metadata changes.

Zenodo-specific setup notes are in
[zenodo-archival-guide.md](/Users/avirajkhare/hack2/transformers/transformer-in-notion/docs/zenodo-archival-guide.md).

## Suggested release description

The current archival release is:

> Transformer Runtime Lab v0.1.1
>
> Zenodo DOI: 10.5281/zenodo.19087723

Earlier wording for the first software submission release was:

> First software release for JOSS submission. This release freezes the
> repository state for the `Transformer Runtime Lab` software paper and the
> browser-local PSVM demos for Sudoku, invoice total extraction, Tally-style
> voucher extraction, and Weiqi.

## Metadata to verify before tagging

- author name: `Aviraj Khare`
- affiliation: `Independent Researcher, Satna, Madhya Pradesh, India`
- citation key for software artifact: `@khare2026trl`
- citation key for broad research paper: `@khare2026paper`

## Not in scope for the release tag itself

- changing the broad research-paper thesis
- rewriting the arXiv paper substantially
- adding new demos or major features

Freeze the software artifact first. Expand the broader paper afterward if
needed.

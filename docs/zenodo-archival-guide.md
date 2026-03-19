# Zenodo Archival Guide

## Purpose

This repository is now prepared for Zenodo GitHub archiving with:

- [CITATION.cff](/Users/avirajkhare/hack2/transformers/transformer-in-notion/CITATION.cff)
- [.zenodo.json](/Users/avirajkhare/hack2/transformers/transformer-in-notion/.zenodo.json)

## Current status

The repository is prepared for Zenodo archiving, but no accepted Zenodo record
should be cited from this repository right now:

- release: `v0.1.1`
- archival DOI: not assigned
- record: none yet

## Recommended flow

1. Keep the GitHub repository enabled in Zenodo for future releases.
2. For the next software archive, create a new GitHub release tag.
3. Wait for Zenodo to archive the new release.
4. Patch the new DOI back into:
   - `CITATION.cff`
   - `paper.bib`
   - `paper.md`
   - `paper.pdf`

## Historical note for this repository

`v0.1.0` was created before the Zenodo metadata file existed in the tagged
state. That is why the first archival release is `v0.1.1`, not `v0.1.0`.

## Why both metadata files exist

- `CITATION.cff` is for GitHub and human/software citation flows
- `.zenodo.json` is the Zenodo-specific metadata override for archival releases

## Suggested next release purpose

Next archival update after JOSS submission or after major artifact changes.

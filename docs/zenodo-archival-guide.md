# Zenodo Archival Guide

## Purpose

This repository is now prepared for Zenodo GitHub archiving with:

- [CITATION.cff](/Users/avirajkhare/hack2/transformers/transformer-in-notion/CITATION.cff)
- [.zenodo.json](/Users/avirajkhare/hack2/transformers/transformer-in-notion/.zenodo.json)

## What still requires manual action

Zenodo DOI minting cannot be completed from the repository alone. It requires:

1. signing in to Zenodo with your own account
2. connecting GitHub to Zenodo
3. enabling this repository inside Zenodo's GitHub integration view

## Recommended flow

1. Log in to Zenodo.
2. Open the GitHub integration page.
3. Sync repositories and enable `avirajkhare00/transformer-in-notion`.
4. After the repository is enabled, create the next point release from GitHub.

## Important note for this repository

`v0.1.0` was created before the Zenodo metadata file existed in the tagged
state. The cleanest path for DOI minting is therefore:

- enable the repository in Zenodo first
- then create a new release, for example `v0.1.1`

That next release will include:

- `.zenodo.json`
- `CITATION.cff`
- `paper.md`
- `paper.pdf`
- the JOSS and arXiv submission docs

## Why both metadata files exist

- `CITATION.cff` is for GitHub and human/software citation flows
- `.zenodo.json` is the Zenodo-specific metadata override for archival releases

## Suggested next release title

`Transformer Runtime Lab v0.1.1`

## Suggested next release purpose

First Zenodo-backed archival release for the JOSS software artifact.

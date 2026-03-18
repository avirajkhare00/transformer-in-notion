---
title: "Transformer Runtime Lab: Browser-local exact execution with problem-shaped virtual machines"
tags:
  - JavaScript
  - Python
  - WebAssembly
  - transformers
  - exact search
  - document extraction
  - browser computing
authors:
  - name: Aviraj Khare
    corresponding: true
    affiliation: 1
affiliations:
  - name: Independent Researcher, Satna, Madhya Pradesh, India
    index: 1
date: 18 March 2026
bibliography: paper.bib
---

# Summary

`Transformer Runtime Lab` is an open-source software and systems artifact for
exact, verifier-backed local AI execution over problem-shaped virtual machines
(PSVMs) [@khare2026trl]. The repository packages exact runtimes, browser
workers, local model loaders, training and export scripts, and interactive
demos for narrow exact tasks that benefit from learned guidance but cannot
tolerate free-form hallucination. The current artifact includes browser-local
stacks for Sudoku, invoice total extraction, Tally-style voucher extraction,
and a smaller Weiqi prototype.

The software demonstrates one recurring pattern: the exact runtime remains the
source of truth, while the local model only scores ambiguity. In Sudoku, the
model ranks legal branch decisions while the exact solver owns candidate
generation, contradiction detection, and backtracking. In invoice and Tally
extraction, the runtime enumerates legal money or field candidates before the
model ranks them and a deterministic emitter or resolver produces the final
structured output. The result is a reusable artifact for browser-local,
verifier-backed AI systems rather than a set of unrelated demos.

# Statement of need

There is a gap between two common styles of research software for exact tasks.
At one extreme are symbolic tools and exact solvers such as OR-Tools
[@ortools], which preserve correctness but are not typically packaged as
browser-local, model-guided, inspectable execution artifacts. At the other
extreme are local inference runtimes such as Transformers.js [@transformersjs]
and ONNX Runtime [@onnxruntime], which make browser inference practical but do
not define task-specific state machines, verifiers, or canonical traces. Work
on local AI for exact tasks, structured extraction, and hybrid
symbolic-neural systems often needs both pieces at once: an exact runtime and a
small local model that can guide ambiguous decisions without replacing exact
semantics.

`Transformer Runtime Lab` was built to fill that gap. It gives researchers and
engineers a single artifact in which the runtime, model interface, browser
deployment, and training or export path can all be inspected together. This is
useful for reproducible demonstration because it keeps the relation between
model behavior and exact semantics explicit instead of hiding it inside a
larger application stack or a remote inference service.

# State of the field

Several adjacent software ecosystems cover parts of this problem space, but not
the full combination implemented here. OR-Tools [@ortools] and PySAT [@pysat]
provide exact search and constraint-solving capabilities, but they are not
organized as browser-local PSVM artifacts with integrated learned branch
ranking. Browser ML runtimes such as Transformers.js [@transformersjs] and ONNX
Runtime [@onnxruntime] make local inference practical, but they do not provide
exact task runtimes, rollback semantics, or domain-specific legal action
surfaces. For document understanding, toolkits such as LayoutParser
[@layoutparser] support OCR- and layout-centric pipelines, but they are not
built around verifier-backed candidate surfaces and deterministic execution
contracts in the way the invoice and Tally PSVMs are.

This repository was built rather than folded into one of those projects because
its core contribution is the combination of these concerns: exact runtimes,
task-shaped legal action surfaces, browser-local model workers, and
implementation paths that remain inspectable end to end. The software also
intentionally spans more than one task family. Sudoku demonstrates search and
backtracking; invoice extraction demonstrates candidate ranking over legal money
values; Tally extraction extends that pattern to voucher-family classification,
schema-aligned field candidates, and deterministic post-ranking resolution.

# Software design

The central architectural unit is the PSVM. A PSVM is the smallest executable
substrate whose legal actions still match the true state transitions of a task
family. In this software, each domain provides an exact runtime that owns
legality, canonicalization, and execution. Learned components are attached only
at the narrow points where ambiguity exists.

Across domains the repository follows the same execution pattern:

`task instance -> exact state -> legal action or candidate frontier -> local model scores ambiguity -> exact runtime verifies and applies -> new state`

This leads to three design choices. First, the exact runtime stays
authoritative. For Sudoku, the runtime owns candidate generation,
contradictions, and backtracking. For invoice and Tally extraction, the runtime
enumerates legal candidates before any model score is consulted. Second, traces
and candidate sets are canonicalized in deterministic code so that the model
sees stable targets. Third, browser-local execution is a first-class deployment
target. The repository includes worker-based inference paths, optional
WebAssembly execution for exact runtimes, and public demos that make the
model-runtime split visible instead of hiding it behind a server.

This software matters as a research artifact because it makes the PSVM pattern
reproducible across more than one domain. Rather than claiming that local
models replace exact code, it provides a concrete stack in which exact code
owns truth and the model handles ambiguity. That makes the repository useful
for future work on local exact AI, hybrid symbolic-neural execution, structured
decoding with verification, and human-interpretable model guidance
[@khare2026paper].

# AI usage disclosure

Generative AI tools were used during parts of the software development,
documentation writing, and paper drafting process. All code paths,
implementation references, and submission materials were manually reviewed by
the author against the repository before inclusion. The author is responsible
for the final software behavior, technical claims, and wording of this
manuscript.

# References

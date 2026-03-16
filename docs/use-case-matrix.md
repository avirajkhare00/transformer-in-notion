# Use-Case Matrix

This project is not just "put a model in Notion." The more useful framing is:

`UI shell + reasoning layer + exact runtime + verifier`

Different combinations of those parts are good at different classes of problems.
The table below is meant to answer one practical question:

**What small real-world task should live in which stack shape?**

## Architecture matrix

| Stack | What it does well | Small real-world use case | Why it fits | Main risk |
| --- | --- | --- | --- | --- |
| `Tiny model only` | Fast local classification or move selection | Inbox triage for `reply / defer / archive` | Small output space, instant browser inference | Brittle outside the training distribution |
| `WASM executor only` | Exact deterministic computation with visible state | Split a group expense sheet and prove the math | Cheap, exact, easy to verify | No language understanding |
| `LLM only` | Ambiguous language cleanup and drafting | Rewrite rough meeting notes into action items | Good when the answer is fuzzy rather than exact | Hallucinates on exact steps |
| `LLM + tool calling` | Language in, structured external action out | Natural-language SQL over a small database | LLM plans, tool executes | Tool errors become the system bottleneck |
| `LLM + WASM executor` | Natural-language front end over exact local computation | "Find my best 30-minute meeting slot this week" | Parse with LLM, solve locally and transparently | Parsing mistakes at the front door |
| `Tiny model + verifier` | Cheap local guess plus exact acceptance check | OCR-like digit entry for receipts with checksum validation | Fast and trustworthy if verifier is strong | Model may still miss edge cases |
| `Tiny model + WASM executor` | Fast heuristic proposal with exact rollout | 24 Game or small route-finding with local search | Model narrows the branch space, executor proves it | Harder to explain if the model is weak |
| `LLM + tiny model` | Natural-language control over a small local policy | "Play the strongest reply from this board" | LLM handles framing, model handles fast choice | Split responsibility can feel arbitrary |
| `LLM + tool + verifier` | High-trust workflows that must be checked | Draft a reimbursement claim and validate totals, dates, and limits | Good for paperwork-style tasks | More moving parts than a mini demo needs |
| `LLM + model + WASM executor` | Reasoning, routing, and exact local execution in one loop | Tiny DSL authoring: describe a workflow, compile, run, trace | Closest to the "transformer as computer" story | Highest implementation complexity |
| `LLM + model + tool + verifier` | Rich assistants that still need hard guardrails | Support copilot that drafts, classifies, calls APIs, and checks policy | Strong product path outside demos | Too large for a first Notion-native showcase |

## Small real-world use cases

These are the best candidates if the goal is a **small, legible, embeddable** demo rather than a full product.

| Use case | Best stack | Input | Output | Why it is compelling in a Notion embed |
| --- | --- | --- | --- | --- |
| Expense split checker | `WASM executor only` | Names, amounts, who paid | Net balances + settlement plan | Everyone understands the result instantly |
| Meeting slot finder | `LLM + WASM executor` | Natural-language constraints + calendars | Ranked feasible slots | Feels useful immediately and stays exact |
| Unit/budget planner | `LLM + tool + verifier` | "Can I do this under $200?" | Parsed plan + checked totals | Great for visible tool-call traces |
| Tiny invoice auditor | `WASM executor only` or `LLM + verifier` | Line items, tax rules, totals | Mismatch report | Exactness matters and errors are obvious |
| Mini shipping planner | `LLM + WASM executor` | Box sizes, weight, destination rules | Cheapest valid packing option | Nice constraint-solving story |
| Formula or DSL runner | `LLM + model + WASM executor` | Short program or natural-language description | Program, stack trace, result | Closest to Percepta-style execution |
| Support note router | `Tiny model only` | Short internal note | Team / priority / action tag | Tiny local model is enough |
| Receipt field validator | `Tiny model + verifier` | Parsed merchant/date/total fields | Accepted fields + flagged conflicts | Model suggests, verifier guards |
| Checklist planner | `LLM only` or `LLM + verifier` | Messy task notes | Ordered checklist | Good if the user wants help, not proof |
| Travel allowance checker | `LLM + tool + verifier` | Policy text + spend items | Allowed / denied / needs review | Real and legible without huge scope |
| Room layout / seating toy planner | `Tiny model + WASM executor` | Small constraints | Valid arrangement + trace | Nice visual search example |
| Local tax or tip calculator | `WASM executor only` | Amount, jurisdiction, rounding rules | Exact totals | Clean and boring in the best way |

## Best next examples for this repo

If the goal is to showcase the combinations, these are the strongest next demos in order:

| Priority | Example | Stack | Why now |
| --- | --- | --- | --- |
| `1` | Tiny stack-machine DSL | `model + executor` | Best bridge from puzzle demos to real computation |
| `2` | Expense split checker | `WASM executor` | Real-world, exact, easy to trust |
| `3` | Meeting slot finder | `LLM + executor` | Real language front-end with exact solving |
| `4` | Receipt or invoice validator | `model + verifier` | Small model plus correctness guardrail |
| `5` | Travel allowance / policy checker | `LLM + tool + verifier` | Strong paperwork demo with visible tool flow |

## What not to force early

| Idea | Why not first |
| --- | --- |
| Full chess | Search, legality, and trust requirements jump too fast |
| Open-ended coding assistant | Hard to verify in a tiny embed |
| Large RAG demo | Looks like everyone else's AI widget |
| Generic chatbot | Weakest possible proof of "computation in Notion" |
| Hard 9x9 model-only Sudoku | Great headline, poor first reliability target |

## Simple rule of thumb

- If the task is fuzzy, start with an `LLM`.
- If the task must be exact, add an `executor` or `verifier`.
- If the output space is small and fixed, a `tiny local model` is often enough.
- If the user speaks in messy language but the answer must still be exact, use `LLM + executor`.
- If the goal is to make the "transformer as computer" argument tangible, build a `DSL + trace` demo.

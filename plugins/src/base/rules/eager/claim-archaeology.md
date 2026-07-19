# Claim-Time Archaeology (load-bearing)

Lisa lifecycles are one-way — a done issue never reopens, so a residual failure comes back as a **new** issue with no visible link to the issue that shipped it. Archaeology recovers that link at claim time: the claiming agent learns it is working on round 2 of a past failure, and what specifically went wrong the first time.

**One vendor-neutral contract, cited by every build-intake arm** (the `leaf-only-lifecycle` / `repo-scope-split` / `rejection-detection` precedent: one shared slug, never three divergent implementations).

## When it runs

In build-intake step 3b, **AFTER the rejection-detection classification and BEFORE the relabel/transition** `$READY → $CLAIMED`. Rejection detection runs first; its classification is an **input** to archaeology — a detected `rejection-reclaim` passes straight through, never re-derived.

## Classify the claimed item

Return exactly one of:

- **`rejection-reclaim`** — taken directly from the `rejection-detection` result. Reuse it; do not re-derive.
- **`retry-of-done-issue`** — an ancestry signal names a closed done issue whose shipped work this issue exists to fix.
- **`fresh`** — no ancestor found, signals weak/inconclusive, budget exhausted, or the pass errored. The default and the safe degrade.

## Ancestry signals (summary — full bindings in the reference body)

1. **Tracker metadata** — the typed relations the read skills already parse (Blocks / Blocked by / Relates to / Duplicates / Cloned from, `closingIssuesReferences`, cross-references).
2. **Text similarity** — tracker search primitives over recently-closed issues touching the same implicated files, ranked by title/label overlap. Lexical only; no embedding machinery exists.
3. **Git ancestry** — deterministic `git log --follow` / `git blame` / merge-commit queries yielding a parseable `{file, sha, pr, date}` result. Never delegate this to the prose-report `git-history-analyzer` agent.

## Learning-loop exclusion (scan-side)

An artifact this flow produced is **never** an ancestor. Exclude anything carrying `[lisa-learning-drop]`, `[lisa-learning-pr]`, `[lisa-learning-upstream-handoff]`, `[lisa-rejection-candidate]`, or `[lisa-archaeology-candidate]` markers, or the `learning:needs-triage` label.

## Cost budget — never block the claim

The pass runs inside a hard budget: `.lisa.config.json` `archaeology.maxSteps` (default **8** tracker/git queries; optional `archaeology.maxSeconds`). Budget exhausted, weak signals, or an exception → classify `fresh` and proceed. Archaeology is a bonus layered on the claim; it **never blocks the claim**. Exceeding the budget degrades to `fresh` — a normal outcome, not an error.

## On `retry-of-done-issue`

Reconstruct what the ancestor's PR shipped (merged PR, review threads, evidence comments) and derive **ONE** candidate learning citing the **delta** between what was done and what this issue proves was needed — routed to `lisa-persist-learning` exactly like the rejection-reflection path. Fallback when that skill is absent: a comment with a visible prose line plus `<!-- [lisa-archaeology-candidate] key=<issue>-<ancestor> -->` (marker-dedupe; re-claims produce no duplicate). `fresh` → no candidate, zero comments.

Full contract (signal bindings, classification table, candidate derivation, budget mechanics): [reference/claim-archaeology.md](../reference/claim-archaeology.md).

# Demo project — Lisa dogfoods the state-classification gate

Lisa holds no persistent state of its own, so there is nothing here to classify. This directory is a
small worked example standing in for an adopter repo, so the **shipped** mechanism — the
copy-overwrite `check-state-classification.mjs` plus the `🧬 State Classification` job in the
reusable quality workflow — runs on Lisa's own pull requests instead of only downstream. Without it,
a regression in the gate would ship silently and be discovered by an adopter.

`scripts/check-state-classification.mjs` at the repository root points the check here.

The example deliberately spans all four policies and includes state that is not rows:

| Entity | Kind | Policy |
|---|---|---|
| `app.notes` | table | `fixture-owned` (ownership predicate + sweep) |
| `app.catalog_items` | table | `preserve` |
| `analytics.item_rollup` | materialized view | `derived-rebuild` |
| `ledger.payments` | table | `forbidden` (grant revoked, not merely unused) |
| `identity://user-pool/e2e-personas` | identity group | `fixture-owned` |
| `object-store://uploads/e2e/` | object prefix | `fixture-owned` |

Adding an entity to `state/inventory.json` without classifying it, or classifying one `fixture-owned`
without a `sweptBy` routine, turns this job red. That is the whole point: the failure arrives on the
pull request that introduces the gap, not months later as an unreproducible flake.

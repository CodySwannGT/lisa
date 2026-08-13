# Decision: Ratchet Policy — Absolute Floors, No Generic Creep

Date: 2026-08-12

Status: Accepted

Covers decisions **D2** and **D5** of `plans/improvement-notes-implementation.md`
(work units H, G part 2, and the closure of improvement-note item 14).

## Context

A working-session note proposed: *"Do not build ratchets. Fix all problems and prevent
re-occurrence with lint rules and other deterministic checks."*

This conflicts with shipped Lisa behavior. Lisa ships several ratchet families:

- BDD `coverageFloor` plus a `coverageFloorBaseline` approval path (a floor may only
  be lowered with a record naming platform/from/to/reason/ticket/approvedBy/runUrl
  **and** a maintainer-applied `bdd-floor-baseline` PR label).
- The `coverage` family in `threshold-ratchet-families.mjs` (`vitest`/`jest`
  thresholds, direction `min`).
- Stryker `thresholds.break` and the mutate-list.
- The `check-threshold-ratchet.mjs` mechanism itself — "thresholds may tighten, never
  weaken" — enforced across three layers (PostToolUse hook exit 2, pre-commit, CI vs
  merge-base), with lowering permitted only via a `thresholdRatchet.allow` entry
  merged from the baseline side.

Brownfield onboarding depends on ratchets: a red project adopts incrementally instead
of being blocked until fully remediated.

The 2026-08-12 fleet audit supplied evidence on both sides.

**Against generic creep.** The creeping ratchets generate real churn with little
signal: propswap moved `maxLinesPerFunction` from 700 to 672 across **14 separate
PRs**, including a duplicate-work collision where two PRs both did "686 to 684";
tunnlai has 128 commits touching budgets/ratchets in a breach → raise-to-unblock →
ratify-with-measurement → correct-the-stale-note cycle; geminisportsai has ~12
commits that only move a debt counter, one re-baseline committed twice.

**For deterministic replacement.** propswap `44891559` already executed the note's
philosophy unprompted: it retired a locally-built ratchet and generated seal-ledger
and re-homed the invariants into a local ESLint plugin plus an ast-grep rule, leaving
hand-maintained allowlists that "may shrink to zero." That is the pattern working in
the field.

**Against naive removal.** No downstream adopter has any `coverageFloor` at all — the
BDD floor and its baseline ratchet exist only in Lisa's template today, because the
fleet runs a pre-ratchet gate. So "remove the ratchet" is not the live question for
BDD; *first-time floor adoption* is.

## Decision

**Absolute floors stay. Generic "creep the number upward" machinery is removed only
where a named deterministic non-regression invariant replaces it, family by family,
with a brownfield migration defined first.**

Concretely:

1. **Keep as gates:** coverage minimums, the Stryker mutation break threshold, and any
   other absolute floor that answers "is this below the bar right now."
2. **Remove, per family, only with a replacement.** Deleting a ratchet also deletes
   the non-regression property it was providing. A family may lose its ratchet only
   when a deterministic invariant covers that property — for BDD, that an accepted
   mapping cannot disappear unless its scenario is validly retired, and that every new
   frontend behavior is mapped or waived.
3. **Sequence is load-bearing.** Replacement invariant lands → `thresholdRatchet.allow`
   entry merged → mechanism changed. Never the reverse. The threshold-ratchet checker
   is a Chesterton's fence guarding against agents granting themselves exceptions in
   the same change that weakens a gate; it is not to be relaxed casually.
4. **Prefer promotion over accumulation.** The propswap precedent is the preferred
   end-state: an invariant expressed as a lint or ast-grep rule with a shrink-to-zero
   allowlist beats a number that a PR nudges every week.
5. **Brownfield migration is part of the decision, not a follow-up.** For every family
   that changes, define what a mid-adoption project's floor and burndown become. For
   BDD specifically this means defining *first-time* floor adoption through the fleet
   gate resync, since no adopter has a floor today.

### D5: mutation and property testing stay as-is

No new implement/verify checkpoint. Current behavior is correct and stays:

- `fast-check` is **forced** on governed TypeScript projects (`package.lisa.json`
  `force.devDependencies`) — the library is always present.
- The mutation gate (Stryker via `mutation.gate.json`, Rails `mutation.gate.yml`) is
  **opt-in and configurable**, with a health check flagging "disabled without a
  justification."
- The `mutation-testing` skill is **on-demand**, AI-guided over changed files.

Making property tests or mutation runs mandatory on every ticket would be a new
requirement with a real time cost and no evidence of a gap it closes. Revisit only if
verify outcomes show one.

One related practice **is** adopted, from tunnlai's backend rules, because it is cheap
and catches a real failure mode: **a guard must be mutation-proven** — introduce the
exact regression the guard exists to prevent, verify exactly one test fails, revert.
It was born from a guard that pinned one field and let the regression through with all
50 tests green. This lands as an eager rule or guard-authoring step (work unit B/N),
not as a gate.

## Alternatives Considered

- **Kill all ratchets now.** Rejected: it silently removes non-regression protection
  from families that have no replacement, and it would make previously gained coverage
  free to lose. The note's intent (stop managing debt by nudging numbers) is honored by
  the replacement requirement, not by deletion.
- **Keep everything, treat the note as host-project policy only.** Rejected: the fleet
  churn evidence is strong enough that generic creep should not be Lisa's default
  posture. Doing nothing upstream leaves every project re-deriving propswap's fix.
- **Freeze each floor at its current value.** Rejected as a general answer: for BDD it
  permits later loss of accepted coverage, and a fixed 100% floor instead requires full
  behavior backfill before the first frontend change. Neither is acceptable as a blanket
  rule, which is why the replacement invariant is required per family.

## Consequences

- Work unit H proceeds as: inventory families → ship replacement invariant → allow
  entry → remove the creep mechanism → update health checks, bootstrap docs, and
  tests.
- Work unit G part 2 (promoting obligation coverage from a `lisa-verify` flow
  obligation into the gate's enforced defect set) is decided by whether H's BDD
  replacement invariant needs it; if not, the plan records that it stays a flow
  obligation.
- No coverage family may become easier to regress accidentally because its ratchet was
  deleted. That is the acceptance test for H.
- Improvement-note item 14 is closed with no Lisa change beyond the mutation-proven-guard
  practice.

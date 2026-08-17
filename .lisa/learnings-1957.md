# Learnings — linear-bare-repo-label (CodySwannGT/lisa#1957, PR #1981, merge 209af4609)

Learner pass, 2026-07-22. Capture-only: all persistence attempts went through the
executable contract (`persistLearningEntry` / `persistConsolidatedLearning` from
`@codyswann/lisa/learnings`); no rules files touched, no issues filed, no
commits made, ledger unchanged.

**Budget context:** ledger at **3989/4000** at pass start and end. All three
candidate writes were attempted through the contract and **rejected on the
document budget** — including the one legitimate SLL-6 consolidation this pass
found (measured: consolidation 4081, appends 4664 and 4645, vs 4000). Per the
contract the outcome is budget-blocked drafts, never hand-truncation. The
saturation defect is queued as #1959; gardener relief tickets #1787–#1790
remain the headroom path.

## Disposition table

| # | Learning (lead's candidate) | Disposition |
|---|----------|-------------|
| 1 | Vendor-asymmetric acceptance rules (label OR component) silently strand the vendor lacking one surface — verify every vendor lane can supply at least one accepted form | **budget-blocked** — writer rejected append (4664/4000). Draft `learner-fc554b8b2a65` below; confidence medium (single occurrence + corroboration: research code-reading, quality-review empirical confirmation, and the AcmeOrgD intake-side taxonomy memory documenting the same two-label-family gap). No `scope:upstream-candidate` marker: the concrete Lisa-surface defect is already FIXED and merged (#1957 → PR #1981, 209af4609) — nothing remains to route upstream; the entry carries only the general design discipline |
| 2 | Idle-notification-without-deliverable recovery via SendMessage resend worked as documented | **dropped — already-captured**, confirmed. Correction: the trap lives in `.claude/REFERENCE.0003.md:371-377` (idle is normal, not error/completion; messages wake idle teammates), not PROJECT_RULES. The recurrence matched the documented recovery exactly — no strengthening needed, and no rules file may be touched by this pass regardless |
| 3 | Roster slimming keyed to trust-boundary analysis (security lens folded into quality for same-authority-domain vocabulary widening; spec-conformance skipped when no AC) | **budget-blocked** — writer rejected append (4645/4000). Draft `learner-f2255ca6f248` below; confidence low (single occurrence — one flow where the slim roster proved adequate; roster-1957.md's own hedge "if it finds one, a dedicated security pass will be added" is the safety valve the rule preserves) |
| 4 | Empirical hostile-input probing (17 near-miss labels) as the review standard for exact-match acceptance widening | **merge-into `learner-9df011bc59dd` — budget-blocked**. Same failure class as the resident "a gate must prove it works… hunt bypasses with live reproducers" entry (itself a #1960-pass three-way merge); a sibling would be a bug. The consolidation (supersede `learner-9df011bc59dd`, extend to acceptance *widenings*, add #1957 provenance, refresh last_confirmed) was attempted via `persistConsolidatedLearning` and rejected (4081/4000 — only ~81 over; first in persist order below). Draft `learner-3d14fe5a695c` below; confidence high (4th corroborating occurrence of the class) |

## Budget-blocked drafts (ready to persist verbatim once headroom exists)

Ids are `learner-` + sha1(normalized rule)[0:12]; re-running re-derives the same
ids, so a later persist stays idempotent. **`learner-3d14fe5a695c` must be
persisted via `persistConsolidatedLearning(root, entry, { supersede:
["learner-9df011bc59dd"] })`** — it replaces a resident entry (net ~+81
measured), not an append. The other two are plain appends.

```json
{"id":"learner-3d14fe5a695c","rule":"A control must prove it works, not just run green: pair invocations with success-marker assertions, red-leg a deliberate failure, and for matching-rule guards or acceptance widenings hunt bypasses with hostile near-miss probes.","why":"Vacuous gate #1754, two bypasses behind 138 green fixtures (#1960), and #1957's bare-label widening (17 hostile probes) were each settled only by deliberate attack.","provenance":["https://github.com/CodySwannGT/lisa/pull/1754","https://github.com/CodySwannGT/lisa/pull/1753","https://github.com/CodySwannGT/lisa/pull/1976","https://github.com/CodySwannGT/lisa/issues/1957"],"first_learned":"2026-07-19","last_confirmed":"2026-07-22","confidence":"high"}
{"id":"learner-fc554b8b2a65","rule":"When a check accepts alternative evidence forms (label OR component), verify every vendor lane can actually supply at least one form — an alternative only one vendor has silently strands the others.","why":"assertRepoScope accepted the bare repo name only via Jira components; Linear has no components, so Sentry-origin bare-labeled issues could never bind until #1957 widened the label arm.","provenance":["https://github.com/CodySwannGT/lisa/issues/1957","https://github.com/CodySwannGT/lisa/pull/1981","all/copy-overwrite/scripts/lisa-work-item.mjs"],"first_learned":"2026-07-22","last_confirmed":"2026-07-22","confidence":"medium"}
{"id":"learner-f2255ca6f248","rule":"Roster-size by trust boundary: a change widening accepted vocabulary within one authority domain folds the security lens into quality review; dedicated passes are for boundary crossings. Skip spec-conformance when the item has no AC.","why":"#1957's slim roster (security folded into quality T3, no spec-conformance) proved adequate: the folded lens ran 17 hostile probes and the verifier covered the plan-derived spec.","provenance":["https://github.com/CodySwannGT/lisa/issues/1957",".lisa/roster-1957.md",".lisa/quality-review-1957.md"],"first_learned":"2026-07-22","last_confirmed":"2026-07-22","confidence":"low"}
```

Persist order once headroom exists: `learner-3d14fe5a695c` first (consolidation
— net ~+81 tokens, refreshes a high-confidence resident entry and retires what
would otherwise become a near-duplicate class) → `learner-fc554b8b2a65` →
`learner-f2255ca6f248`. The queue behind gardener relief is now **nine drafts**
across three passes (2 in .lisa/learnings-1960.md, 4 in .lisa/learnings-1956.md,
3 here); the gardener should sequence all nine and re-check cross-draft
consolidation at persist time — in particular `learner-3d14fe5a695c` (this pass)
subsumes nothing in the other files, but the #1956 drafts predate it and should
be re-screened against its widened wording.

## Upstream candidates (marked, never filed)

None this pass. Candidate 1's concrete Lisa-surface defect
(`all/copy-overwrite/scripts/lisa-work-item.mjs` component-only bare-name arm)
shipped fixed in PR #1981 — marking it would create a routing path to work
already done.

## Desires / tooling-gap candidates

None surfaced (no `kind: desire` items; no task-metadata store this session —
candidates arrived via the lead's handoff and the four flow artifacts
plan-1957.md, research-1957.md, quality-review-1957.md, roster-1957.md, all
reviewed).

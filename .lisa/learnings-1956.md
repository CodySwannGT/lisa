# Learnings — work-item-sync-lanes (CodySwannGT/lisa#1956, PR #1979, merge 8ae55057d)

Learner pass, 2026-07-22. Capture-only: all persistence attempts went through the
executable contract (`persistLearningEntry` from `@codyswann/lisa/learnings`);
no rules files touched, no issues filed, no commits made, ledger unchanged.

**Budget context:** the ledger stood at **3989/4000** bytes at pass start (the
state the #1960 pass left; its consolidations are still uncommitted working-tree
changes). All four candidate appends were attempted through the contract and
**rejected on the document budget** (measured 4626–4718 vs 4000). No legitimate
SLL-6 consolidation remains to free space: the 7 resident entries are distinct
failure classes (the #1960 pass already performed three merges), and folding any
candidate into an unrelated high-confidence entry would dilute, not consolidate.
Per the contract the outcome is budget-blocked drafts — never hand-truncation.
The gardener relief-valve tickets (#1787–#1790) remain the path to headroom.

## Disposition table

| # | Learning (lead's candidate) | Disposition |
|---|----------|-------------|
| 1 | Research-then-verify: T1's AUTO_MERGE "both diffs quiet" discriminator was wrong for untouched-conflict stops; only the fixer's empirical probe caught it | **budget-blocked** — writer rejected append (measured 4626/4000). Draft `learner-3d247953d51d` below; confidence medium (single occurrence + commit-message attestation of the deviation, 15d5ee8fb) |
| 2 | Narrow proof scope missed cross-suite docs-guard: 472/472 green while 6 assertions in tests/unit/strategies failed; full `bun run test` caught it | **deduped with #4, then budget-blocked** — one merged candidate (a near-duplicate sibling pair would be a bug). Writer rejected (4718/4000). Draft `learner-18d90d72b4f7` below; confidence medium (quality review ran the full suite empirically) |
| 3 | Client-side gate relaxations need a server-side backstop inventory per consuming repo class (fix 5 symref surface acceptable only because validate-pr recomputes; Lisa's own CI lacks it → #1978) | **budget-blocked** — writer rejected (4675/4000). Draft `learner-c38678d60c08` below; confidence medium (security F1 live reproducer + #1978 already OPEN — the concrete gap is ticketed, so the entry carries only the general discipline, project scope) |
| 4 | Docs↔code guard tests should pin load-bearing new fragments, not just tolerate new wording | **merged into candidate #2's draft** (same failure class: docs-guard tests vs wording changes; the strengthened pins in implement-env-base-branch.test.ts are the worked pattern) |
| 5 | respond-to-review automation drove CHANGES_REQUESTED → APPROVED on #1979 with replies only, merging past two conceded minors | **evaluated: REAL gap (minor), then budget-blocked** — writer rejected (4635/4000). Draft `learner-333ca3554102` below with `scope:upstream-candidate` (root cause is the Lisa-managed drive-pr-to-merge review-response flow). Confidence low (single occurrence) |

**Candidate 5 evaluation (lead asked):** real gap, not acceptable-as-is. Verified
timeline on #1979: CodeRabbit CHANGES_REQUESTED 22:37:27 → claude reply-only
comments → APPROVED 22:43:30 → merged 22:43:31, zero commits in between. The
investigate-and-justify loop worked exactly as designed for invalid findings —
but the two findings the replies *conceded* as valid-minor (missing mutant
annotations, additional doc-pin suggestions) now exist nowhere except resolved
review threads. Distinguishing justify-and-resolve from concede-and-fix (filing
a follow-up for the latter) is a bounded, real improvement to the
`lisa-drive-pr-to-merge` skill — hence the upstream-candidate marker, gardener
routes it. Severity low: both minors were genuinely non-blocking.

## Budget-blocked drafts (ready to persist verbatim once headroom exists)

Ids are `learner-` + sha1(normalized rule)[0:12] — re-running this pass
re-derives the same ids, so a later persist stays idempotent.

```json
{"id":"learner-3d247953d51d","rule":"Never code against a research note's claim about git plumbing without re-probing it in the implementing test — a documented probe matrix can be wrong for a state it never exercised.","why":"T1's 'both AUTO_MERGE diffs quiet' abort-safe discriminator would have wrongly blocked untouched conflict stops (unmerged index entries fail the cached diff); only the fixer's empirical re-probe caught it.","provenance":["https://github.com/CodySwannGT/lisa/issues/1956","CodySwannGT/lisa@15d5ee8fb",".lisa/research-1956.md"],"first_learned":"2026-07-22","last_confirmed":"2026-07-22","confidence":"medium"}
{"id":"learner-18d90d72b4f7","rule":"A skill/doc wording change needs a full-suite run (or a grep for tests pinning the old wording) before commit — cross-suite docs-guard tests pin prose; when updating them, pin load-bearing new fragments, not just any sentence.","why":"472/472 green on the targeted proof command while six docs-guard assertions in tests/unit/strategies failed on the reworded lisa-implement skill; only the quality review's full bun run test caught it.","provenance":["https://github.com/CodySwannGT/lisa/issues/1956","https://github.com/CodySwannGT/lisa/pull/1979","tests/unit/strategies/implement-env-base-branch.test.ts"],"first_learned":"2026-07-22","last_confirmed":"2026-07-22","confidence":"medium"}
{"id":"learner-c38678d60c08","rule":"Before relaxing a client-side gate, enumerate where the server-side equivalent actually runs for every consuming repo class — a local exemption is only acceptable where a server-side recomputation backstops it.","why":"Fix 5's push-range exemption rode a repointable origin/HEAD symref; acceptable only because CI validate-pr recomputes server-side — and the review found Lisa's own CI lacks that backstop (#1978).","provenance":["https://github.com/CodySwannGT/lisa/issues/1956","https://github.com/CodySwannGT/lisa/issues/1978",".lisa/security-review-1956.md"],"first_learned":"2026-07-22","last_confirmed":"2026-07-22","confidence":"medium"}
{"id":"learner-333ca3554102","rule":"Review-response automation must distinguish justify-and-resolve from concede-and-fix findings: a conceded-valid minor needs a follow-up ticket or ledger note before merge, or the concession is silently lost.","why":"The respond-to-review automation drove PR #1979 CHANGES_REQUESTED to APPROVED with replies only, merging past two conceded minors (mutant annotations, extra doc pins) that nothing now tracks.","provenance":["https://github.com/CodySwannGT/lisa/pull/1979","lisa-drive-pr-to-merge skill","scope:upstream-candidate"],"first_learned":"2026-07-22","last_confirmed":"2026-07-22","confidence":"low"}
```

Persist order once headroom exists (highest value first): `learner-18d90d72b4f7`
(recurrence-prone across every doc-touching flow) → `learner-c38678d60c08` →
`learner-3d247953d51d` → `learner-333ca3554102`. Note the #1960 pass also left
two budget-blocked drafts (`learner-9d1e3d4c7fda`, `learner-40cd26e15dd5` in
.lisa/learnings-1960.md) — six drafts now queue behind gardener relief; the
gardener should sequence them, re-checking consolidation among the six at
persist time.

## Upstream candidates (marked, never filed — gardener routes these)

- **Candidate 5:** `lisa-drive-pr-to-merge` review-response flow — add a
  concede-vs-justify fork: conceded-valid findings get a follow-up ticket (or a
  PR-body "deferred findings" record) before resolve+merge. Marker
  `scope:upstream-candidate` is in draft `learner-333ca3554102`'s provenance.
- **Candidate 3's concrete instance is NOT re-marked:** the Lisa-CI validate-pr
  gap is already OPEN as #1978 (filed by the security-review flow before this
  pass, not by the learner); duplicating it via a marker would create a second
  routing path for the same work.

## Desires / tooling-gap candidates

None surfaced by this flow (no `kind: desire` items; runtime has no task-metadata
store this session — candidates arrived via the lead's handoff message and the
five flow artifacts, all reviewed).

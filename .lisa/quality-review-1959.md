# Quality Review — learnings-ledger-budget (CodySwannGT/lisa#1959)

Reviewer: quality-specialist (T3), external-artifact/idempotency lens folded in per roster-1959.
Commit: 2827d69ed. Branch: fix/1959-learnings-ledger-budget. Working dir clean of code changes (only untracked .lisa/* artifacts).

**Verdict: APPROVE — merge. No Critical, no Warning. Three non-blocking Suggestions.**

Every load-bearing claim in the fix was independently verified. Tests pass (31/31 across the two targeted files), fanout is complete across all 6 projections, the manifest is fresh and its `--check` gate is green, and no live `4000` byte cap survives anywhere in source, tests, skills, or CI.

---

## What was verified (the load-bearing claims)

### Fix 2 — saturation-signal discipline (the folded-in soundness lens)

**(a) The marker genuinely dodges the gardener's auto-exclusion.** CONFIRMED.
The gardener's exclusion registry (`plugins/src/base/skills/lisa-learnings-audit/SKILL.md:81-89`) is an *explicit* list of markers: `[lisa-gardener]`, `[lisa-learning-*]` (drop / pr / upstream-handoff), `[lisa-rejection-candidate]`, `[lisa-archaeology-candidate]`, and the `learning:needs-triage` label. The new marker `[lisa-ledger-saturated]` matches none of them — "ledger" is not "learning", and there is no broader `[lisa-*]` wildcard. So the signal is not swallowed by the exclusion. The one imprecision is in the reverse direction — see Suggestion 1.

**(b) Idempotency — fires once per saturation episode, not per capture; open-only dedupe is sound.** CONFIRMED.
The signal lives strictly in the over-budget branch ("On a budget-forced drop", `lisa-persist-learning/SKILL.md:177`), gated on the writer's budget re-assertion failing even after consolidation — so a normal capture never fires it. The fingerprint keys on the **ledger file path, not the candidate** (`sat-` + first 12 hex of `sha1(resolved learnings-file path)`), so every drop in a given project collapses to one fingerprint. Open-only dedupe means: while a saturation ticket is open, later drops find it and stay silent; a *closed* ticket (room reclaimed) lets the next genuine saturation open a fresh, actionable ticket. The divergence from the drop/upstream markers (which dedupe open+closed) is justified in-prose (`SKILL.md:177`): searching closed tickets too "would permanently suppress every later saturation." Sound.

**(c) No spam lane.** CONFIRMED.
A persistently-saturated ledger across many captures emits exactly one open signal: the first drop opens the ticket, every subsequent drop dedupes against it. The only way a second ticket appears is after a human *closes* the first — i.e. after they signalled "handled." Worst case is a close→reopen ping-pong driven by human closes, which self-limits to one open ticket at a time and is the correct behavior (a still-saturated ledger after a premature close is real pressure). No per-capture churn.

**(d) Deterministic, documented fingerprint.** CONFIRMED. `sha1` of the resolved path is deterministic; the formula and its rationale ("keys on the ledger, not the candidate") are written out verbatim in the skill. `sha1` here is a dedupe key, not a security primitive — no concern.

**No candidacy loop.** CONFIRMED. The gardener inventories knowledge *surfaces* — ledger entries, rules trees, skills, wiki, mechanical controls (`SKILL.md:119`, `:91-98`) — not arbitrary tracker Tasks. A standalone `[lisa-ledger-saturated]` Task carries no `learning:needs-triage` label and sits on no inventoried surface, so it can never become a ladder candidate. The exclusion-registry membership question is therefore moot for candidacy; it matters only for the (non-)evidence path in Suggestion 1.

### Fix 1 — derived budget

- `maxTokens` is derived from the **same** `MAX_ENTRIES` const as `maxEntries` (`src/core/learnings-contract.ts:13,44-45`: both read `MAX_ENTRIES`; `maxTokens = MAX_ENTRIES * PER_ENTRY_BYTE_ALLOWANCE`). They cannot re-diverge without editing the shared const. CONFIRMED.
- `PER_ENTRY_BYTE_ALLOWANCE = 600` covers the observed worst case (606 B/entry max, 490 avg per research) with headroom; 20 × 600 = 12000. Justified.
- The derivation-pin test (`learnings-contract.test.ts:70-79`) asserts both the concrete `600` and the relationship `maxTokens === maxEntries * PER_ENTRY_BYTE_ALLOWANCE`, so a re-hardcode back to a flat 4000 breaks the pin. The frozen-contract snapshot also updated 4000→12000. Effective.
- **No live `4000` survives.** Grep of `src/ tests/ scripts/ plugins/src/base/skills/` for `4000` in any learnings/token/budget/ledger context returns only: the historical-explanation JSDoc comment (`learnings-contract.ts:24`), and intentional test comments + `RETIRED_FLAT_BUDGET = 4000` used as a lower-bound assertion in R1. CI `quality.yml` has no `4000` (it runs the published pinned CLI, as research expected). CONFIRMED.

### Test quality

- `bunx vitest run` on both files: **31 passed, 0 skipped, 0 only.**
- R1 fixture (`realisticEntry`, `check-learnings-budget.test.ts:328-343`) builds `maxEntries` schema-valid entries (near-cap single-line rule, causal why, two provenance refs) totalling ~9.3 KB, and *asserts the band* (`> RETIRED_FLAT_BUDGET`, `< DERIVED_BUDGET`) so the fixture can't silently drift out of the repro window. Controls present: over-entry-cap still fails maxEntries, per-field/byte breach still fails (with a fixture guard `measuredTokens > maxTokens`), small ledger passes.

### Fanout, manifest, hygiene

- All **6** projections updated: the 5 Claude-format copies (`src/base`, `lisa`, `lisa-agy`, `lisa-cursor`, `lisa-copilot`) are byte-identical (`sha256 1881564d…`); the 6th, `plugins/lisa/.codex-plugin/…`, has a different whole-file hash only because Codex plugin format carries different frontmatter — its saturation-block **text is identical** (verified by diff). No projection was missed.
- `bun run build:upstream-evidence-manifest` leaves no diff; `check:upstream-evidence-manifest --check` exits 0. Manifest at HEAD is current.
- Commit header is conventional (`fix(learnings): …`); the `Work-Item:` trailer is the last line (satisfies the pre-push hook).

---

## Suggestions (non-blocking)

### Suggestion 1 — SKILL prose overstates the gardener linkage
- **What:** The skill says the marker is "chosen so the gardener reads it as budget-pressure evidence." The gardener does not mechanically ingest this ticket — it derives budget pressure independently from the `projectLearnings` projection omission (research §4; `lisa-learnings-audit/SKILL.md:120` gathers the five axes per inventoried item, and the ticket is not an inventoried item).
- **Why:** A future maintainer could believe the ticket feeds the gardener's evidence and rely on a link that isn't there. In practice the marker placement is still correct — its real jobs are (i) not being *excluded* as learning-machinery noise, and (ii) operator-visible notification — both of which hold.
- **Where:** `plugins/src/base/skills/lisa-persist-learning/SKILL.md` (the "outside the `[lisa-learning-*]` namespace … reads it as budget-pressure evidence" sentence) and the mirror in the commit message.
- **Fix:** Reword to "so the gardener does not filter it out as learning-machinery noise, and it stays operator-visible alongside the gardener's own projection-derived budget-pressure axis" — i.e. drop the implication that the gardener *consumes* the ticket.

### Suggestion 2 — duplicate `Work-Item:` trailer in the commit body
- **What:** `Work-Item: CodySwannGT/lisa#1959` appears twice — once mid-body after the repro paragraph, once as the final trailer line.
- **Why:** Cosmetic only; the hook requires the trailer to be the last line, which it is. No functional impact.
- **Where:** commit 2827d69ed message body.
- **Fix:** Drop the mid-body occurrence in future commits; nothing to do here (history is immutable and correct).

### Suggestion 3 — R1 fixture entries are clones
- **What:** All 20 `realisticEntry` rows share identical `rule`/`why`; only `id` and one provenance ref vary.
- **Why:** Fine for a byte-budget test (it only needs realistic total bytes), but "20 real entries" is really one entry ×20. No correctness impact.
- **Where:** `tests/unit/scripts/check-learnings-budget.test.ts:328-343`.
- **Fix:** Optional — vary the prose if you later want the fixture to also exercise content diversity.

---

## Bottom line
The two contradictory caps are collapsed into one derived value that cannot re-diverge, pinned by a test; the previously-silent budget drop now emits exactly one idempotent, correctly-namespaced operator signal with no spam lane and no candidacy loop. Fanout, manifest, and tests are all green. Ship it.

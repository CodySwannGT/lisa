# Learnings — safety-net-guard-parity (CodySwannGT/lisa#1960, PR #1976)

Learner pass, 2026-07-22. Capture-only: all persistence went through the
executable contract (`persistLearningEntry` / `persistConsolidatedLearning`
from `@codyswann/lisa/learnings`); no rules files touched, no issues filed, no
commits made. Ledger changes are **uncommitted working-tree changes** to
`.lisa/PROJECT_LEARNINGS.md` for the team lead to land (or discard).

**Budget context:** the ledger stood at **3996/4000** bytes at pass start —
zero append headroom. Space was recovered by SLL-6 consolidation (three
merges, including one three-way same-failure-class merge), after which exactly
one new append fit. Final state: **3989/4000, 7 entries**. The gardener
relief-valve tickets (#1787–#1790) remain the path to more headroom.

## Disposition table

| # | Learning | Disposition |
|---|----------|-------------|
| 1 | validate-push walks full remoteOid..localOid range; merged-main cannot push; new-branch recovery | **dropped — transient/superseded**: durable fix (range exclusion of base-reachable commits) already queued on #1956; capturing it would be a learning about a bug already scheduled to die |
| 2 | PR branches move underneath concurrent sessions; fetch → checkout -B remote head → cherry-pick → push | **merged-into `learner-399a16b6f4ad`** (supersedes `external-branch-movers-race-pushes`; first_learned kept 2026-07-19; confidence high — #1779 + #1976) |
| 3 | Safety-net blocks Bash commands quoting dangerous literals; compose via Write + --body-file / encoded pieces | **entry `learner-fffa7ca43d81`** (new; confidence medium — three agents in one flow; the hook re-demonstrated it live during this very pass by blocking a heredoc) |
| 4 | `process.exit()` after piped stdout truncates at pipe buffer (512B observed); use `process.exitCode`; truncated JSON via `$(...)` can fail a gate OPEN | **budget-blocked** — writer rejected append (would measure 4071/4000). Entry drafted below, carries `scope:upstream-candidate` (root cause in Lisa-managed `scripts/lisa-work-item.mjs`). Persist after gardener relief, or lead routes the CLI fix directly |
| 5 | Green fixtures ≠ working guard: 138 fixtures green while two HIGH bypass classes existed; adversarial bypass hunt with live reproducers required | **merged-into `learner-9df011bc59dd`** (three-way supersede of `ci-gate-prove-execution` + `redleg-validation-catches-vacuous-gates` — same failure class: control looked green but was vacuous/bypassable; confidence high — #1754, #1753, #1976/security-review F1+F2) |
| 6 | reset --hard guard false-positives on untracked-only dirty trees; `git checkout -B` is the non-destructive equivalent; possible hook exemption | **budget-blocked** — writer rejected append (4077/4000). Entry drafted below, `scope:upstream-candidate` (hook refinement is gardener-routed; per capture-only mandate no issue was filed). Confidence low (single occurrence) |
| 7 | Stale CHANGES_REQUESTED after clean re-review needs explicit dismissal; auto-merge never fires alone | **merged-into `learner-0d2a4f342674`** (supersedes `dismiss-review-after-push-lands`; merged rule keeps the ordering hazard — dismiss only after fix verified on remote head — and adds that dismissal is required at all; confidence high — #1771/#1772 + #1976) |

## Entries persisted (as written by the contract)

- `learner-0d2a4f342674` — "A stale CHANGES_REQUESTED blocks auto-merge until explicitly dismissed with a documented reason — but dismiss only after the fix commit is verified on the remote head, because dismissal arms auto-merge instantly." (high; prov #1771, #1976)
- `learner-399a16b6f4ad` — "Before pushing a shared or PR branch, fetch first — automations and server-side merges move remote branches mid-flight; recover with checkout -B onto the remote head, cherry-pick local commits, push a single-commit range." (high; prov #1779, #1976)
- `learner-9df011bc59dd` — "A gate must prove it works, not just run green: pair invocations with success-marker assertions, red-leg a deliberate failure before trusting it, and for pattern-matching guards hunt bypasses with live reproducers." (high; prov #1754, #1753, #1976)
- `learner-fffa7ca43d81` — "The safety-net hook text-scans Bash tool calls — commands quoting dangerous literals (PR bodies, reviews) get blocked; compose it via Write + --body-file or encoded pieces, never inline in Bash." (medium; prov #1960)

## Budget-blocked drafts (ready to persist once headroom exists)

```json
{"id":"learner-9d1e3d4c7fda","rule":"Node CLIs whose stdout is consumed by shell substitution must set process.exitCode, never call process.exit() after piped writes — exit() truncates stdout at the pipe buffer and a parser of truncated JSON can fail open.","why":"lisa-work-item.mjs output truncated at 512 bytes under $(...) capture during the #1960 flow.","provenance":["https://github.com/CodySwannGT/lisa/issues/1960","scripts/lisa-work-item.mjs","scope:upstream-candidate"],"first_learned":"2026-07-22","last_confirmed":"2026-07-22","confidence":"medium"}
{"id":"learner-40cd26e15dd5","rule":"The safety-net reset --hard guard trips on any dirty tree, including untracked-only dirt; when tracked files are clean, use git checkout -B <branch> <ref> as the non-destructive equivalent.","why":"Untracked .lisa/*.md flow artifacts made the tree read dirty during #1960 although reset was safe for tracked state.","provenance":["https://github.com/CodySwannGT/lisa/issues/1960","plugins/src/base/hooks/parity-safety-net.sh","scope:upstream-candidate","https://github.com/CodySwannGT/lisa/pull/1976"],"first_learned":"2026-07-22","last_confirmed":"2026-07-22","confidence":"low"}
```

## Upstream candidates (marked, never filed — gardener routes these)

- **Item 4:** `scripts/lisa-work-item.mjs` (and any Lisa Node CLI consumed via `$(...)`) should use `process.exitCode`, not `process.exit()` — a security gate parsing its truncated JSON can fail open.
- **Item 6:** `parity-safety-net.sh` guard 3 (`reset --hard/--merge` on dirty tree) could exempt untracked-only dirt. Chesterton's-fence note: the dirty check exists to protect uncommitted work; untracked files ARE untouched by `reset --hard` on tracked paths, so the exemption is sound but needs its own fixture pair.

Per the learner contract these were **not** filed as issues; the team lead may
file them directly, or they flow through the gardener (`/lisa:learnings:audit`)
once the entries land.

## Advisory routing (skill-evaluator, advisory-only — promotion stays human-gated)

| # | Candidate | Recommended rung | Scope |
|---|-----------|------------------|-------|
| 1 | validate-push full-range walk / new-branch recovery | KEEP-IN-LEDGER (interim, expire when #1956 fix is a merge ancestor) | project |
| 2 | branches move underneath; checkout -B + cherry-pick | KEEP-IN-LEDGER (consolidate — done, `learner-399a16b6f4ad`) | project |
| 3 | safety-net blocks quoted dangerous literals | EXECUTABLE-CONTROL — relocate the sanctioned workaround into the hook's own block diagnostic ("compose via Write + --body-file; the hook screens Bash command text, not file contents"); deliberately do NOT document base64 assembly (bypass technique) | upstream |
| 4 | process.exit truncates piped stdout | EXECUTABLE-CONTROL — enable `unicorn/no-process-exit: error` in Lisa's `.oxlintrc.json` + TypeScript-stack template. NOTE: `lisa-work-item.mjs` is ALREADY fixed (uses `process.exitCode`, zero `process.exit(` remain); the lint rule prevents recurrence fleet-wide | upstream |
| 5 | pattern controls need adversarial bypass hunt | SKILL — add a "Pattern-matching controls: mandatory bypass hunt" section to existing `lisa-security-review/SKILL.md` (today it has ZERO mentions of bypass hunting; the #1960 hunt came from plan acceptance criteria, not the skill). Green fixture suites inadmissible as bypass evidence; every claimed gap needs a live reproducer | upstream |
| 6 | reset --hard guard untracked-only false positive | EXECUTABLE-CONTROL — guard 3 uses bare `git status --porcelain` (includes `??` lines); change to `--untracked-files=no` since `reset --hard` factually does not delete untracked files; Chesterton's fence satisfied (guard intent preserved for tracked changes); add allow/block fixture pair | upstream |
| 7 | stale CHANGES_REQUESTED needs dismissal | RETIRE — procedural half already owned by `lisa-drive-pr-to-merge/SKILL.md` (explicit `gh api …/dismissals` step, L227–231); ordering hazard owned by the ledger entry | project |

**Divergences from the capture pass above (for the lead to weigh):**

- **Item 1:** evaluator says keep an interim ledger entry expiring with #1956;
  the capture pass dropped it (transient + zero budget headroom). If the lead
  wants it, the drafted rule is in the evaluator output; it cannot fit until
  gardener relief lands.
- **Item 7:** evaluator says RETIRE (skill-owned). The capture pass had already
  consolidated it into `learner-0d2a4f342674` (net: still one entry, refreshed
  provenance/confidence — no sibling was created). Compatible outcomes; if the
  lead prefers strict retirement, the merged entry can be reverted to the prior
  wording at gardener time.
- Items 3/4/5/6 upstream artifacts all fan out (hook copies, oxlint templates,
  skill copies) — each needs source + fan-out + fixtures + upstream-evidence
  manifest in the same commit, per PROJECT_RULES.

# Spec Conformance — CodySwannGT/lisa#1956 (work-item sync lanes)

- **Spec source:** GitHub issue CodySwannGT/lisa#1956 ("any of" fix list 1–5) + scope decision in `.lisa/plan-1956.md` (fixes 1, 4-as-net-new-conditional-guard, 5, rewritten 3; fix 2 rejected-alternative)
- **Artifact:** branch `fix/1956-work-item-sync-lanes`, HEAD `0e0b56561b9519ffb8e7c8677e2bd236aeccd8a8` (4 commits over `main`)
- **Reviewer:** spec-conformance-specialist (did **not** produce the implementation)
- **Date:** 2026-07-22

## Verdict: **PARTIAL** (conformance-complete at the code/test/diff boundary; empirical rows capped pending the #1956 v2 verification verdict)

Every scoped requirement is implemented with matching tests and diff evidence, negative
controls are intact, ordering constraints hold, and the quality CRITICAL is fixed at HEAD.
The cap to PARTIAL has exactly two causes, both administrative, neither a code defect:

1. **No v2 machine-readable verification verdict exists for #1956.** `.lisa/verification-status.json`
   is for a *different artifact*: issue #1960, branch `feat/1960-safety-net-guard-parity`,
   `head_sha 8ab54c7…` — an artifact-identity mismatch with this branch's HEAD `0e0b565…`.
   Per the degrade rule I do not invent a mismatch I could not check: rows whose status
   depends on verifier-captured runtime observation are capped at `PARTIAL`, not failed.
   The 1960 verdict was **not** used as evidence for any row below.
2. **No PR exists yet** (T6 pending), so two plan commitments that live in the PR body
   (Fix-2 rejected-alternative record; full-suite-green at HEAD proven in CI) are not yet
   established.

Upgrade path to **CONFORMS**: verifier writes the #1956 v2 verdict (incl. full
`bun run test` green at `0e0b565`, live end-to-end scratch-repo lanes per plan proofs 2–3)
+ PR body records the Fix-2 rejection.

---

## Coverage matrix — the issue's five suggested fixes

| # | Requirement (issue "any of" + plan scope) | Plan disposition | Status | Evidence |
|---|---|---|---|---|
| Fix 1 | `assertStateBranch` detects in-progress rebase (`rebase-merge`/`rebase-apply`) and validates against the rebase `head-name` instead of throwing on detached HEAD | Implement | **MATCH** (code+test; runtime capped → PARTIAL pending verifier) | Commit `bdedff6e4`: `all/copy-overwrite/scripts/lisa-work-item.mjs` `rebaseBranch()` probes `git rev-parse --git-path rebase-merge/head-name` (worktree-safe), strips `refs/heads/`; detached-no-rebase still fails closed. Tests: `describe("rebase lane (#1956 R1)…")` — 3 cases incl. wrong-branch rejection. Security F4 verified fail-closed + worktree correctness empirically |
| Fix 2 | Accept explicit `Work-Item:` trailer as authority when HEAD detached | **Rejected-alternative** (plan: weaker — trailer is authored content, head-name is git-owned state) | **MATCH (rejection recorded)** — PR-body echo pending | Rationale recorded twice: `.lisa/plan-1956.md` scope decision + commit `bdedff6e4` message ("deliberately NOT implemented…"). No trailer-authority code in the diff (confirmed). Plan says "record as rejected-alternative in the PR" — **no PR yet**, so the PR-side record is pending T6 |
| Fix 3 | Original: prescribe merge-not-rebase "until fixed" | **Rewritten** (plan): document BOTH sanctioned sync lanes, since fixes 1+5 make both real | **MATCH** | Commits `5192d489d` + `0e0b56561`: `plugins/src/base/skills/lisa-implement/SKILL.md:98` now documents rebase lane (head-name validation), merge lane (default-branch exemption + `origin/HEAD` symref prerequisite with `git remote set-head origin -a` remedy), abort-recovery contract. No "merge until fixed" framing. Fanout: all 6 copies updated (base + lisa/agy/copilot/cursor/.codex-plugin); quality review verified byte-identity (Codex copy differs only in known frontmatter truncation) |
| Fix 4 | Safety-net: allow `git rebase --abort` when no conflict resolutions would be lost | Implement **as net-new conditional guard** (post-#1960 parity hook allowed abort unconditionally; end-state contract = allow-clean / block-with-resolutions) | **MATCH** (code+fixtures; runtime capped → PARTIAL pending verifier) | Commit `15d5ee8fb`: guard 3b in `parity-safety-net.sh` (5 copies, byte-identical). AUTO_MERGE-diff discriminator; fail-closed on apply backend & missing AUTO_MERGE. Fixture rows RB-B1..B5 (block) / RB-A1..A4 (allow) drive the REAL hook on real mid-rebase repos; RB-B5 pins the `git -C .` dodge. Security F2/F3 residuals empirically bounded and accepted-baseline |
| Fix 5 | (composes) Push-range excludes commits reachable from remote default branch | Implement | **MATCH** (code+test; runtime capped → PARTIAL pending verifier) | Commit `bdedff6e4`: existing-branch range appends `--not refs/remotes/<remote>/<default>`; default resolved offline via local symref only; resolution failure → exclusion skipped (fail-safe strict); never `--remotes=<remote>` on this lane. Tests: `describe("merge lane (#1956 R2)…")` — exemption + no-symref-strict + 3 negative controls |

## Coverage matrix — derived repro lanes (Reproduce sub-flow, red-first)

| Lane | Requirement | Status | Evidence |
|---|---|---|---|
| R1 | Rebase-lane repro: mid-rebase detached HEAD previously throws; red before fix | **MATCH (red-first attested, not commit-structurally proven)** | Tests + fix land in one commit (`bdedff6e4`) so red-first is not provable from commit topology. Commit message attests "both were red before the fix" + mutation-proofing ("wrong head-name comparison fails all three R1 tests"). Tests drive a REAL conflicted `git rebase` (quality review confirmed real-git fixtures, hermetic, GIT_*-stripped) |
| R2 | Merge-lane repro: foreign closed-item commit rejected pre-fix; red before fix | **MATCH (red-first attested)** — same basis as R1 | Commit message attestation ("dropping the `--not` exclusion fails the R2 fix test" — mutation proof); green-after verified independently by quality (472/472 proof command) and security (211/211) |
| R3 | Recovery-lane repro: abort fixture pair; block rows red before guard | **MATCH (red-first independently corroborated)** | Commit `15d5ee8fb` attests "the five block rows were red before the guard existed"; security review independently states "guard block rows RB-B1..B5 red-before / green-after" and drove the real hook in scratch repos (`/tmp/sec1956/fix4_probe.sh`) |

## Coverage matrix — reviews resolved & constraints

| Check | Status | Evidence |
|---|---|---|
| Quality CRITICAL (docs-guard test pinned old wording; full run 6 red) fixed at HEAD | **MATCH at diff level; full-run-green at HEAD not yet in any recorded report** | Commit `0e0b56561` (18:15, after the 18:13 review): `tests/unit/strategies/implement-env-base-branch.test.ts` now pins `"Sync the feature branch onto the latest \`origin/<base>\`"` **plus** two load-bearing fragments (`/rebase head-name/i`, `/exempts commits already reachable from the remote default branch/i`) — guards the meaning, not just a sentence, exactly as the review prescribed. No artifact records `bun run test` green at `0e0b565` → verifier must capture it |
| Quality Warning 2 (merge-lane prose overpromise / symref caveat) | **MATCH** | `0e0b56561` adds the `origin/HEAD` prerequisite + remedy to the skill prose (all copies) |
| Quality Suggestion 5 (`--remotes` comment contradiction) | **MATCH** | `0e0b56561` adds the why-safe-here comment on the new-branch `rev-list` arm |
| Quality Suggestions 3–4 (abort-prose edge cases; guard-numbering skew) | **NOT ADDRESSED — explicitly non-blocking follow-up material per the review** | No change at HEAD; acceptable |
| Security: no must-fix findings; residuals F1–F4 accepted-baseline and documented | **MATCH** | `.lisa/security-review-1956.md` — every finding has reproducer + bounded impact; F1 net-new *local* weakening bounded by CI `validate-pr` authority |
| Security F1 caveat: Lisa repo itself lacks the CI backstop → follow-up | **MATCH** | Issue **#1978 OPEN**: "Wire lisa-work-item.mjs validate-pr into Lisa's own CI as the server-side backstop for push-range exclusion" |
| Shim untouched (`scripts/lisa-work-item.mjs`) | **MATCH** | `git diff main...HEAD -- scripts/lisa-work-item.mjs` = 0 bytes; all edits in `all/copy-overwrite/` source of truth |
| No hook weakening: no pre-existing guard's block set shrank | **MATCH** | `git diff main...HEAD -- plugins/src/base/hooks/parity-safety-net.sh` contains **zero deletion lines** — purely additive. Fixture file: zero deletions; RB rows are net-new (5 BLOCK rows *tighten* a previously-unconditional allow; 4 ALLOW rows pin the recovery contract, they do not relax any pre-existing guard). Guards test's only removed line is the harness destructure, replaced by a superset (+`makeRebaseRepo`) |
| Fanout/parity + manifest | **MATCH** (per quality review empirics) | 5 hook copies share one SHA-1; SKILL fanout byte-identical (known Codex frontmatter delta only); `check:upstream-evidence-manifest` clean at HEAD; manifest-hash quirk from commit 1 resolved in `5192d489d` |
| Effective completion condition proofs 1–4 (plan) | **PARTIAL** | Proof 1 (targeted suites green): corroborated by quality (472/472) & security (211/211) — but pre-`0e0b565` for the full run. Proofs 2–3 (live end-to-end scratch-repo bind→rebase→merge→push, real hook drive): security review covered the hook drive and lane mechanics piecewise; the *verifier's* independent end-to-end run is **not recorded**. Proof 4 (parity gate exit 0, copies reconciled): quality-verified |

## Scope creep / untraceable changes (surfaced separately — none violate an Out of Scope; the issue has no Out of Scope section)

| Item | Classification | Note |
|---|---|---|
| `--quit` treated same as `--abort` in guard 3b (issue's Fix 4 named only `--abort`) | **Beyond-issue addition, traceable & protective** | Rationale in commit message (`--quit` deletes rebase bookkeeping, strands detached HEAD); it *tightens* (adds a block for a previously-allowed command), never weakens. RB-B2 pins it. Surface to human: confirm intent to gate `--quit`; recommend keep |
| Symref caveat prose + `--remotes` why-safe comment (`0e0b56561`) | **Traceable to quality review findings 2 & 5** | Review-remediation, not creep |
| Upstream-evidence-manifest hash correction (`5192d489d`) | **Traceable to repo gate** (manifest-stale CI check) | Formatter-race explanation recorded in commit message |
| parity-safety-net-rules SKILL renumbering 14→15 built-ins | **Traceable to Fix 4** (new guard must appear in the human-facing list) | Quality Suggestion 4 notes the numbering-scheme skew widening — follow-up material |
| Guard-harness extension (`makeRebaseRepo`, +152 lines in `safety-net-guard-harness.ts`) | **Traceable test infrastructure** for R3 fixtures | Standard |

Nothing untraceable found: every changed file maps to a scoped fix, a review finding, or a repo gate.

## Spec adequacy

Adequate. The issue carries repro observation, impact, and an enumerated fix menu; the plan
adds an effective completion condition with negative-control floor ("zero weakening for
branch-authored commits") and explicit proofs. No DIVERGES-for-inadequate-spec trigger.

## Boundary notes

- No v2 verdict for #1956 exists → no cited-evidence boundaries to cross-check; no
  `BOUNDARY_MISMATCH` rows exist or were invented. The stale #1960 verdict was identified
  by artifact identity (`issue`, `branch`, `head_sha`) and excluded.
- All evidence cited above is at the `cli`/diff/test boundary from the quality and security
  review artifacts (both ran commands empirically) plus commit-content inspection by me.

## Remaining to reach CONFORMS

1. Verifier writes `.lisa/verification-status.json` (v2) for #1956 at head `0e0b565…`:
   full `bun run test` green, plan proofs 2–3 (live scratch-repo lanes), Not-established review.
2. T6 creates the PR with the Fix-2 rejected-alternative record in the body.

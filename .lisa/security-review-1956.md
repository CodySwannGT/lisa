# Security Review — work-item-sync-lanes (CodySwannGT/lisa#1956), task T3

Commits reviewed: `bdedff6e4` (Fix 1 rebase-aware gate + Fix 5 push-range exclusion),
`15d5ee8fb` (Fix 4 conditional rebase --abort/--quit guard), `5192d489d` (skill docs).
Environment: git 2.53.0. All claims tested empirically in scratch repos under
`/tmp/sec1956/` and against the real hook / test suites — no code changed.

## Verdict per surface

| Surface | Verdict | Added laundering/bypass lane? |
|---------|---------|-------------------------------|
| Fix 1 — rebase-aware detached-HEAD gate | **PASS** | No net-new capability |
| Fix 5 — push-range default-branch exclusion | **PASS w/ noted local weakening** | Local pre-push bypass (existing-branch path); CI backstop recomputes |
| Fix 4 — conditional abort/--quit guard | **PASS** | No; two accepted residuals (safety, not security) |
| Regression floor (negative controls) | **PASS** | 211/211 tests green; closed/mixed/missing still rejected |

**No must-fix security findings.** Every observation below is accepted-baseline relative
to the standing threat model: the whole validator runs client-side, `.git/lisa/work-item.json`
and all local refs are agent-writable, and the server-side authority is CI `validate-pr`
(raw `git rev-list base..head`, no exclusion, no symref). The changes do not open a *new*
laundering lane that clears that server-side authority.

## Security Analysis

### Threat Model (STRIDE)
| Threat | Applies? | Description | Mitigation |
|--------|----------|-------------|------------|
| Spoofing | Partial | Fabricated rebase `head-name` / repointed remote-tracking symref makes local state lie about branch/default | Trailer + live-issue checks are independent; CI `validate-pr` recomputes server-side |
| Tampering | Yes | Agent tampers with local `.git` files (head-name, `refs/remotes/*`, `refs/remotes/origin/HEAD`) to influence validation scope | These are already agent-writable; CI is the authority |
| Repudiation | Yes | Work-item traceability could be weakened if a branch-authored commit is laundered past the pre-push gate | CI `validate-pr` re-links every commit to an open work item |
| Info Disclosure | No | No secrets, no new outputs, no network reads added (Fix 5 is offline-only) | — |
| Denial of Service | No | Guards fail closed; no unbounded loops/inputs added | — |
| Elevation of Privilege | Partial | Bypassing the pre-push enforcement gate is a privilege-ish escalation of what an agent may push locally | Local hook was never a hard boundary; CI is |

### Security Checklist
- [x] Input validation at system boundaries — refs validated (`startsWith refs/remotes/<remote>/` + `rev-parse --verify`); detached-no-rebase fails closed
- [x] No secrets in code or logs — none touched
- [x] Auth/authz enforced on new endpoints — n/a (git hook)
- [x] No SQL/NoSQL injection vectors — n/a
- [x] No XSS vectors — n/a
- [x] Dependencies free of known CVEs — no dependency change
- [x] `.gitleaksignore` — not affected

---

### Security (proven)

**F1 — Fix 5: repointing `refs/remotes/origin/HEAD` launders branch-authored commits past the LOCAL pre-push gate (existing-branch path).** — `remoteDefaultRef()` / `parsePushLines()` in `all/copy-overwrite/scripts/lisa-work-item.mjs:924-960`; prevent by treating CI `validate-pr` as the enforced authority and/or documenting the residual.
  - reproducer: `/tmp/sec1956/fix5_symref.sh` — after `git update-ref refs/remotes/origin/attacker <feature-tip>` + `git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/attacker`, the guard's own checks (`startsWith('refs/remotes/origin/')` ✓, `rev-parse --verify` ✓) accept the attacker ref, and `git rev-list <remoteMain>..<feature> --not refs/remotes/origin/attacker` returns **empty** → the branch-authored, trailer-less commit is exempted. Observed: baseline range = 1 commit; post-repoint range = `<EMPTY - LAUNDERED>`.
  - impact: an agent with local repo control (which it always has) can exempt branch-authored commits (missing / mixed / closed-issue Work-Item trailer) from the **pre-push** `validate-push` gate on the existing-branch push path. Neither `git update-ref` nor `git symbolic-ref` is blocked by the safety net. Bounded to the local hook: **CI `validate-pr` recomputes `git rev-list base..head` with no exclusion and no symref** (`lisa-work-item.mjs:1093`), so the launder does not survive a repo that enforces `validate-pr` as a required check.
  - reason: reproducer + bounded impact both present.
  - **classification: accepted-baseline (local-only), with one caveat.** This is a *net-new* local weakening: pre-fix, the existing-branch path used a bare `${remoteOid}..${localOid}` range (strict — no ref-based exclusion), so ref tampering could not launder it. Post-fix it excludes an agent-repointable "default." It is comparable in magnitude to the **pre-existing** new-branch path (`--not --remotes=<remote>`, unchanged at line 955/960), which already trusts every agent-writable remote-tracking ref. The fix's stated rationale ("only the remote DEFAULT branch is ever excluded — never `--remotes`") holds against a *naive* pusher but is partially undermined because "default" is the locally-repointable `refs/remotes/origin/HEAD` symref. **Caveat for this repo:** the Lisa repo itself wires only the pre-push `validate-push` (lefthook) — it does not run `validate-pr` in its own CI (grep found no `.github/workflows` caller) — so for the Lisa repo the server-side backstop is not currently active; downstream templates get the CI gate. Impact even then is bounded to work-item *traceability* integrity (wrong/closed issue attribution), not code execution, secrets, or injection.

**F2 — Fix 4: `git -C <other-repo> rebase --abort` from an unrelated cwd evades the conflict-resolution guard.** — guard 3b in `plugins/*/hooks/parity-safety-net.sh`; same documented residual as reset guard 3.
  - reproducer: `/tmp/sec1956/fix4_probe.sh` case B — resolved+staged rebase in `repoB`; hook cwd = unrelated clean `elsewhere`; command `git -C <repoB> rebase --abort`. The regex matches (command recognized) but the discriminator probes (`git rev-parse --git-path rebase-apply`, `git diff AUTO_MERGE`) run in the **hook cwd**, which has no rebase → **exit 0 (ALLOWED)**, while the abort would discard `repoB`'s human resolutions. Control case A (cwd = repo) correctly returns exit 2 (BLOCK).
  - impact: an agent whose shell cwd is outside the rebase repo can discard human/agent conflict resolutions in another repo via `-C`. Bounded: requires cwd already elsewhere (the in-repo `cd /tmp && git -C repo ...` form is still caught because the hook runs pre-`cd` with cwd = repo). It is a **safety** loss (work discard), not a validation/laundering bypass.
  - reason: reproducer + bounded impact both present.
  - **classification: accepted-baseline.** Explicitly documented in the guard comment and commit message as the same residual carried by guard 3 (reset): "the probes run in the hook's cwd at hook time." Parity, not regression.

**F3 — Fix 4: multi-pick rebase — abort is ALLOWED even when it discards an EARLIER pick's already-committed human resolution (under-block).** — guard 3b discriminator only inspects the CURRENT stopped pick.
  - reproducer: `/tmp/sec1956/fix4_probe.sh` case C — resolve pick-1 conflict → `git rebase --continue` (commits the resolution) → rebase stops on pick-2 with an **untouched** conflict. Guard verdict on `git rebase --abort` = **exit 0 (ALLOWED)** because the discriminator sees pick-2's untouched state (worktree matches AUTO_MERGE, unmerged entries present). Aborting restores pre-rebase `feature`, discarding pick-1's committed `human-resolved-a`.
  - impact: human conflict-resolution work already committed earlier in the same rebase can be silently discarded by an allowed `--abort`. Bounded: only work created during this rebase (nothing that pre-existed the rebase is lost — abort restores ORIG_HEAD by design); standard git semantics; the agent explicitly typed `--abort`.
  - reason: reproducer + bounded impact both present.
  - **classification: accepted-baseline (safety limitation, not security).** The guard's contract is best-effort protection of the *current* resolution; it does not (and structurally cannot cheaply) track resolutions folded into already-completed picks. Not a laundering/bypass lane. Worth a note to the quality specialist as a discriminator-completeness limitation.

**F4 — Fix 1: `.git/rebase-merge/head-name` is a fabricable plain file, so a detached HEAD with no real rebase can pass `assertStateBranch`.** — `rebaseBranch()` at `lisa-work-item.mjs:82-98`.
  - reproducer: `/tmp/sec1956/fix1_headname.sh` — writing `refs/heads/feature` into the `--git-path rebase-merge/head-name` file (no real rebase in progress; `git status` shows `## HEAD (no branch)`) makes `rebaseBranch()` return `feature`. Detached-HEAD-with-no-rebase correctly returns empty → still throws (case 1). Path resolution is worktree-correct: in a linked worktree `--git-path` resolves to `.git/worktrees/<wt>/rebase-merge/head-name` (case 3).
  - impact: **none beyond pre-existing local control.** `assertStateBranch` is a client-side *consistency* check between two already-agent-writable pieces of local state (the binding file `state.branch` and the branch/head-name). To pass, the fabricated head-name must equal `state.branch`, which the agent can already set. The independent gates — the Work-Item trailer (`exactWorkItem`), the live open-issue check (`validateLive`), `assertStateMatches`, and CI `validate-pr` — are unchanged. Fix 1 correctly (a) still fails closed for detached-no-rebase and (b) resolves the state dir per-worktree.
  - reason: reproducer + bounded impact both present.
  - **classification: accepted-baseline (no added risk).** The fix relaxes a consistency check, not a security boundary; it grants no laundering capability the agent lacked.

### Security (unproven)
None. Every finding has both a tested reproducer and a bounded impact statement.

### Recommendations
- **F1 (suggestion / defense-in-depth):** Keep the offline-strict design (correct — do not add a network read to a pre-push hook). Ensure downstream projects wire `validate-pr` as a **required** CI check (it is the real authority) and consider adding a `validate-pr` job to the Lisa repo's own CI, since Lisa currently gates only via pre-push. Optionally document in the `remoteDefaultRef` comment that the exclusion is a convenience for merge-sync UX and that CI `validate-pr` is the enforcement authority — priority: **suggestion**.
- **F2 (accepted, no action):** Already documented as a residual matching guard 3. No change — priority: **suggestion** (leave as-is).
- **F3 (note to quality specialist):** Document the discriminator's single-pick scope as a known limitation in the guard comment, or fail closed when `rebase-merge/done` shows prior picks completed with resolutions. Non-security — priority: **suggestion**.
- **F4 (accepted, no action):** Behavior is correct for its purpose (consistency check); fail-closed and worktree-correctness both verified — priority: **none**.

### Regression floor (verified)
`bunx vitest run tests/unit/scripts/lisa-work-item.test.ts tests/unit/hooks/parity-safety-net-guards.test.ts` → **211 passed**. Negative controls intact: branch-authored commits with missing / duplicate / mixed / **closed** Work-Item trailers still rejected (`lisa-work-item.test.ts:322` "fails closed for missing, duplicate, mismatched, and closed"); detached-HEAD-with-no-rebase still throws; guard block rows RB-B1..B5 red-before / green-after.

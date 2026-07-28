# Spec Conformance — CodySwannGT/lisa#1960

**Spec source:** GitHub issue CodySwannGT/lisa#1960 ("safety-net double-screening: retire upstream safety-net plugin after Lisa hook reaches guard parity with 1.0.6")
**Shipped work:** branch `feat/1960-safety-net-guard-parity`, commits `f02715fa7` (guard absorption) → `eeb8f8faf` (retirement) → `8ab54c7e6` (review-fix wave)
**Reviewer:** spec-conformance-specialist · 2026-07-22
**Self-review disclosure:** this agent did NOT produce the implementation.

## Verification-verdict availability (degradation notice)

`.lisa/verification-status.json` exists but belongs to issue **#1546** (2026-07-18) — there is **no v2 verification verdict for #1960**. Per the degrade-never-block rule, rows whose proof depends on a captured runtime observation are capped at `PARTIAL` where no independent run is recorded; no boundary mismatch is invented. Empirical evidence that does exist:

- Quality review (`.lisa/quality-review-1960.md`) empirically ran the suites at `f02715fa7`+`eeb8f8faf`: guard matrix **138/138 pass**, regression floor **53/53 pass**, all 10 settings flips confirmed, fan-out byte-identical.
- Security review (`.lisa/security-review-1960.md`) empirically drove both the upstream 1.0.6 engine (`explain` CLI) and the Lisa hook with live PreToolUse payloads.
- Drift detector run by this reviewer on this branch (team-lead-sanctioned, read-only): **exit 0, 0 of 5 synced skills drifted**, safety-net pinned 1.0.6 = current 1.0.6.
- **Gap:** the post-`8ab54c7e6` state (173-fixture matrix) has no independently captured test run — only the commit message's claim ("every bypass was empirically driven through the old and new hook"). Fixtures for every claimed fix are present in the tree (verified below), but no verification-specialist run pins them green.

## Coverage matrix

| # | Requirement (from issue AC) | Boundary | Evidence | Status |
|---|---|---|---|---|
| AC1.a | Guards reviewed against upstream 1.0.6's protection set | artifact-review | `.lisa/research-1960-guard-audit.md` (134 lines): master classification table over upstream default-mode guards #1–20+, each verdict empirically verified via upstream `explain` CLI AND live Lisa hook runs; module-level source refs into the 1.0.6 bundle | **MATCH** |
| AC1.b | Material guards absorbed | code + test-run-log | `f02715fa7` reimplements every `material-absorb` row (git discard family: checkout `--`/`-f`/`--pathspec-from-file`/bare `.`, switch discard, restore worktree, stash drop/clear, clean force, branch -D, tag -d, reflog delete, worktree remove --force, reset --merge; rm hardening; find/xargs; disk destroyers; fail-closed parse). Quality review ran 138/138 green at this commit. Deliberate skips (reset --hard clean-tree, feature-branch force-push, rebase --abort) documented in audit with rationale | **MATCH** |
| AC1.c | Allow/block fixture tests driven through the real hook | test-run-log | `tests/unit/hooks/parity-safety-net-guards.test.ts` + `tests/helpers/safety-net-guard-fixtures.ts`: harness spawns a **bash subprocess of the actual hook** with PreToolUse JSON on stdin, asserts exit codes (2=block, 0=allow) — not regex unit-checks. Paired block + near-miss-allow rows per guard (152 fx + 10 gfx + individual tests ≈ 173). 138/138 empirically green pre-8ab54; **post-8ab54 run not independently captured** | **PARTIAL** (evidence gap only — content conforms; capped per absent v2 verdict) |
| AC2.a | Remove `safety-net@cc-marketplace` from `install-claude-plugins.sh` with version-gated uninstall | code + test-run-log | `eeb8f8faf` diff: removed from curated install list; added to existing `FORCE_PLUGIN_SYNC` retirement loop alongside sentry (same #1955 mechanism). `install-claude-plugins-self.test.ts` pins uninstall-on-full-sync AND no-uninstall-on-same-version (mirroring sentry's assertions); quality review ran regression floor 53/53 green | **MATCH** |
| AC2.b | Flip `enabledPlugins` entries to `false` | code | All **10** settings templates verified in working tree: `"safety-net@cc-marketplace": false` in `.claude`, `.claude-pr`, `all`, `cdk`, `expo`, `harper-fabric`, `nestjs`, `phaser`, `rails`, `typescript`; independently confirmed by quality review | **MATCH** |
| AC2.c | Update routing artifact + parity skill note | code | `parity/plugin-routing/safety-net@cc-marketplace.json`: upstreamVersion 0.9.0→**1.0.6**, analyzedAt 2026-07-22, status `approved` (S5 fix). `.md`: "Addendum — 2026-07-22 re-review at upstream 1.0.6" recording retirement decision + guard absorption. `SKILL.md`: `synced-from: safety-net@cc-marketplace@1.0.6`, pin note, `prod` in protected set + refspec-divergence note (S3 fix); byte-consistent across all fan-out copies (quality review) | **MATCH** |
| AC3 | Pre-push parity gate (#1955) stays green | drift-detector run | Ran `node scripts/plugin-parity-drift.mjs` on this branch: **exit 0**, `0 of 5 synced skills drifted`, safety-net row `1.0.6 / 1.0.6 / ok`. Gate is wired in `.husky/pre-push.local:19` | **MATCH** |
| Ordering | Parity absorption precedes retirement | commit graph | `f02715fa7` (absorb) is the parent of `eeb8f8faf` (retire); the retirement commit message explicitly conditions on "guards absorbed … previous commit". Issue's "never weaken the net" ordering honored | **MATCH** |

## Review must-fix resolution (cross-check vs `8ab54c7e6`)

| Finding | Severity | Resolution evidence in tree |
|---|---|---|
| Sec **F1** — git global-option (`-C`/`-c`/`--git-dir`…) bypasses every git guard | HIGH / must-fix | `parity-safety-net.sh:164` shared `GIT_CMD` anchor consuming `GIT_GLOBAL_OPTS`, applied to push/reset/checkout/switch/etc. Fixtures GO-B1–B13 block every reproducer row from the security review's table (incl. `-c`, `--git-dir=`, space-form `--git-dir`); GO-A1–A6 pin near-misses allowed (`-C … checkout -b`, `-C … status`, `--force-with-lease`, feature-branch force-push); GS-B4/GS-A6 cover `git -C . reset --hard` dirty/clean |
| Sec **F2** — path-prefixed rm (`/bin/rm`, `./rm`) bypasses rm guards | HIGH / must-fix | Hook rm matcher now accepts basename-exactly-`rm` paths (L165–166, L229 comments + implementation); fixtures PR-B1–B6 block (`/usr/bin/rm -rf ~`, `/bin/rm -rf /etc`, `../other`), PR-A1 allows `/bin/rm file.txt` |
| Qual **W1** — tilde-spelled out-of-project rm | should-fix | Fixture RH-B6 `rm -rf ~/other-project` BLOCK; commit adds home-anchored `~/` targets to the rm target walk |
| Qual **S1** — cross-statement false positive (`rm -rf build && cd /`) | suggestion | Fixture RG-RM-A5 `rm -rf build && cd /` ALLOW; per-statement catastrophic-target scan |
| Qual **S3** — docs omit `prod` / refspec note | suggestion | SKILL.md L66–69: `prod` listed; refspec force-push divergence documented |
| Qual **S4** — stale guard numbers in test comments | suggestion | Commit diff touches the test comment (SQL=13, custom=14) |
| Qual **S5** — routing artifact status `proposed` | suggestion | JSON status now `approved` |
| Qual **S2** — pre-existing full-path rm bypass | noted pre-existing | Subsumed by the F2 fix |

The security review's dimension-5 verdict ("retirement completeness FAIL — coupled to F1/F2") is thereby cured: the retirement's premise ("material 1.0.6 guards absorbed") holds once F1/F2 are closed, and `8ab54c7e6` closes them.

## Scope creep vs in-spirit classification

| Change | Classification | Rationale |
|---|---|---|
| F1/F2 bypass fixes + fixtures (`8ab54c7e6`) | **In-spirit-of-AC1** (required, not creep) | The security review proved upstream 1.0.6 blocks these forms; without the fixes AC1 ("material guards absorbed") is unmet and the retirement premise fails. This IS the spec. |
| W1 tilde hardening, S1 false-positive fix | **In-spirit-of-AC1** | W1 closes an out-of-project delete spelling (parity substance); S1 is anti-overblocking on an absorbed guard — both within the guard-parity mandate. |
| Blocking bare `git checkout .` (exceeds upstream, which allows single-positional) | **In-spec** | The issue body names `git checkout -- <path>` variants; audit row #5 records the deliberate exceed with rationale; "never weaken the net" permits exceeding, forbids weakening. |
| Fail-closed input handling (parse errors → exit 2) | **In-spirit, minor extension** | Not an enumerated AC, but hardens the same hook the spec targets; surfaced for human awareness, no Out-of-Scope section exists to violate. |
| Docs/comment fixes (S3/S4/S5), upstream-evidence-manifest regeneration | **Traceable housekeeping** | Manifest regen is mandated by repo CI for template edits; doc fixes are review-driven. Not creep. |
| Untracked `.lisa/*.md` artifacts, `.playwright-mcp/` | **Not shipped** | Uncommitted working-tree debris; not part of the branch diff. |

**No `SCOPE_CREEP_VIOLATION`:** the issue has no explicit Out of Scope section; its Context note ("other curated overlaps … don't need this treatment") was respected — no changes touch code-simplifier/coderabbit/skill-creator install entries beyond leaving them in place.

## Spec-adequacy note

The issue carries three concrete, testable ACs plus an ordering constraint — adequate. It lacks a formal Validation Journey, mitigated in practice by the empirical security/quality reviews and the fixture matrix.

## Verdict: **PARTIAL** (conforms on content; one evidence gap)

Every AC element maps to concrete shipped work, ordering is honored, must-fix review items are demonstrably resolved in the tree, and there is no scope creep. The single gap is evidentiary, not substantive: **no v2 verification verdict exists for #1960**, and the final 173-fixture matrix at `8ab54c7e6` has no independently captured green run (the last captured run — 138/138 + 53/53 — predates the review-fix commit).

**To upgrade to CONFORMS:** have verification-specialist (or CI) run `bunx vitest run tests/unit/hooks/parity-safety-net-guards.test.ts` plus the regression floor at `8ab54c7e6` and capture the result (ideally as a #1960 v2 verdict in `.lisa/verification-status.json`). Nothing else is outstanding.

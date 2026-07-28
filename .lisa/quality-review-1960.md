# Quality Review — safety-net-guard-parity (#1960)

Reviewer: quality-specialist · Date: 2026-07-22
Commits reviewed: `f02715fa7` (guard absorption), `eeb8f8faf` (upstream plugin retirement)
Branch: `feat/1960-safety-net-guard-parity`

## Verdict

**Approve — no blocking findings.** One warning (a gap in a brand-new guard) and
five suggestions. All claims in both commit messages verified empirically.

## What was verified (all passed)

| Check | Result |
| --- | --- |
| `bunx vitest run tests/unit/hooks/parity-safety-net-guards.test.ts` | **138/138 pass** (22.3s) |
| Claimed 138-fixture count | Confirmed: 119 stateless + 8 git-state table rows + 11 individual tests = 138; no duplicate fixture IDs |
| Claimed 73 block / 65 allow split | Confirmed exactly (68+5 block, 59+6 allow) |
| Regression floor (`parity-safety-net.test.ts`, `parity-safety-net-heredoc.test.ts`, `install-claude-plugins-self.test.ts`) | **53/53 pass** |
| Suite integrity (no skip/only/filter holes) | Clean — `it.each` iterates full exported arrays; no `.skip`/`.only`; every absorbed guard has paired block + near-miss-allow rows |
| Temp-repo hygiene | Clean — `mkdtempSync` + `rmSync(recursive, force)` in `afterAll`; GIT_* stripped wholesale per repo learning; `GIT_CONFIG_GLOBAL/SYSTEM=/dev/null`; custom-rules leakage prevented by pointing `SAFETY_NET_RULES_FILE` at a nonexistent path |
| Fan-out byte-consistency | Hook + heredoc parser byte-identical across `plugins/lisa{,-agy,-copilot,-cursor}` vs `plugins/src/base`; SKILL.md identical everywhere except `.codex-plugin`, whose truncated frontmatter description matches the established Codex build convention (body identical) |
| Settings flips | All **10** templates set `"safety-net@cc-marketplace": false` |
| Retirement mirror vs #1955 | Symmetrical: removed from curated install list, added to the same version-gated retirement loop; test pins all three directions (no install, uninstall on full sync, no uninstall on same-version skip) — exactly matching sentry's assertions |
| Commit conventions | `feat`/`fix` types correct; `Co-Authored-By: Claude` present; `Work-Item:` trailer is the last line (repo requirement) |
| SKILL.md guard list vs implementation | Items 1–14 map 1:1 onto hook guards (one wording gap, see S3) |
| Comment accuracy: physical-path HOME gate (`pwd -P` both sides, macOS `/var` symlink) | Accurate, and genuinely exercised — the test temp dirs live under symlinked `/var/folders`, so canonicalization is what makes HM-B1/HM-A1 pass |
| Comment accuracy: deliberately no `set -E` on the ERR trap | Reasonable and correctly reasoned — errtrace would propagate the exit-2 trap into the heredoc parser's command substitution, whose exit codes 10/20 are protocol |

## Warning (should fix)

### W1. New rm hardening misses tilde-spelled out-of-project paths

- **What:** The new "rm target hardening" guard blocks deleting an absolute
  path outside the project (`rm -rf /Users/someone/other-project` → blocked,
  fixture RH-B4), but the *same directory spelled with a tilde* sails through:
  `rm -rf ~/other-project` → **allowed** (verified empirically, exit 0).
- **Why:** The token walk classifies targets by prefix: `-*` (flag), `.`/`..`,
  `/*` (absolute), `*$*` (variable). A token starting with `~/` matches none
  of those cases, so it falls through to "allowed". The shell expands `~/` to
  the home directory at execution time, so this is exactly the
  "outside-the-project" delete the guard exists to stop. The root-path guard
  above it only catches bare `~`, `~/`, and `~/*` — not `~/name`.
- **Where:** `plugins/src/base/hooks/parity-safety-net.sh:206-234` (the
  `case "$token"` walk in guard 1b); same lines in all four fan-out copies.
- **Fix:** Add a `'~'/*)` case arm (before the fall-through) that blocks like
  the absolute-path arm — a tilde target is home-anchored, never
  project-relative — plus a block/allow fixture pair (e.g. `rm -rf ~/Documents`
  block; keep `rm -rf build` allow). Small, contained change.
- **Blocking?** No. The safety net is defense-in-depth, documented as a
  best-effort text scan; the ticket's named bypasses are all closed and this
  spelling was not in the audit matrix. But it is an asymmetry inside a guard
  this PR introduces, so it should be fixed in a follow-up (or in-PR if cheap).

## Suggestions (nice to have)

### S1. Guard 1's target scan is whole-command, causing a cross-statement false positive

`rm -rf build && cd /` is **blocked** (verified, exit 2): the rm-flags check and
the catastrophic-target check for guard 1 each run over the entire command, so
the harmless `/` in the *second* statement is attributed to the `rm` in the
first. Guard 1b already segments per-statement (`tr '&|;' '\n'`); guard 1 could
reuse that machinery. `plugins/src/base/hooks/parity-safety-net.sh:164-168`.
Overblocking only — never dangerous — and inside the documented text-scan FP
class, so suggestion-level.

### S2. Pre-existing: full-path rm invocations bypass every rm guard

`/bin/rm -rf /` is **allowed** (verified): the `rm` boundary class
`[^[:alnum:]_./-]` deliberately excludes `/`, so `/bin/rm` never reads as an rm
invocation. This predates this PR (identical boundary in the pre-commit hook),
so it is not a regression of this change — noted for a follow-up ticket, per
the investigate-before-changing rule (the `/` exclusion likely prevents FPs on
path arguments containing `…/rm…`). `parity-safety-net.sh:152-153`.

### S3. Docs omit `prod` from the protected-branch list

The force-push regex blocks `main|master|production|prod|release`
(`parity-safety-net.sh:259`), but the hook header (line 15) and the SKILL.md
guard list (item 3, `plugins/src/base/skills/lisa-parity-safety-net-rules/SKILL.md:63`)
say only "main/master/production/release". The regex predates this PR, but the
SKILL.md guard list was written in it — one-word doc fix, docs currently
understate coverage.

### S4. Stale guard numbers in test comments

The fixtures/tests reference the *pre-absorption* hook numbering:
"M4. destructive SQL regressions (guard 4)"
(`tests/helpers/safety-net-guard-fixtures.ts:228`) and "custom rules file
(guard 5)" (`tests/unit/hooks/parity-safety-net-guards.test.ts:98`). In the
shipped hook, SQL is guard 13 and custom rules guard 14. Guards 1–3 still
coincide, which makes the stale ones look authoritative. Renumber or drop the
parenthetical.

### S5. Routing artifact status line still says `proposed`

`parity/plugin-routing/safety-net@cc-marketplace.md:6` reads
"**Status:** `proposed` (flip to `approved` …)" while the paired `.json` says
`"status": "approved"`. Pre-existing mismatch, but the 2026-07-22 re-review
edited the adjacent header lines and left it — worth fixing while touching the
file.

## Notes on things checked and found fine

- Fail-closed behavior: malformed JSON → exit 2 (FC-B1); non-Bash tools and
  empty commands exit 0 early, so fail-closed never over-triggers.
- `read` loop over grep output is safe from the classic missing-final-newline
  bug because grep terminates its output lines.
- `set -f` around the token walk correctly prevents the hook expanding a
  literal `*` against its own cwd, and every `block` path restores `set +f`
  moot anyway since `block` exits.
- Heredoc classifier still exempts gh-writer payloads and blocks executable
  heredocs (HD-A1/HD-B1 smoke-pinned here; deep coverage stays in the
  pre-existing suites, correctly cross-referenced).
- `truncate -s 0 file.log` (coreutils) correctly allowed while SQL `TRUNCATE
  sessions` blocks — the regex distinguishes them as intended.

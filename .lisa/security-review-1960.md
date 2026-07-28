# Security Review — safety-net-guard-parity (CodySwannGT/lisa#1960)

Reviewer: security-specialist. Target commits: `f02715fa7` (absorb guards) and
`eeb8f8faf` (retire upstream plugin). Branch `feat/1960-safety-net-guard-parity`.
Every verdict below was driven against the **real hook**
(`plugins/src/base/hooks/parity-safety-net.sh`, byte-identical to the installed
`plugins/lisa/hooks/…`) and cross-checked against **upstream cc-safety-net 1.0.6**
in hook mode (`node …/cc-safety-net.js hook --claude-code`, decision read from
`.hookSpecificOutput.permissionDecision`). Dangerous strings were base64-encoded
so the live-session hook never saw a raw literal.

This change makes Lisa's hook the **only** Bash screening layer (the upstream
plugin is retired), so any bypass here is now unmitigated in production.

## Verdict per dimension

| # | Dimension | Verdict |
|---|-----------|---------|
| 1 | No guard weakened | **PASS** — every pre-existing guard preserved or strengthened |
| 2 | Bypass hunting (new guards) | **FAIL** — two real-gap families upstream catches, Lisa now misses |
| 3 | Fail-closed correctness | **PASS** — malformed input & missing jq both exit 2 |
| 4 | Overblocking | **PASS (minor)** — documented text-scan false positives, none new/severe |
| 5 | Retirement completeness | **FAIL (coupled to #2)** — retirement removed the net that caught the #2 gaps; the audit never considered those forms, so they are not a conscious skip |

Two **must-fix real-gap** findings (upstream 1.0.6 denies, Lisa allows). Both are
first-class agent workflows, not exotic. Everything else is acceptable-parity or
documented tradeoff.

---

## Security (proven)

### F1 — `git <global-option> <subcommand>` bypasses EVERY git guard  — HIGH / must-fix
- **Where:** guards 2–10 in `parity-safety-net.sh` (L241–345) and the
  segment-splitter greps. Every git guard anchors on `git[[:space:]]+<subcommand>`
  (e.g. `GIT_CHECKOUT='(^|[^[:alnum:]_-])git[[:space:]]+checkout'`, L283). Git's
  *global* options — `-C <path>`, `-c <k>=<v>`, `--git-dir=`, `--work-tree=`,
  `--namespace=`, `-p/--paginate/--no-pager` — legally sit **between** `git` and
  the subcommand, so any of them defeats the anchor and the whole guard family is
  skipped.
- **reproducer (hook exit code / upstream decision):**

  | command | Lisa exit | upstream |
  |---|---|---|
  | `git -C /some/path checkout -- file.ts` | `0` allow | **deny** |
  | `git -C /some/path reset --hard` | `0` allow | **deny** |
  | `git -C /repo clean -fd` | `0` allow | **deny** |
  | `git -C /x branch -D feature` | `0` allow | **deny** |
  | `git -C /repo push --force origin main` | `0` allow | **deny** |
  | `git -C /x switch -f main` | `0` allow | **deny** |
  | `git -C /x restore file.ts` | `0` allow | **deny** |
  | `git -C /x stash clear` | `0` allow | **deny** |
  | `git -C /x worktree remove --force wt` | `0` allow | **deny** |
  | `git -c core.pager=cat checkout -- file.ts` | `0` allow | **deny** |
  | `git --git-dir=/x/.git --work-tree=/x checkout -- file.ts` | `0` allow | **deny** |

  (Lisa exit `0` = ALLOWED; upstream `deny` = blocked. All observed live.)
- **impact:** any agent that discards/resets/cleans/force-pushes **through a
  path** — the dominant pattern in Lisa's worktree-heavy tooling — is completely
  unscreened. `git -C` appears in **1138** Lisa source files
  (`git -C "$path" checkout`, `git -C "$path" push`, `git -C "$path" reset` are all
  real, e.g. lisa-update-projects/worktree flows). A worktree cleanup that resolves
  to `git -C <wt> checkout -- .` or `git -C <wt> reset --hard` silently destroys
  uncommitted work with the net wide open. Also nullifies Lisa's *intended*
  exceed-upstream bare-`.` block (`git -C /path checkout .` → allow on both).
- **reason:** reproducer above + bounded impact (every git guard, any path-form
  invocation) + upstream parity delta (upstream denies all eleven).
- **fix direction:** consume leading git global options before the subcommand
  anchor — a `GIT_GLOBAL_OPTS` fragment matching
  `(-C[[:space:]]+[^;&|[:space:]]+|-c[[:space:]]+[^;&|[:space:]]+|--git-dir=[^;&|[:space:]]+|--work-tree=[^;&|[:space:]]+|--namespace=[^;&|[:space:]]+|-p|--paginate|--no-pager)[[:space:]]+` repeated `*` — inserted between the `git` token and each subcommand. Add block+allow fixtures (`git -C x checkout -- f` block; `git -C x checkout -b feat`, `git -C x status` allow).

### F2 — path-prefixed `rm` (`/bin/rm`, `/usr/bin/rm`, `./rm`) bypasses EVERY rm guard  — HIGH / must-fix
- **Where:** guard 1 flag gates `RM_RF_CLUSTER`/`RM_RF_SPLIT` (L152–153), the
  guard-1b segment splitter (L237–238), and the guard-1b token walk
  (`[ "$token" = "rm" ]`, L203). All identify `rm` with the boundary
  `(^|[^[:alnum:]_./-])rm` whose **preceding-char class excludes `/`, `.`, `-`**.
  So when `rm` is reached via a path (`/bin/rm`, `./rm`), the char before `rm` is
  `/`, the boundary fails, and every rm guard is skipped. The token walk likewise
  compares the token to the literal string `rm`, which `/bin/rm` never equals.
- **reproducer:**

  | command | Lisa exit | upstream |
  |---|---|---|
  | `/bin/rm -rf /` | `0` allow | **deny** |
  | `/usr/bin/rm -rf ~` | `0` allow | **deny** |
  | `/bin/rm -rf /etc` | `0` allow | **deny** |
  | `/bin/rm -rf ../other` | `0` allow | **deny** |
  | `./rm -rf /` | `0` allow | **deny** |
  | `bash -c '/bin/rm -rf /'` | `0` allow | **deny** |

- **impact:** the flagship guard — recursive-forced delete of root/home and the
  #1960 target-hardening (`.`/`..`/outside-project/`$VAR`) — is fully bypassable by
  spelling `rm` with an absolute or relative path. `/bin/rm` is a completely
  ordinary invocation (many scripts use it to dodge shell aliases). The
  quote-aware F1-absorb fix does **not** help: the flag gate itself never matches.
- **reason:** reproducer + bounded impact (all rm guards, common invocation form)
  + upstream denies every case.
- **fix direction:** allow an optional path prefix on the `rm` basename in the
  boundary — e.g. match `(^|[^[:alnum:]_-])([[:alnum:]_./-]*/)?rm([[:space:]]…` —
  and in the token walk strip any leading `*/` before the `rm` equality test
  (`case "$token" in */rm|rm) …`). Apply consistently to CLUSTER, SPLIT, the 1b
  splitter grep, and the token walk. Add fixtures (`/bin/rm -rf /` block;
  `/bin/rm file.txt`, `confirm.sh` allow — don't over-match `…/mrm`/`charm`).

---

## Security (unproven)
_None. Both findings above carry a live reproducer AND a bounded impact._

---

## Acceptable-parity / notes (not failures — parity bar met)

- **N1 — refspec force-push `git push origin +main` is allowed** (Lisa exit `0`).
  `+<ref>` is a force update to a protected branch, but **upstream 1.0.6 also
  allows it** (`upstream=allow`), so parity holds. Worth a follow-up because it
  defeats the *intent* of guard 2; a cheap add would block `git push … +<protected>`
  refspecs. `git push --force origin +main` is still blocked (the `--force` token
  trips guard 2). Classify: acceptable-parity, optional hardening.
- **N2 — display-command false positives (overblocking, documented class).**
  `cat README.md | grep -i 'drop table'` → block (SQL guard, guard 13);
  `echo 'to reset run git reset --hard'` → block when the tree is dirty (guard 3,
  nondeterministic on git state). Both are the header's acknowledged "text scan,
  not a shell engine" tradeoff (upstream exempts these via engine-only
  DISPLAY_COMMANDS). The SQL guard (`\bdrop\s+(database|schema|table)\b`) is the
  broadest — any prose or grep pattern containing "drop table" trips it. Low
  severity and pre-existing (guards 3/13 unchanged by this PR); flagged only
  because the repo rule is "an overblocking net gets disabled." No new
  overblocking was introduced by the absorbed guards — the new allow fixtures
  (node_modules, dist, feature branches, `--force-with-lease`, feature force-push,
  `git clean -n`, `git restore --staged`) all pass.

---

## Dimension detail

### 1. No guard weakened — PASS
Diffed `f02715fa7^` vs `f02715fa7`:
- Guard 1 flag gates (`RM_RF_CLUSTER`/`RM_RF_SPLIT`) **byte-identical**.
- Guard 1 target boundary **strictly widened**: old
  `([[:space:]]|=)(…)([[:space:]]|/?\*?$)` → new adds quote chars to both boundary
  classes (`qc="'\""`), old `=` boundary preserved inside the class. Purely
  additive (closes the quote-adjacency bypass; matches a superset).
- Guard 3 reset **extended** `--hard` → `--(hard|merge)` (more coverage, same
  dirty-tree condition — the documented deliberate divergence, unchanged).
- Force-push (guard 2) and SQL (guard 13) regexes **identical**.
- 138/138 fixtures pass (`bun test …parity-safety-net-guards.test.ts`); two
  pre-existing hook suites remain green. No previously-blocked command now passes.

### 2. Bypass hunting — FAIL
Findings F1, F2 above. Tested and **confirmed still blocked** (no weakness):
`command rm -rf /`, `env FOO=1 rm -rf ~`, `\rm -rf /`, `/usr/bin/git checkout -- f`
(the *git* binary path prefix is fine — only `git`'s own global options break it),
`git --git-dir=… stash clear` (blocked — no global opt before `stash`... note:
`git --git-dir=X stash clear` *was* blocked because `stash` still follows via the
statement, but `git -C X stash clear` is NOT — see F1), tab/multi-space separators
(`git\tcheckout`, `git  checkout`), `GIT_DIR=/x git stash clear`, `git push origin
main -f`, `git push origin HEAD:main --force`, `git branch --delete --force`,
`git worktree remove -f`.

### 3. Fail-closed correctness — PASS
- malformed JSON stdin → **exit 2** (ERR trap fires on jq parse error).
- jq genuinely absent (curated PATH without jq) → **exit 2** (`jq: command not
  found` → ERR trap → deny). The header claim holds.
- non-Bash tool / absent / null `.command` → exit 0 (correct — nothing to screen).
- The `set -e` + `ERR` trap **without** `errtrace` is correct: the heredoc parser's
  protocol exit codes (10/20/…) are read via `parser_status=$?` and the
  `< <(… || true)` process substitutions neutralize grep-no-match under pipefail,
  so no unhandled failure path exits 0. Verified no swallowed-error → allow path.

### 4. Overblocking — PASS (minor, see N2)

### 5. Retirement completeness — FAIL (coupled to #2)
`eeb8f8faf` removes upstream from the curated install list + version-gated
retirement loop and pins `enabledPlugins` false in all ten settings templates
(mechanically sound; self-test pins both directions). But retirement's premise —
"the material 1.0.6 guards are absorbed" — is violated by F1/F2: upstream 1.0.6
**was** denying `git -C … <destructive>` and `/bin/rm -rf /`, and after this ships
nothing does. The audit's false-negative section (F4 "flag reordering: none
found") tested `sudo`/`env`/`command`/`busybox` wrapper prefixes and flag
clustering, but **never** considered git global-option prefixes or path-prefixed
binaries (`grep` of the audit confirms zero mentions of `git -C`, `--git-dir`,
`/bin/rm`, or "path-prefix"). So these are **genuine misses, not conscious skips**
— the deliberately-skip list (paranoid modes, worktree relaxation, awk/parallel
child analysis, audit log) remains correctly opt-in/low-value, but F1/F2 fall
outside it. Fixing F1/F2 restores the retirement's premise.

# Research: upstream cc-safety-net 1.0.6 vs Lisa `parity-safety-net.sh` — Bash-guard parity audit (issue #1960)

Plan: safety-net-guard-parity, task T1. Read-only research deliverable.

## Sources & method

- Upstream engine: `~/.claude/plugins/cache/cc-marketplace/safety-net/1.0.6/dist/bin/cc-safety-net.js`
  (bundled JS, retains `// src/...` module markers). Key modules (bundle line refs):
  - git rule table: `src/core/git/rules.ts` @ L2655
  - rm analyzer + target classifier: `src/core/analyze/rm.ts` @ L2076
  - flag normalizer `hasRecursiveForceFlags`: `src/core/analyze/rm-flags.ts` (L~700)
  - interpreter/one-liner text scan `DANGEROUS_PATTERNS`: @ L683; `dangerousInText`: @ L314
  - `SHELL_WRAPPERS` (bash/sh/zsh/ksh/dash/fish/csh/tcsh) @ L680; `INTERPRETERS` (python/python3/python2/node/ruby/perl) @ L681
  - wrapper strip (sudo/env/command/busybox, env-assignments, `$SHELL`): `stripWrappersWithInfo` @ L1614
  - find/xargs/parallel/awk analyzers @ L1864 / L3783 / L3430 / L386
  - segment orchestrator (recursion ≤10, embedded-command scan): `src/core/analyze/segment.ts` @ L3970
  - env modes: `src/core/env.ts` @ L2037; worktree relaxation: `src/core/git/worktree-relaxation.ts` @ L3239
- Hook registration: `hooks/hooks.json` (PreToolUse matcher `Bash` → `node dist/bin/cc-safety-net.js hook --claude-code`).
- Upstream README: `.../1.0.6/README.md` (capability table L157-168, modes table L174-184).
- Every verdict below was **empirically verified** with the upstream trace CLI
  (`node dist/bin/cc-safety-net.js explain [--json] "<cmd>"`) and Lisa's hook was driven with fake
  PreToolUse payloads (`{"tool_name":"Bash","tool_input":{"command":...}} | bash parity-safety-net.sh`),
  run from `/Users/cody/workspace/lisa`.
- Lisa hook: `plugins/src/base/hooks/parity-safety-net.sh` (guards 1-4 at L97-152, custom-rules L154-165,
  heredoc fail-closed classifier L65-91). Skill doc: `plugins/src/base/skills/lisa-parity-safety-net-rules/SKILL.md`.
  Component inventory: `parity/plugin-routing/safety-net@cc-marketplace.md` (pinned at 0.9.0; cache now holds 1.0.6).

### How upstream works (why naive-regex bypasses fail against it)

Upstream is a **semantic engine**, not a grep: it shell-parses the command, splits into segments
(`;`, `&&`, `||`, `|`, newlines), strips wrapper prefixes (`sudo`, `env`, `command`, `busybox`,
leading `VAR=x` assignments), recurses into `bash|sh|zsh|ksh|dash|fish|csh|tcsh -c '...'` (≤10 deep)
and into `find -exec`, `xargs`, `parallel`, `awk system()`, and interpreter `-c/-e` code args, then
runs per-command analyzers (`git`, `rm`, `find`, `xargs`, `parallel`). It tracks `cd` to know the
effective cwd for the rm policy. Unknown head commands get an *embedded-token scan* (each argv token
checked against the git/rm/find analyzers) unless the head is a known display command (`echo`, `cat`,
`grep`, `rg`, ... — `DISPLAY_COMMANDS` @ L14118-region).

## Master classification table (upstream default-mode guards)

Verdicts: verified via `explain` (upstream) and live hook run (Lisa). "Lisa hook today" refers to
`parity-safety-net.sh` built-ins 1-4.

| # | upstream guard | example blocked (verified) | example near-miss allowed (verified) | Lisa hook today | classification |
|---|---|---|---|---|---|
| 1 | `git checkout -- <path>` | `git checkout -- file.ts` | `git checkout -b feature` | allows (verified) | material-absorb |
| 2 | `git checkout <ref> -- <path>` | `git checkout main -- src/app.ts` | `git checkout main` | allows | material-absorb |
| 3 | `git checkout -f/--force` | `git checkout -f main` | `git checkout main` | allows | material-absorb |
| 4 | `git checkout --pathspec-from-file` | `git checkout --pathspec-from-file=list` | — | allows | material-absorb (bundle with #1) |
| 5 | `git checkout` ≥2 positional args (ambiguous overwrite) | `git checkout feature file.ts` | **`git checkout .` is ALLOWED upstream** (single positional; L2655 `positionalArgs.length >= 2`) | allows both | material-absorb — and exceed upstream by blocking `git checkout .` (issue #1960 names it; it discards the whole tree) |
| 6 | `git switch --discard-changes` / `-f` | `git switch --discard-changes main`, `git switch -f main` | `git switch main` | allows | material-absorb |
| 7 | `git restore` without `--staged` (`--worktree` always) | `git restore file.ts`, `git restore --worktree f` | `git restore --staged file.ts` | allows | material-absorb |
| 8 | `git reset --hard` (unconditional) | `git reset --hard`, `git reset --hard HEAD~1` | `git reset --soft HEAD~1`, `--keep` | **partial**: blocks only on dirty tree (guard 3, L141-146) | already-covered (deliberate divergence: Lisa allows clean-tree resets — keep, but see false-negative note F3) |
| 9 | `git reset --merge` | `git reset --merge` | `git reset --soft` | allows | material-absorb (add to guard 3 with same dirty-tree condition) |
| 10 | `git clean -f` (unless `-n`/`--dry-run`) | `git clean -f`, `git clean -fd` | `git clean -n` | allows | material-absorb |
| 11 | `git push --force` / `-f` on **any** branch | `git push -f origin feature-x` | `git push --force-with-lease origin main` | **partial**: protected branches only (guard 2, L127-136) — `git push --force origin dev` allowed | deliberately-skip full-parity (feature-branch force-push is a sanctioned agent workflow — rebase-and-push; Lisa's protected-branch scoping is an intentional design; document it) |
| 12 | `git branch -D` (delete+force; also `-d -f`) | `git branch -D feature-x`, `git branch -df x` | `git branch -d feature-x` (safe delete) | allows | material-absorb |
| 13 | `git stash drop` / `clear` | `git stash clear`, `git stash drop stash@{0}` | `git stash push`, `git stash pop` | allows | material-absorb |
| 14 | `git worktree remove --force` | `git worktree remove --force wt` | `git worktree remove wt` | allows | material-absorb |
| 15 | `git rebase --abort` | `git rebase --abort` | `git rebase main` | allows | deliberately-skip (standard agent bail-out from a conflicted rebase; blocking it strands agents mid-rebase; discards only in-progress conflict edits) |
| 16 | `git merge --abort` | `git merge --abort` | `git merge main` | allows | deliberately-skip (same rationale as #15) |
| 17 | `git tag -d` | `git tag -d v1.0.0` | `git tag v1.0.0` | allows | material-absorb (cheap ERE) |
| 18 | `git reflog delete` | `git reflog delete HEAD@{1}` | `git reflog expire --expire=now --all` (allowed upstream!) | allows | material-absorb (cheap ERE) |
| 19 | `rm -rf` on root/home | `rm -rf /`, `/*`, `~`, `~/`, `$HOME` | `rm -rf /tmp/x` (temp allowance) | **blocks** (guard 1) — verified all forms | already-covered |
| 20 | flag-order/cluster normalization | `rm -r -f /`, `rm -fr ~`, `rm --recursive --force /` | `rm -r dir` (no force), `rm -f file` (no recursive) | **blocks** — verified `-r -f`, `-fr`, long-flag forms | already-covered |
| 21 | `rm -rf .` / `./` (cwd self-delete) | `rm -rf .`, `rm -rf ./` (upstream `cwd_self_target`, L2076) | `rm -rf ./build` | allows (verified) | material-absorb (issue #1960 names it) |
| 22 | `rm -rf` outside cwd | `rm -rf ../other`, `rm -rf /Users/x/other-project` | `rm -rf build`, `rm -rf /tmp/x` | allows | material-absorb (block `..`-traversal targets and absolute targets outside `${CLAUDE_PROJECT_DIR:-$PWD}` minus /tmp, /var/tmp, $TMPDIR — bash can do prefix checks) |
| 23 | `rm -rf $VAR` (dynamic target) | `rm -rf $DIR` | `rm -rf $TMPDIR/x`, `${TMPDIR}` (temp-var allowance) | allows | material-absorb |
| 24 | `rm -rf` when **cwd is $HOME** | any `rm -rf x` run with cwd=$HOME | same cmd in a project dir | allows | material-absorb (one-line `[ "$PWD" = "$HOME" ]` gate inside guard 1) |
| 25 | wrapper recursion: `bash|sh|zsh|... -c '...'` | `bash -c "rm -rf ~"`, `sh -c "git reset --hard"`, `sh -c "bash -c '...'"` (nested) | `bash -c "rm -rf build"` | **partial**: raw-text grep catches many, but quote-adjacency defeats guard 1's target regex — `bash -c "rm -rf /"` ALLOWED by Lisa (verified; `/` followed by `"` fails `([[:space:]]|/?\*?$)`) | material-absorb via quote-aware boundary fix (see F1) — no engine needed |
| 26 | interpreter one-liners, default mode: `python|python3|python2|node|ruby|perl -c/-e` code arg scanned against `DANGEROUS_PATTERNS` (rm-rf, git reset --hard, git checkout --, git clean -f, git stash drop/clear, `dd ...of=/dev/*`, `mkfs* /dev/*`, `shred`, `find -delete`) + nested shell analysis | `python -c "import os; os.system('rm -rf /')"`, `node -e "...execSync('git reset --hard')"`, `perl -e "system('rm -rf /')"`, `ruby -e "system('git stash clear')"`, `python -c "...os.system('dd if=/dev/zero of=/dev/sda')"` | `python -c "print(1)"`, `python spider.py -c config.yaml` (no code arg), **`python3 -c "import shutil; shutil.rmtree('/')" is ALLOWED upstream** (no shell text — API calls invisible) | **partial**: raw grep sees the text but quote-adjacency again defeats target match — `os.system('rm -rf /')` ALLOWED by Lisa (verified) | material-absorb via same quote-boundary fix (F1). This is DEFAULT-mode upstream behavior, not paranoid — do not confuse with #35 |
| 27 | `find ... -delete` | `find . -delete`, `find . -name '*.tmp' -delete` | `find /tmp -name x -exec rm {} +` (non-recursive child), `echo "find -delete"` (display-command skip) | allows | material-absorb |
| 28 | `find -exec rm -rf` | `find . -name x -exec rm -rf {} \;` | `find . -exec cat {} \;` | allows (target `{}` is not catastrophic, so guard 1 target-check fails) | material-absorb |
| 29 | `xargs rm -rf` (dynamic input) | `xargs rm -rf`, `echo /some/dir \| xargs rm -rf`, `cat list.txt \| xargs rm -rf` | `xargs grep pattern` | allows | material-absorb |
| 30 | `xargs <shell> -c` (arbitrary exec from dynamic input) | `xargs sh -c '...'` | — | allows | deliberately-skip (needs child-command analysis; low marginal value once #29 + F1 land) |
| 31 | GNU `parallel` child analysis | `parallel rm -rf {} :::: files.txt` | `parallel rm -rf ::: a b` (static arg list — ALLOWED upstream) | allows | deliberately-skip (distinguishing static `:::` vs file/stdin input sources is not expressible as a grep; rare in agent workflows) |
| 32 | `awk 'BEGIN{system("...")}'` child analysis (+ dynamic-system fail-closed) | `awk 'BEGIN{system("rm -rf /")}'` | `awk '{print}'` | allows | deliberately-skip (requires awk-code parsing; F1 quote fix incidentally catches the literal-string case above) |
| 33 | wrapper-prefix stripping (`sudo`, `env VAR=x`, `command`, `busybox`) | `sudo rm -rf /`, `env FOO=1 rm -rf ~`, `busybox rm -rf ~` | `sudo apt install x` | **blocks** (raw-text grep is prefix-agnostic — verified all three) | already-covered (incidental) |
| 34 | strict mode: block unparseable commands (`CC_SAFETY_NET_STRICT=1`) | (opt-in) | — | heredoc path already fails closed on ambiguity (L65-91) | deliberately-skip (paranoid/strict opt-in upstream; Lisa's fail-closed heredoc classifier covers the analogous risk) |
| 35 | PARANOID_RM: block `rm -rf` even within cwd (`CC_SAFETY_NET_PARANOID_RM=1`) | `rm -rf build` (paranoid only) | same cmd default-allowed | allows | deliberately-skip (opt-in-only upstream; Lisa operators can add a one-line ERE `rm .*-r` rule via the rules file if a project wants it) |
| 36 | PARANOID_INTERPRETERS: block ALL interpreter one-liners (`CC_SAFETY_NET_PARANOID_INTERPRETERS=1`) | `python -c "print(1)"` (paranoid only) | — | allows | deliberately-skip (opt-in-only upstream; would break routine agent one-liners; rules-file escape hatch exists) |
| 37 | worktree mode: RELAX local git discards in verified linked worktrees (`CC_SAFETY_NET_WORKTREE=1`) | n/a (a relaxation, not a guard) | — | n/a | deliberately-skip (requires stateful worktree verification; Lisa has no discard guards to relax yet — revisit only after absorbing #1-#10) |
| 38 | custom rules: JSON rulebooks, SHA-256-pinned GitHub sources, `rule sync` CLI | — | — | ERE-lines file (`.claude/safety-net-rules.txt`) | deliberately-skip (documented Lisa design decision — SKILL.md L16-30: no npx dependency, auditable flat file, cross-agent) |
| 39 | audit log `~/.cc-safety-net/logs/<session>.jsonl` with secret redaction | — | — | none (reason surfaced to agent via stderr) | deliberately-skip (no log-sink infra; block reason already reaches agent + user; revisit if forensics ever needed) |
| 40 | fail-closed on malformed hook input / invalid config | malformed JSON → deny | — | partial: `set -euo pipefail` makes jq failures exit non-zero, but a non-2 exit is a NON-blocking error in Claude Code | material-absorb (tiny: trap ERR → exit 2 so parse failures deny instead of warn) |

### Upstream surprises worth knowing (verified)

- `git checkout .` is **allowed** upstream (single positional arg). Issue #1960 asks for it — absorbing it means *exceeding* upstream.
- `rm -rf *` (unexpanded glob) is **allowed** upstream (resolves within cwd). **Lisa blocks it** (guard 1 wildcard target) — Lisa is stricter here; keep.
- Top-level `dd if=/dev/zero of=/dev/sda`, `mkfs.ext4 /dev/sda1`, `shred file.txt` are **allowed** upstream — those patterns exist only inside the interpreter-code text scan (L683). Absorbing them as always-on top-level EREs exceeds upstream at trivial cost (see absorb list).
- All SQL (`DROP TABLE/DATABASE/SCHEMA`, `TRUNCATE`) is **allowed** upstream — Lisa guard 4 is Lisa-only value; keep.
- `eval "rm -rf ~"` (quoted single arg) is **allowed** upstream (eval is not in `SHELL_WRAPPERS`; the quoted payload is one token). Unquoted `eval rm -rf ~` is blocked via the embedded-token scan. Lisa's quote-boundary fix (F1) will catch the quoted form too — exceeding upstream.
- `git reflog expire --expire=now --all` (the real reflog nuke) is **allowed** upstream; only `reflog delete` is blocked. Same for `git update-ref -d`, `git filter-branch --force`, `chmod -R 777 /` — all allowed upstream.

## Current-Lisa false-negative check (bypasses upstream would catch)

- **F1 (the big one) — quote adjacency in guard 1's target regex** (L102: `([[:space:]]|=)(target)([[:space:]]|/?\*?$)`): a catastrophic target followed/preceded by a quote char never matches. Verified Lisa-allows / upstream-blocks: `bash -c "rm -rf /"`, `python -c "import os; os.system('rm -rf /')"`, `eval "rm -rf ~"` (upstream misses the eval one too). Fix: add `'"` to both boundary classes. This single regex change closes the wrapper (#25), interpreter (#26), and eval cases at once.
- **F2 — cwd-relative destruction invisible**: `rm -rf .`, `./`, `../other`, absolute paths outside the project — all allowed (rows #21-22).
- **F3 — dirty-tree race in guard 3**: `git reset --hard` is checked against `git status` *at hook time*, in the hook's cwd. A `cd /elsewhere && git reset --hard` or a command that first commits/stashes then resets in a subshell evades the dirty check; upstream blocks unconditionally. Accepted residual risk of the deliberate divergence in row #8 — document it in the hook comment.
- **F4 — flag reordering**: none found. `-r -f`, `-fr`, `--recursive --force`, `sudo`/`env` prefixes all verified blocked. Guard 2 statement-splitting also correctly blocks `git push origin main --force` (trailing flag) and allows `--force-with-lease`.
- **F5 — no-target forms**: `xargs rm -rf`, `find -exec rm -rf {}` have no catastrophic literal target, so guard 1's two-gate design passes them (rows #28-29).

## Recommended absorb list (minimal default-mode parity)

Each item = proposed guard + block/allow fixtures (these become the test table). All always-on unless noted.

1. **git checkout discard family** — block `git checkout -- <anything>`, `git checkout <ref> -- <path>`, `git checkout -f/--force`, `git checkout --pathspec-from-file`, `git checkout .` (exceeds upstream, per #1960).
   Allow: `git checkout -b feature`, `git checkout main`, `git checkout feature-.dotted` (only bare `.`), `git checkout -B branch`.
2. **git switch discard** — block `--discard-changes`, `-f/--force`. Allow `git switch main`, `git switch -c new`.
3. **git restore** — block `git restore <path>` and `--worktree`; allow when `--staged` present without `--worktree` (needs a two-condition bash check like guard 2, not a single ERE — ERE has no lookahead). Allow: `git restore --staged file.ts`.
4. **git stash drop|clear** — block both (any args). Allow `git stash`, `push`, `pop`, `list`, `apply`.
5. **git clean force** — block `-f`/`--force` (incl. clusters `-fd`, `-xfd`); allow `-n`/`--dry-run` even with `-f` absent... allow fixture: `git clean -n`, near-miss `git clean -nd`.
6. **git branch force-delete** — block `-D` and `-d`+`-f`/cluster `-df`; allow `git branch -d x`, `git branch -m x`.
7. **git reset --merge** — add alongside `--hard` in guard 3 (same dirty-tree condition). Allow `git reset --soft/--keep/--mixed`.
8. **git tag -d / git reflog delete / git worktree remove --force** — three cheap EREs. Allow: `git tag v1`, `git reflog`, `git worktree remove wt`.
9. **rm target hardening (extends guard 1)** — additionally block when recursive+force AND target is: `.`/`./` (bare), contains `..` path component, absolute path not under `${CLAUDE_PROJECT_DIR:-$PWD}` and not under `/tmp`,`/var/tmp`,`$TMPDIR`; `$VAR`-containing target other than `$TMPDIR/${TMPDIR}`; plus `[ "$PWD" = "$HOME" ]` gate. Allow: `rm -rf build`, `rm -rf ./build`, `rm -rf /tmp/x`, `rm -rf "$TMPDIR/x"`.
10. **Quote-aware boundaries in guard 1** (F1) — change target boundary classes to include `'` and `"`. Block fixtures: `bash -c "rm -rf /"`, `python -c "import os; os.system('rm -rf /')"`, `eval "rm -rf ~"`. Allow fixture: `echo "docs about rm -rf / go here"`? — NOTE: unlike upstream, a grep hook cannot exempt display commands; accept the echo/grep false-positive (upstream's `DISPLAY_COMMANDS` exemption is engine-only) and document the workaround (quote-breaking or manual run).
11. **find/xargs deletion** — block `find ... -delete`, `find ... -exec rm <recursive+force flags>`, `xargs ... rm <recursive+force flags>`. Allow: `find . -name x -print`, `find /tmp -exec rm {} +` (no recursive flag), `xargs grep x`.
12. **Disk destroyers (exceeds upstream's interpreter-only placement)** — always-on EREs for `dd ...of=/dev/...`, `mkfs[.fs] /dev/...`, `shred <arg>`. Block: `dd if=/dev/zero of=/dev/sda`. Allow: `dd if=a.img of=backup.img`, `dd of=./local.img`.
13. **Fail-closed exit code** — trap parse/jq errors to exit 2 (row #40).

**Paranoid-mode recommendation:** keep `SAFETY_NET_PARANOID_RM` / `SAFETY_NET_PARANOID_INTERPRETERS`
**skipped** (not even env-gated) for now: upstream ships them off-by-default, they would break routine
agent work, and Lisa's per-project ERE rules file is the existing opt-in mechanism for stricter projects.
Revisit only on operator demand. Worktree relaxation likewise skipped until Lisa has the discard guards
it would relax.

## Classification counts

- **already-covered:** 5 (rows 8, 19, 20, 33 + row 11's protected-branch core) — 2 of them deliberate divergences to document (8, 11)
- **material-absorb:** 22 (rows 1-7, 9, 10, 12-14, 17, 18, 21-29 collapsed into absorb items 1-13, 40)
- **deliberately-skip:** 10 (rows 11-full-parity, 15, 16, 30, 31, 32, 34-39) — reasons: opt-in paranoid modes (34-36), stateful-engine-only analysis (30-32, 37), documented design decisions (38, 39), sanctioned agent workflows (11, 15, 16)
- **Lisa-only value upstream lacks (keep):** SQL DROP/TRUNCATE guard, protected-branch semantics, `rm -rf *` wildcard block, heredoc fail-closed classifier, flat ERE rules file.

# Test matrix + draft suite — safety-net guard parity (#1960, task T2)

Plan: safety-net-guard-parity. Input: `.lisa/research-1960-guard-audit.md` (T1 audit) and
`plugins/src/base/hooks/parity-safety-net.sh`. Read-only w.r.t. tracked files — this doc is the
deliverable; the builder lands the real test file on a fresh branch.

## Conventions discovered (existing hook tests)

- Hook tests already exist: `tests/unit/hooks/parity-safety-net.test.ts` (force-push +
  heredoc-prose, ~40 assertions) and `tests/unit/hooks/parity-safety-net-heredoc.test.ts`
  (heredoc grammar). **Do not overwrite them** (test-assertion-preservation rule).
- Runner: **vitest with globals** (`bun run test` → `vitest run`; bare `describe/it/expect`, no
  imports of vitest).
- Subprocess convention in both existing hook suites: **`spawnSync` from `node:child_process`**
  with `input:` = PreToolUse JSON, asserting `.status`. NOT execFile+promisify — see deviations.
- Hook path convention: tests resolve **`plugins/lisa/hooks/parity-safety-net.sh`** (the synced
  plugin copy). It is byte-identical to the source `plugins/src/base/hooks/parity-safety-net.sh`;
  the builder edits the source and must sync every fan-out copy (cursor/agy/copilot per
  stack-per-agent fan-out) **and** regenerate the upstream-evidence manifest
  (`bun run build:upstream-evidence-manifest`) in the same commit.
- Temp-repo git calls must strip `GIT_*` env vars (hook-set `GIT_DIR`/`GIT_WORK_TREE` poison temp
  repos — known repo learning) and pin `GIT_CONFIG_GLOBAL=/dev/null` so host config/hooksPath
  can't leak in.
- All "today" columns below were **empirically probed** in this session by piping fixture JSON to
  the live hook from a temp cwd (probe scripts since removed), or verified in the T1 audit.

## Verdict legend

- expected **block** = hook must exit 2; **allow** = hook must exit 0.
- today **green** = current hook already produces the expected verdict (regression pin);
  **RED** = TDD-red until the corresponding absorb item lands.

---

## 1. Fixture matrix

### A. git checkout discard family (absorb item 1)

| id | command | expected | guard | why the near-miss matters | today |
|----|---------|----------|-------|---------------------------|-------|
| CO-B1 | `git checkout -- file.ts` | block | checkout-discard | canonical single-file discard | RED |
| CO-B2 | `git checkout main -- src/app.ts` | block | checkout-discard | ref+pathspec form evades a naive `-- `-only regex | RED |
| CO-B3 | `git checkout -f main` | block | checkout-discard | force checkout discards local edits | RED |
| CO-B4 | `git checkout --force main` | block | checkout-discard | long-flag alias of CO-B3 | RED |
| CO-B5 | `git checkout --pathspec-from-file=list.txt` | block | checkout-discard | file-driven discard, no `--` in command | RED |
| CO-B6 | `git checkout .` | block | checkout-discard | whole-tree discard; named in #1960; **exceeds upstream** (upstream allows single positional) | RED |
| CO-A1 | `git checkout -b feature` | allow | checkout-discard | branch creation must survive; `-b` is one char from `--` | green |
| CO-A2 | `git checkout main` | allow | checkout-discard | plain branch switch is the everyday case | green |
| CO-A3 | `git checkout -B hotfix` | allow | checkout-discard | force-*create-branch* is not a worktree discard | green |
| CO-A4 | `git checkout feature-.dotted` | allow | checkout-discard | only bare `.` blocks — a `.` inside a ref name must not | green |
| CO-A5 | `git log --oneline -- file.ts` | allow | checkout-discard | ` -- ` pathspec exists on many safe git verbs; guard must anchor on `checkout` | green |

### B. git switch discard (absorb item 2)

| id | command | expected | guard | why the near-miss matters | today |
|----|---------|----------|-------|---------------------------|-------|
| SW-B1 | `git switch --discard-changes main` | block | switch-discard | explicit discard flag | RED |
| SW-B2 | `git switch -f main` | block | switch-discard | short force alias | RED |
| SW-B3 | `git switch --force main` | block | switch-discard | long force alias | RED |
| SW-A1 | `git switch main` | allow | switch-discard | plain switch refuses to overwrite by itself | green |
| SW-A2 | `git switch -c new-branch` | allow | switch-discard | `-c` (create) is one char from `-f` in a careless class | green |

### C. git restore (absorb item 3)

| id | command | expected | guard | why the near-miss matters | today |
|----|---------|----------|-------|---------------------------|-------|
| RS-B1 | `git restore file.ts` | block | restore-worktree | default restore target IS the worktree — silent discard | RED |
| RS-B2 | `git restore --worktree file.ts` | block | restore-worktree | explicit worktree flag | RED |
| RS-B3 | `git restore --staged --worktree file.ts` | block | restore-worktree | `--staged` present but `--worktree` still discards — a "contains --staged → allow" shortcut is wrong | RED |
| RS-B4 | `git restore .` | block | restore-worktree | whole-tree discard | RED |
| RS-A1 | `git restore --staged file.ts` | allow | restore-worktree | unstaging is safe and REQUIRED for agent flows (needs two-condition bash check, not one ERE — audit note) | green |
| RS-A2 | `git restore --staged .` | allow | restore-worktree | bulk unstage is safe; pairs with RS-B4 to prove the split is on flags, not pathspec | green |

### D. git stash drop/clear (absorb item 4)

| id | command | expected | guard | why the near-miss matters | today |
|----|---------|----------|-------|---------------------------|-------|
| ST-B1 | `git stash drop` | block | stash-destroy | drops newest stash | RED |
| ST-B2 | `git stash drop 'stash@{0}'` | block | stash-destroy | arg'd form; braces/quotes must not break the match | RED |
| ST-B3 | `git stash clear` | block | stash-destroy | wipes every stash | RED |
| ST-A1 | `git stash push -m wip` | allow | stash-destroy | stashing is the SAFE alternative the reset guard recommends — must never block | green |
| ST-A2 | `git stash pop` | allow | stash-destroy | pop restores work; only drop/clear destroy | green |
| ST-A3 | `git stash list` | allow | stash-destroy | read-only subcommand | green |
| ST-A4 | `git stash apply` | allow | stash-destroy | non-destructive restore | green |

### E. git clean force (absorb item 5)

| id | command | expected | guard | why the near-miss matters | today |
|----|---------|----------|-------|---------------------------|-------|
| CL-B1 | `git clean -f` | block | clean-force | canonical untracked-file wipe | RED |
| CL-B2 | `git clean -fd` | block | clean-force | cluster with dirs | RED |
| CL-B3 | `git clean -xfd` | block | clean-force | cluster with ignored files (worst case) | RED |
| CL-B4 | `git clean --force` | block | clean-force | long flag | RED |
| CL-A1 | `git clean -n` | allow | clean-force | dry run is the sanctioned preview (required tricky allow) | green |
| CL-A2 | `git clean -nd` | allow | clean-force | dry-run cluster | green |
| CL-A3 | `git clean --dry-run` | allow | clean-force | long dry-run | green |
| CL-A4 | `git clean -fdn` | allow | clean-force | **design decision**: `-n` anywhere wins even with `-f` present (git itself performs no deletion) | green |

### F. git branch force-delete (absorb item 6)

| id | command | expected | guard | why the near-miss matters | today |
|----|---------|----------|-------|---------------------------|-------|
| BR-B1 | `git branch -D feature-x` | block | branch-force-delete | force delete loses unmerged commits | RED |
| BR-B2 | `git branch -df old-branch` | block | branch-force-delete | `-d`+`-f` cluster ≡ `-D` | RED |
| BR-B3 | `git branch -d -f old-branch` | block | branch-force-delete | split-flag form | RED |
| BR-A1 | `git branch -d merged-branch` | allow | branch-force-delete | safe delete refuses unmerged work (required tricky allow) | green |
| BR-A2 | `git branch -m old new` | allow | branch-force-delete | rename is non-destructive; `-m` must not be caught by a sloppy `-[dDf]` class | green |
| BR-A3 | `git branch --delete merged-branch` | allow | branch-force-delete | long safe delete without `--force` | green |

### G. tag / reflog / worktree (absorb item 8)

| id | command | expected | guard | why the near-miss matters | today |
|----|---------|----------|-------|---------------------------|-------|
| TG-B1 | `git tag -d v1.0.0` | block | tag-delete | tags are shared refs | RED |
| TG-B2 | `git reflog delete 'HEAD@{1}'` | block | reflog-delete | erases recovery history | RED |
| TG-B3 | `git worktree remove --force wt` | block | worktree-force-remove | discards a dirty worktree | RED |
| TG-A1 | `git tag v1.0.0` | allow | tag-delete | tag creation | green |
| TG-A2 | `git tag -a v1.0.0 -m release` | allow | tag-delete | `-a`/`-d` are adjacent letters; annotated tag must pass | green |
| TG-A3 | `git reflog` | allow | reflog-delete | read-only default subcommand | green |
| TG-A4 | `git reflog expire --expire=now --all` | allow | reflog-delete | **parity decision**: upstream allows it too; documented residual risk (audit row 18) | green |
| TG-A5 | `git worktree remove wt` | allow | worktree-force-remove | non-force remove refuses dirty worktrees itself | green |

### H. rm target hardening (absorb item 9) — run with cwd = temp project, `CLAUDE_PROJECT_DIR` = same

| id | command | expected | guard | why the near-miss matters | today |
|----|---------|----------|-------|---------------------------|-------|
| RH-B1 | `rm -rf .` | block | rm-hardening | cwd self-delete; named in #1960 | RED |
| RH-B2 | `rm -rf ./` | block | rm-hardening | slash variant of bare `.` | RED |
| RH-B3 | `rm -rf ../sibling-project` | block | rm-hardening | `..` traversal escapes the project | RED |
| RH-B4 | `rm -rf /Users/someone/other-project` | block | rm-hardening | absolute path outside project and outside tmp | RED |
| RH-B5 | `rm -rf $DIR` | block | rm-hardening | unset/typo'd var can expand to anything | RED |
| HM-B1 | `rm -rf projects` *(cwd = $HOME)* | block | rm-hardening | any recursive-force rm with cwd=$HOME is one arg from wiping home | RED |
| RH-A1 | `rm -rf build` | allow | rm-hardening | in-project relative delete is the everyday agent action | green |
| RH-A2 | `rm -rf ./build` | allow | rm-hardening | `./`-prefixed relative — must not be confused with bare `./` | green |
| RH-A3 | `rm -rf ./node_modules` | allow | rm-hardening | required tricky allow; the highest-frequency legit rm | green |
| RH-A4 | `rm -rf /tmp/scratch-dir` | allow | rm-hardening | temp allowance (required tricky allow) | green |
| RH-A5 | `rm -rf "$TMPDIR/cache"` | allow | rm-hardening | `$TMPDIR`/`${TMPDIR}` is the sanctioned dynamic-target exception | green |
| RH-A6 | `rm -rf __PROJECT_DIR__/dist` *(token → real temp project path)* | allow | rm-hardening | absolute path INSIDE the project must pass, proving the check is prefix-based not "any absolute" | green |
| RH-A7 | `rm -rf .cache` | allow | rm-hardening | dot-prefixed relative dir must not match the bare-`.` rule | green |
| HM-A1 | `rm -f notes.txt` *(cwd = $HOME)* | allow | rm-hardening | HOME gate applies only to recursive+force | green |

### I. quote-aware boundaries — verified bypasses (absorb item 10 / F1) — **MUST-BLOCK**

| id | command | expected | guard | why the near-miss matters | today |
|----|---------|----------|-------|---------------------------|-------|
| QB-B1 | `bash -c "rm -rf /"` | block | quote-boundary (guard 1 fix) | verified live bypass: `/` adjacent to `"` defeats the target boundary | RED |
| QB-B2 | `sh -c 'rm -rf ~'` | block | quote-boundary | single-quote variant | RED |
| QB-B3 | `python -c "import os; os.system('rm -rf /')"` | block | quote-boundary | verified live bypass; interpreter one-liner | RED |
| QB-B4 | `node -e "require('child_process').execSync('rm -rf /')"` | block | quote-boundary | node execSync variant | RED |
| QB-B5 | `perl -e "system('rm -rf /')"` | block | quote-boundary | perl system variant | RED |
| QB-B6 | `eval "rm -rf ~"` | block | quote-boundary | quoted eval — **exceeds upstream** (upstream misses it) | RED |
| QB-A1 | `bash -c "rm -rf build"` | allow | quote-boundary | fix must widen the *boundary*, not the *target set* — safe target in quotes stays allowed | green |
| QB-A2 | `python -c "print(1)"` | allow | quote-boundary | routine interpreter one-liner; blocking it breaks agents daily | green |
| QB-A3 | `python spider.py -c config.yaml` | allow | quote-boundary | `-c` as a script's own flag, not a code arg | green |

### J. find / xargs deletion (absorb item 11)

| id | command | expected | guard | why the near-miss matters | today |
|----|---------|----------|-------|---------------------------|-------|
| FX-B1 | `find . -delete` | block | find-delete | tree-wide delete with no rm anywhere | RED |
| FX-B2 | `find . -name '*.tmp' -delete` | block | find-delete | filtered form still deletes recursively | RED |
| FX-B3 | `find . -name x -exec rm -rf {} \;` | block | find-exec-rm | `{}` target defeats guard 1's catastrophic-target gate (audit F5) | RED |
| FX-B4 | `xargs rm -rf` | block | xargs-rm | targets come from dynamic stdin — unauditable | RED |
| FX-B5 | `cat list.txt \| xargs rm -rf` | block | xargs-rm | piped file-driven form | RED |
| FX-B6 | `find /tmp -type d -exec rm -fr {} +` | block | find-exec-rm | `-fr` cluster order + `+` terminator variant | RED |
| FX-A1 | `find . -name x -print` | allow | find-delete | read-only find is constant agent traffic | green |
| FX-A2 | `find /tmp -name x -exec rm {} +` | allow | find-exec-rm | plain `rm` (no recursive+force) on find results is a normal cleanup | green |
| FX-A3 | `xargs grep pattern` | allow | xargs-rm | xargs with a non-destructive child | green |
| FX-A4 | `find . -name pre-delete-backup -print` | allow | find-delete | `-delete` as a *substring of a name arg* must not match | green |
| FX-A5 | `echo a.txt \| xargs rm -f` | allow | xargs-rm | force-but-not-recursive keeps single-file deletes usable | green |

### K. disk destroyers (absorb item 12 — always-on, exceeds upstream placement)

| id | command | expected | guard | why the near-miss matters | today |
|----|---------|----------|-------|---------------------------|-------|
| DD-B1 | `dd if=/dev/zero of=/dev/sda` | block | disk-destroyer | writes zeros over a raw device | RED |
| DD-B2 | `mkfs.ext4 /dev/sda1` | block | disk-destroyer | formats a partition | RED |
| DD-B3 | `mkfs /dev/sdb` | block | disk-destroyer | bare mkfs (no suffix) variant | RED |
| DD-B4 | `shred -u secrets.txt` | block | disk-destroyer | unrecoverable overwrite (upstream DANGEROUS_PATTERNS parity) | RED |
| DD-A1 | `dd if=disk.img of=backup.img` | allow | disk-destroyer | file-to-file dd is legitimate imaging | green |
| DD-A2 | `dd if=/dev/zero of=./local.img` | allow | disk-destroyer | *reading* /dev is fine; only `of=/dev/...` destroys | green |
| DD-A3 | `ls shredder/` | allow | disk-destroyer | `shred` prefix of a longer word — word boundary check | green |
| DD-A4 | `mkfs.ext4 disk.img` | allow | disk-destroyer | mkfs onto an image file, not a device | green |

### L. fail-closed input handling (absorb item 13)

| id | input | expected | guard | why the near-miss matters | today |
|----|-------|----------|-------|---------------------------|-------|
| FC-B1 | stdin = `not json` | block (exit 2) | fail-closed | probed today: exits **5** — a non-2 exit is a NON-blocking hook error, so a parse failure currently fails **open** | RED |
| FC-A1 | `{"tool_name":"Bash","tool_input":{}}` (no command) | allow | fail-closed | valid-but-empty input is a legit no-op, not a parse failure | green |
| FC-A2 | tool_name `Read` with `rm -rf /` as text | allow | fail-closed | non-Bash tools must stay exempt after the trap lands | green |

### M. Pre-existing built-in regressions (nothing may relax)

#### M1. rm -rf root/home/wildcard (guard 1)

| id | command | expected | guard | why the near-miss matters | today |
|----|---------|----------|-------|---------------------------|-------|
| RG-RM-B1 | `rm -rf /` | block | rm-root | canonical | green |
| RG-RM-B2 | `rm -rf ~` | block | rm-root | home tilde | green |
| RG-RM-B3 | `rm -rf $HOME` | block | rm-root | var form | green |
| RG-RM-B4 | `rm -rf ${HOME}` | block | rm-root | braced var form | green |
| RG-RM-B5 | `rm -rf /*` | block | rm-root | root glob | green |
| RG-RM-B6 | `rm -rf *` | block | rm-root | bare wildcard — **Lisa is stricter than upstream here; keep** | green |
| RG-RM-B7 | `rm -fr ~` | block | rm-root | reversed cluster | green |
| RG-RM-B8 | `rm -r -f /` | block | rm-root | split flags | green |
| RG-RM-B9 | `rm --recursive --force /` | block | rm-root | long flags (probed green) | green |
| RG-RM-B10 | `sudo rm -rf /` | block | rm-root | wrapper prefix (probed green) | green |
| RG-RM-B11 | `env FOO=1 rm -rf ~` | block | rm-root | env-assignment prefix | green |
| RG-RM-A1 | `rm -r dir` | allow | rm-root | recursive without force | green |
| RG-RM-A2 | `rm -f file.txt` | allow | rm-root | force without recursive | green |
| RG-RM-A3 | `rm file.txt` | allow | rm-root | plain rm | green |
| RG-RM-A4 | `rm -rf build && echo done` | allow | rm-root | safe target inside a chain | green |

#### M2. protected-branch force-push (guard 2) — deep coverage stays in the EXISTING suite

| id | command | expected | guard | why the near-miss matters | today |
|----|---------|----------|-------|---------------------------|-------|
| RG-FP-B1 | `git push --force origin main` | block | force-push | canonical | green |
| RG-FP-B2 | `git push -f origin master` | block | force-push | short flag + master | green |
| RG-FP-A1 | `git push --force-with-lease origin main` | allow | force-push | required tricky allow — the sanctioned safe alternative; contains the literal substring `--force` | green |
| RG-FP-A2 | `git push --force origin feature/experiment` | allow | force-push | **deliberate divergence from upstream** (audit row 11): feature-branch force-push is a sanctioned rebase workflow | green |
| RG-FP-A3 | `git push origin main` | allow | force-push | non-force push to protected | green |

#### M3. dirty-tree reset guards (guard 3 + absorb item 7) — temp git repo fixtures

| id | repo state | command | expected | guard | why the near-miss matters | today |
|----|-----------|---------|----------|-------|---------------------------|-------|
| GS-B1 | dirty | `git reset --hard` | block | reset-dirty | canonical discard of uncommitted work | green |
| GS-B2 | dirty | `git reset --hard HEAD~1` | block | reset-dirty | ref'd form | green |
| GS-B3 | dirty | `git reset --merge` | block | reset-dirty (absorb 7) | `--merge` discards like `--hard`; same dirty-tree condition | RED |
| GS-A1 | clean | `git reset --hard` | allow | reset-dirty | **pins the deliberate divergence**: clean-tree resets are a legit workflow (audit row 8; residual risk F3 documented, not tested) | green |
| GS-A2 | clean | `git reset --merge` | allow | reset-dirty | new `--merge` arm must inherit the same dirty-only condition | green |
| GS-A3 | dirty | `git reset --soft HEAD~1` | allow | reset-dirty | soft reset preserves the worktree | green |
| GS-A4 | dirty | `git reset --keep` | allow | reset-dirty | `--keep` aborts rather than discard | green |
| GS-A5 | dirty | `git reset --mixed HEAD` | allow | reset-dirty | mixed reset unstages but keeps edits | green |

#### M4. destructive SQL (guard 4 — Lisa-only value)

| id | command | expected | guard | why the near-miss matters | today |
|----|---------|----------|-------|---------------------------|-------|
| RG-SQL-B1 | `psql -c 'DROP TABLE users;'` | block | sql | canonical | green |
| RG-SQL-B2 | `mysql -e 'TRUNCATE sessions'` | block | sql | truncate without TABLE keyword | green |
| RG-SQL-B3 | `echo 'DROP DATABASE prod' \| psql` | block | sql | piped SQL | green |
| RG-SQL-B4 | `psql -c 'DROP SCHEMA public CASCADE'` | block | sql | schema form | green |
| RG-SQL-B5 | `psql -c 'TRUNCATE TABLE audit_log'` | block | sql | TRUNCATE TABLE form | green |
| RG-SQL-A1 | `truncate -s 0 file.log` | allow | sql | **coreutils `truncate`** — probed allow today (flag `-s` breaks the identifier match); pin it so an SQL-guard tweak never blocks log truncation | green |
| RG-SQL-A2 | `echo drop tables gently` | allow | sql | plural `tables` defeats the word boundary — prose stays allowed (probed) | green |
| RG-SQL-A3 | `git branch -d drop-table-migration` | allow | sql | hyphenated identifier is not SQL; also exercises safe branch delete | green |

#### M5. custom ERE rules file (guard 5)

| id | rules-file content | command | expected | why | today |
|----|--------------------|---------|----------|-----|-------|
| CR-B1 | `terraform[[:space:]]+destroy` | `terraform destroy -auto-approve` | block | operator-extensible rules keep working | green |
| CR-A1 | same | `terraform plan` | allow | rule specificity respected | green |
| CR-B2 | `# comment` + blank line + `FORBIDDEN_TOKEN` | `echo FORBIDDEN_TOKEN` | block | comments/blank lines skipped, later rules still active | green |
| CR-A2 | same | `echo safe output` | allow | non-matching command passes | green |

#### M6. heredoc classifier (deep coverage stays in the two EXISTING suites) — smoke only

| id | command | expected | why | today |
|----|---------|----------|-----|-------|
| HD-A1 | `gh issue create --body-file - <<'EOF'` + `rm -rf /` + `EOF` | allow | gh-writer prose exemption must survive the F1 quote fix (payload is stripped *before* guards) | green |
| HD-B1 | `bash <<'EOF'` + `rm -rf /` + `EOF` | block | executable heredoc stays visible to guards | green |

### N. Documented accepted false-positives — **NOT asserted in the suite**

Grep hooks cannot replicate upstream's engine-only `DISPLAY_COMMANDS` exemption (audit item 10
note). These rows are documentation, not fixtures — either verdict is acceptable and the builder
must not "fix" them at the cost of any MUST-BLOCK row:

| command | today | note |
|---------|-------|------|
| `echo "docs about rm -rf / here"` | already blocked | space-bounded FP predates F1 (probed this session); workaround = quote-breaking or gh-writer heredoc |
| `git commit -m "docs: explain git stash drop"` | will block once item 4 lands | workaround = `git commit -F <file>` (same remediation the heredoc block teaches) |

---

## 2. Draft vitest suite

Target path for the builder: **`tests/unit/hooks/parity-safety-net-guards.test.ts`** (NEW file —
`parity-safety-net.test.ts` already exists and must be preserved; see deviations). Data-driven:
the tables above ARE the `…_FIXTURES` arrays below, so matrix and suite cannot drift.

```typescript
/**
 * Guard-parity fixture matrix for parity-safety-net.sh (issue #1960).
 *
 * Drives the REAL hook via a bash subprocess with PreToolUse JSON on stdin and
 * asserts the exit code per fixture: 2 = blocked, 0 = allowed. Every absorbed
 * upstream guard has paired block + near-miss-allow fixtures (anti-
 * overblocking), and every pre-existing built-in guard has regression fixtures
 * so nothing relaxes. Source matrix: .lisa/test-matrix-1960.md (task T2).
 *
 * Deep force-push and heredoc coverage lives in parity-safety-net.test.ts and
 * parity-safety-net-heredoc.test.ts — this suite only smoke-pins those.
 * @module tests/unit/hooks/parity-safety-net-guards
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const HOOK_PATH = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");
const BASH_PATH = "/bin/bash";
const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;
/** Replaced at runtime with the temp project dir (for in-project absolute rm). */
const PROJECT_DIR_TOKEN = "__PROJECT_DIR__";
const HEREDOC_TERMINATOR = "EOF";

type Verdict = "allow" | "block";

interface GuardFixture {
  readonly id: string;
  readonly command: string;
  readonly expected: Verdict;
  readonly guard: string;
}

/**
 * Hook-managed GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE poison git subprocesses
 * in temp repos (known repo learning), so every spawn strips GIT_* wholesale.
 */
const strippedEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
  );

const runHookRaw = (
  input: string,
  options: { cwd: string; env?: NodeJS.ProcessEnv }
): { status: number | null; stderr: string } => {
  const result = spawnSync(BASH_PATH, [HOOK_PATH], {
    cwd: options.cwd,
    encoding: "utf-8",
    env: {
      ...strippedEnv(),
      CLAUDE_PROJECT_DIR: options.cwd,
      // Point at a path that does not exist so project-local custom rules
      // cannot leak into built-in guard assertions.
      SAFETY_NET_RULES_FILE: path.join(options.cwd, "no-rules-here.txt"),
      ...options.env,
    },
    input,
  });
  return { status: result.status, stderr: result.stderr };
};

const runHook = (
  command: string,
  options: { cwd: string; env?: NodeJS.ProcessEnv }
): { status: number | null; stderr: string } =>
  runHookRaw(
    JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    options
  );

const expectedStatus = (verdict: Verdict): number =>
  verdict === "block" ? EXIT_BLOCKED : EXIT_ALLOWED;

/** Runs git in a fixture repo with host config and hook-set GIT_* neutralized. */
const gitIn = (cwd: string, ...args: readonly string[]): void => {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf-8",
    env: {
      ...strippedEnv(),
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
};

/** Creates a one-commit repo; when dirty=true, leaves an uncommitted edit. */
const makeRepo = (root: string, name: string, dirty: boolean): string => {
  const dir = path.join(root, name);
  mkdirSync(dir);
  gitIn(dir, "init", "--initial-branch=main");
  gitIn(dir, "config", "user.email", "safety-net-test@lisa.dev");
  gitIn(dir, "config", "user.name", "Lisa Safety Net Test");
  writeFileSync(path.join(dir, "README.md"), "seed\n");
  gitIn(dir, "add", "README.md");
  gitIn(dir, "commit", "-m", "seed");
  if (dirty) {
    writeFileSync(path.join(dir, "README.md"), "seed\nuncommitted edit\n");
  }
  return dir;
};

const STATELESS_FIXTURES: readonly GuardFixture[] = [
  // A. git checkout discard family (absorb 1)
  { id: "CO-B1", command: "git checkout -- file.ts", expected: "block", guard: "checkout-discard" },
  { id: "CO-B2", command: "git checkout main -- src/app.ts", expected: "block", guard: "checkout-discard" },
  { id: "CO-B3", command: "git checkout -f main", expected: "block", guard: "checkout-discard" },
  { id: "CO-B4", command: "git checkout --force main", expected: "block", guard: "checkout-discard" },
  { id: "CO-B5", command: "git checkout --pathspec-from-file=list.txt", expected: "block", guard: "checkout-discard" },
  { id: "CO-B6", command: "git checkout .", expected: "block", guard: "checkout-discard" },
  { id: "CO-A1", command: "git checkout -b feature", expected: "allow", guard: "checkout-discard" },
  { id: "CO-A2", command: "git checkout main", expected: "allow", guard: "checkout-discard" },
  { id: "CO-A3", command: "git checkout -B hotfix", expected: "allow", guard: "checkout-discard" },
  { id: "CO-A4", command: "git checkout feature-.dotted", expected: "allow", guard: "checkout-discard" },
  { id: "CO-A5", command: "git log --oneline -- file.ts", expected: "allow", guard: "checkout-discard" },
  // B. git switch discard (absorb 2)
  { id: "SW-B1", command: "git switch --discard-changes main", expected: "block", guard: "switch-discard" },
  { id: "SW-B2", command: "git switch -f main", expected: "block", guard: "switch-discard" },
  { id: "SW-B3", command: "git switch --force main", expected: "block", guard: "switch-discard" },
  { id: "SW-A1", command: "git switch main", expected: "allow", guard: "switch-discard" },
  { id: "SW-A2", command: "git switch -c new-branch", expected: "allow", guard: "switch-discard" },
  // C. git restore (absorb 3)
  { id: "RS-B1", command: "git restore file.ts", expected: "block", guard: "restore-worktree" },
  { id: "RS-B2", command: "git restore --worktree file.ts", expected: "block", guard: "restore-worktree" },
  { id: "RS-B3", command: "git restore --staged --worktree file.ts", expected: "block", guard: "restore-worktree" },
  { id: "RS-B4", command: "git restore .", expected: "block", guard: "restore-worktree" },
  { id: "RS-A1", command: "git restore --staged file.ts", expected: "allow", guard: "restore-worktree" },
  { id: "RS-A2", command: "git restore --staged .", expected: "allow", guard: "restore-worktree" },
  // D. git stash drop/clear (absorb 4)
  { id: "ST-B1", command: "git stash drop", expected: "block", guard: "stash-destroy" },
  { id: "ST-B2", command: "git stash drop 'stash@{0}'", expected: "block", guard: "stash-destroy" },
  { id: "ST-B3", command: "git stash clear", expected: "block", guard: "stash-destroy" },
  { id: "ST-A1", command: "git stash push -m wip", expected: "allow", guard: "stash-destroy" },
  { id: "ST-A2", command: "git stash pop", expected: "allow", guard: "stash-destroy" },
  { id: "ST-A3", command: "git stash list", expected: "allow", guard: "stash-destroy" },
  { id: "ST-A4", command: "git stash apply", expected: "allow", guard: "stash-destroy" },
  // E. git clean force (absorb 5)
  { id: "CL-B1", command: "git clean -f", expected: "block", guard: "clean-force" },
  { id: "CL-B2", command: "git clean -fd", expected: "block", guard: "clean-force" },
  { id: "CL-B3", command: "git clean -xfd", expected: "block", guard: "clean-force" },
  { id: "CL-B4", command: "git clean --force", expected: "block", guard: "clean-force" },
  { id: "CL-A1", command: "git clean -n", expected: "allow", guard: "clean-force" },
  { id: "CL-A2", command: "git clean -nd", expected: "allow", guard: "clean-force" },
  { id: "CL-A3", command: "git clean --dry-run", expected: "allow", guard: "clean-force" },
  { id: "CL-A4", command: "git clean -fdn", expected: "allow", guard: "clean-force" },
  // F. git branch force-delete (absorb 6)
  { id: "BR-B1", command: "git branch -D feature-x", expected: "block", guard: "branch-force-delete" },
  { id: "BR-B2", command: "git branch -df old-branch", expected: "block", guard: "branch-force-delete" },
  { id: "BR-B3", command: "git branch -d -f old-branch", expected: "block", guard: "branch-force-delete" },
  { id: "BR-A1", command: "git branch -d merged-branch", expected: "allow", guard: "branch-force-delete" },
  { id: "BR-A2", command: "git branch -m old new", expected: "allow", guard: "branch-force-delete" },
  { id: "BR-A3", command: "git branch --delete merged-branch", expected: "allow", guard: "branch-force-delete" },
  // G. tag / reflog / worktree (absorb 8)
  { id: "TG-B1", command: "git tag -d v1.0.0", expected: "block", guard: "tag-delete" },
  { id: "TG-B2", command: "git reflog delete 'HEAD@{1}'", expected: "block", guard: "reflog-delete" },
  { id: "TG-B3", command: "git worktree remove --force wt", expected: "block", guard: "worktree-force-remove" },
  { id: "TG-A1", command: "git tag v1.0.0", expected: "allow", guard: "tag-delete" },
  { id: "TG-A2", command: "git tag -a v1.0.0 -m release", expected: "allow", guard: "tag-delete" },
  { id: "TG-A3", command: "git reflog", expected: "allow", guard: "reflog-delete" },
  { id: "TG-A4", command: "git reflog expire --expire=now --all", expected: "allow", guard: "reflog-delete" },
  { id: "TG-A5", command: "git worktree remove wt", expected: "allow", guard: "worktree-force-remove" },
  // H. rm target hardening (absorb 9) — cwd/CLAUDE_PROJECT_DIR = temp project
  { id: "RH-B1", command: "rm -rf .", expected: "block", guard: "rm-hardening" },
  { id: "RH-B2", command: "rm -rf ./", expected: "block", guard: "rm-hardening" },
  { id: "RH-B3", command: "rm -rf ../sibling-project", expected: "block", guard: "rm-hardening" },
  { id: "RH-B4", command: "rm -rf /Users/someone/other-project", expected: "block", guard: "rm-hardening" },
  { id: "RH-B5", command: "rm -rf $DIR", expected: "block", guard: "rm-hardening" },
  { id: "RH-A1", command: "rm -rf build", expected: "allow", guard: "rm-hardening" },
  { id: "RH-A2", command: "rm -rf ./build", expected: "allow", guard: "rm-hardening" },
  { id: "RH-A3", command: "rm -rf ./node_modules", expected: "allow", guard: "rm-hardening" },
  { id: "RH-A4", command: "rm -rf /tmp/scratch-dir", expected: "allow", guard: "rm-hardening" },
  { id: "RH-A5", command: 'rm -rf "$TMPDIR/cache"', expected: "allow", guard: "rm-hardening" },
  { id: "RH-A6", command: `rm -rf ${PROJECT_DIR_TOKEN}/dist`, expected: "allow", guard: "rm-hardening" },
  { id: "RH-A7", command: "rm -rf .cache", expected: "allow", guard: "rm-hardening" },
  // I. quote-aware boundaries — verified bypasses (absorb 10 / F1)
  { id: "QB-B1", command: 'bash -c "rm -rf /"', expected: "block", guard: "quote-boundary" },
  { id: "QB-B2", command: "sh -c 'rm -rf ~'", expected: "block", guard: "quote-boundary" },
  { id: "QB-B3", command: "python -c \"import os; os.system('rm -rf /')\"", expected: "block", guard: "quote-boundary" },
  { id: "QB-B4", command: "node -e \"require('child_process').execSync('rm -rf /')\"", expected: "block", guard: "quote-boundary" },
  { id: "QB-B5", command: "perl -e \"system('rm -rf /')\"", expected: "block", guard: "quote-boundary" },
  { id: "QB-B6", command: 'eval "rm -rf ~"', expected: "block", guard: "quote-boundary" },
  { id: "QB-A1", command: 'bash -c "rm -rf build"', expected: "allow", guard: "quote-boundary" },
  { id: "QB-A2", command: 'python -c "print(1)"', expected: "allow", guard: "quote-boundary" },
  { id: "QB-A3", command: "python spider.py -c config.yaml", expected: "allow", guard: "quote-boundary" },
  // J. find / xargs deletion (absorb 11)
  { id: "FX-B1", command: "find . -delete", expected: "block", guard: "find-delete" },
  { id: "FX-B2", command: "find . -name '*.tmp' -delete", expected: "block", guard: "find-delete" },
  { id: "FX-B3", command: "find . -name x -exec rm -rf {} \\;", expected: "block", guard: "find-exec-rm" },
  { id: "FX-B4", command: "xargs rm -rf", expected: "block", guard: "xargs-rm" },
  { id: "FX-B5", command: "cat list.txt | xargs rm -rf", expected: "block", guard: "xargs-rm" },
  { id: "FX-B6", command: "find /tmp -type d -exec rm -fr {} +", expected: "block", guard: "find-exec-rm" },
  { id: "FX-A1", command: "find . -name x -print", expected: "allow", guard: "find-delete" },
  { id: "FX-A2", command: "find /tmp -name x -exec rm {} +", expected: "allow", guard: "find-exec-rm" },
  { id: "FX-A3", command: "xargs grep pattern", expected: "allow", guard: "xargs-rm" },
  { id: "FX-A4", command: "find . -name pre-delete-backup -print", expected: "allow", guard: "find-delete" },
  { id: "FX-A5", command: "echo a.txt | xargs rm -f", expected: "allow", guard: "xargs-rm" },
  // K. disk destroyers (absorb 12)
  { id: "DD-B1", command: "dd if=/dev/zero of=/dev/sda", expected: "block", guard: "disk-destroyer" },
  { id: "DD-B2", command: "mkfs.ext4 /dev/sda1", expected: "block", guard: "disk-destroyer" },
  { id: "DD-B3", command: "mkfs /dev/sdb", expected: "block", guard: "disk-destroyer" },
  { id: "DD-B4", command: "shred -u secrets.txt", expected: "block", guard: "disk-destroyer" },
  { id: "DD-A1", command: "dd if=disk.img of=backup.img", expected: "allow", guard: "disk-destroyer" },
  { id: "DD-A2", command: "dd if=/dev/zero of=./local.img", expected: "allow", guard: "disk-destroyer" },
  { id: "DD-A3", command: "ls shredder/", expected: "allow", guard: "disk-destroyer" },
  { id: "DD-A4", command: "mkfs.ext4 disk.img", expected: "allow", guard: "disk-destroyer" },
  // M1. rm root/home/wildcard regressions (guard 1)
  { id: "RG-RM-B1", command: "rm -rf /", expected: "block", guard: "rm-root" },
  { id: "RG-RM-B2", command: "rm -rf ~", expected: "block", guard: "rm-root" },
  { id: "RG-RM-B3", command: "rm -rf $HOME", expected: "block", guard: "rm-root" },
  { id: "RG-RM-B4", command: "rm -rf ${HOME}", expected: "block", guard: "rm-root" },
  { id: "RG-RM-B5", command: "rm -rf /*", expected: "block", guard: "rm-root" },
  { id: "RG-RM-B6", command: "rm -rf *", expected: "block", guard: "rm-root" },
  { id: "RG-RM-B7", command: "rm -fr ~", expected: "block", guard: "rm-root" },
  { id: "RG-RM-B8", command: "rm -r -f /", expected: "block", guard: "rm-root" },
  { id: "RG-RM-B9", command: "rm --recursive --force /", expected: "block", guard: "rm-root" },
  { id: "RG-RM-B10", command: "sudo rm -rf /", expected: "block", guard: "rm-root" },
  { id: "RG-RM-B11", command: "env FOO=1 rm -rf ~", expected: "block", guard: "rm-root" },
  { id: "RG-RM-A1", command: "rm -r dir", expected: "allow", guard: "rm-root" },
  { id: "RG-RM-A2", command: "rm -f file.txt", expected: "allow", guard: "rm-root" },
  { id: "RG-RM-A3", command: "rm file.txt", expected: "allow", guard: "rm-root" },
  { id: "RG-RM-A4", command: "rm -rf build && echo done", expected: "allow", guard: "rm-root" },
  // M2. force-push regressions (guard 2) — deep coverage in parity-safety-net.test.ts
  { id: "RG-FP-B1", command: "git push --force origin main", expected: "block", guard: "force-push" },
  { id: "RG-FP-B2", command: "git push -f origin master", expected: "block", guard: "force-push" },
  { id: "RG-FP-A1", command: "git push --force-with-lease origin main", expected: "allow", guard: "force-push" },
  { id: "RG-FP-A2", command: "git push --force origin feature/experiment", expected: "allow", guard: "force-push" },
  { id: "RG-FP-A3", command: "git push origin main", expected: "allow", guard: "force-push" },
  // M4. destructive SQL regressions (guard 4)
  { id: "RG-SQL-B1", command: "psql -c 'DROP TABLE users;'", expected: "block", guard: "sql" },
  { id: "RG-SQL-B2", command: "mysql -e 'TRUNCATE sessions'", expected: "block", guard: "sql" },
  { id: "RG-SQL-B3", command: "echo 'DROP DATABASE prod' | psql", expected: "block", guard: "sql" },
  { id: "RG-SQL-B4", command: "psql -c 'DROP SCHEMA public CASCADE'", expected: "block", guard: "sql" },
  { id: "RG-SQL-B5", command: "psql -c 'TRUNCATE TABLE audit_log'", expected: "block", guard: "sql" },
  { id: "RG-SQL-A1", command: "truncate -s 0 file.log", expected: "allow", guard: "sql" },
  { id: "RG-SQL-A2", command: "echo drop tables gently", expected: "allow", guard: "sql" },
  { id: "RG-SQL-A3", command: "git branch -d drop-table-migration", expected: "allow", guard: "sql" },
];

interface GitStateFixture extends GuardFixture {
  readonly repo: "clean" | "dirty";
}

const GIT_STATE_FIXTURES: readonly GitStateFixture[] = [
  { id: "GS-B1", repo: "dirty", command: "git reset --hard", expected: "block", guard: "reset-dirty" },
  { id: "GS-B2", repo: "dirty", command: "git reset --hard HEAD~1", expected: "block", guard: "reset-dirty" },
  { id: "GS-B3", repo: "dirty", command: "git reset --merge", expected: "block", guard: "reset-dirty" },
  { id: "GS-A1", repo: "clean", command: "git reset --hard", expected: "allow", guard: "reset-dirty" },
  { id: "GS-A2", repo: "clean", command: "git reset --merge", expected: "allow", guard: "reset-dirty" },
  { id: "GS-A3", repo: "dirty", command: "git reset --soft HEAD~1", expected: "allow", guard: "reset-dirty" },
  { id: "GS-A4", repo: "dirty", command: "git reset --keep", expected: "allow", guard: "reset-dirty" },
  { id: "GS-A5", repo: "dirty", command: "git reset --mixed HEAD", expected: "allow", guard: "reset-dirty" },
];

describe("parity-safety-net.sh — guard parity matrix (#1960)", () => {
  let workRoot: string;
  let projectDir: string;

  beforeAll(() => {
    workRoot = mkdtempSync(path.join(tmpdir(), "lisa-safety-guards-"));
    projectDir = path.join(workRoot, "project");
    mkdirSync(projectDir);
  });

  afterAll(() => {
    rmSync(workRoot, { recursive: true, force: true });
  });

  describe("built-in guards (stateless fixtures)", () => {
    it.each(STATELESS_FIXTURES)("$id [$expected] $command", (fixture) => {
      const command = fixture.command.replaceAll(
        PROJECT_DIR_TOKEN,
        projectDir
      );
      const { status, stderr } = runHook(command, { cwd: projectDir });
      expect(
        status,
        `${fixture.id} (${fixture.guard}) expected ${fixture.expected}; stderr: ${stderr}`
      ).toBe(expectedStatus(fixture.expected));
    });
  });

  describe("rm hardening when cwd is $HOME (absorb 9 HOME gate)", () => {
    it("HM-B1 blocks a recursive forced delete run from $HOME", () => {
      const { status } = runHook("rm -rf projects", {
        cwd: projectDir,
        env: { HOME: projectDir },
      });
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("HM-A1 allows a non-recursive delete run from $HOME", () => {
      const { status } = runHook("rm -f notes.txt", {
        cwd: projectDir,
        env: { HOME: projectDir },
      });
      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("dirty/clean working-tree reset guards (guard 3 + absorb 7)", () => {
    let cleanRepo: string;
    let dirtyRepo: string;

    beforeAll(() => {
      cleanRepo = makeRepo(workRoot, "clean-repo", false);
      dirtyRepo = makeRepo(workRoot, "dirty-repo", true);
    });

    it.each(GIT_STATE_FIXTURES)(
      "$id [$expected] $command in $repo repo",
      (fixture) => {
        const cwd = fixture.repo === "dirty" ? dirtyRepo : cleanRepo;
        const { status, stderr } = runHook(fixture.command, { cwd });
        expect(
          status,
          `${fixture.id} in ${fixture.repo} repo expected ${fixture.expected}; stderr: ${stderr}`
        ).toBe(expectedStatus(fixture.expected));
      }
    );
  });

  describe("project-local custom rules file (guard 5)", () => {
    let rulesPath: string;

    beforeAll(() => {
      rulesPath = path.join(workRoot, "custom-rules.txt");
      writeFileSync(
        rulesPath,
        [
          "# comment lines are ignored",
          "",
          "terraform[[:space:]]+destroy",
          "FORBIDDEN_TOKEN",
          "",
        ].join("\n")
      );
    });

    const withRules = (command: string): number | null =>
      runHook(command, {
        cwd: projectDir,
        env: { SAFETY_NET_RULES_FILE: rulesPath },
      }).status;

    it("CR-B1 blocks a command matching a custom ERE", () => {
      expect(withRules("terraform destroy -auto-approve")).toBe(EXIT_BLOCKED);
    });

    it("CR-A1 allows the near-miss of the custom ERE", () => {
      expect(withRules("terraform plan")).toBe(EXIT_ALLOWED);
    });

    it("CR-B2 applies rules that follow comments and blank lines", () => {
      expect(withRules("echo FORBIDDEN_TOKEN")).toBe(EXIT_BLOCKED);
    });

    it("CR-A2 allows a command matching no rule", () => {
      expect(withRules("echo safe output")).toBe(EXIT_ALLOWED);
    });
  });

  describe("fail-closed input handling (absorb 13)", () => {
    it("FC-B1 denies (exit 2) on malformed hook JSON", () => {
      const { status } = runHookRaw("not json", { cwd: projectDir });
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("FC-A1 allows valid input with no command field", () => {
      const input = JSON.stringify({ tool_name: "Bash", tool_input: {} });
      expect(runHookRaw(input, { cwd: projectDir }).status).toBe(EXIT_ALLOWED);
    });

    it("FC-A2 ignores non-Bash tools even with destructive text", () => {
      const input = JSON.stringify({
        tool_name: "Read",
        tool_input: { command: "rm -rf /" },
      });
      expect(runHookRaw(input, { cwd: projectDir }).status).toBe(EXIT_ALLOWED);
    });
  });

  describe("heredoc classifier smoke regressions", () => {
    it("HD-A1 still exempts a gh-writer prose heredoc quoting rm -rf /", () => {
      const command = [
        "gh issue create --body-file - <<'EOF'",
        "rm -rf /",
        HEREDOC_TERMINATOR,
      ].join("\n");
      expect(runHook(command, { cwd: projectDir }).status).toBe(EXIT_ALLOWED);
    });

    it("HD-B1 still blocks an executable heredoc containing rm -rf /", () => {
      const command = [
        "bash <<'EOF'",
        "rm -rf /",
        HEREDOC_TERMINATOR,
      ].join("\n");
      expect(runHook(command, { cwd: projectDir }).status).toBe(EXIT_BLOCKED);
    });
  });
});
```

Builder notes on the suite:

- **RH/HM fixtures encode the absorb-9 policy**: cwd + `CLAUDE_PROJECT_DIR` are both the temp
  project dir, so "absolute inside project" (RH-A6) and "absolute outside project" (RH-B4) are
  distinguishable; `/tmp` (RH-A4) and `$TMPDIR` (RH-A5) are the temp allowances.
- **Stateless fixtures run in a non-git cwd** so guard 3 (`git status` at hook time) stays inert
  and cannot make e.g. QB fixtures state-dependent.
- Fixture strings are **data on stdin only** — nothing in the suite executes them. Note for the
  builder's own session: composing these strings inline in Bash tool calls trips the live
  safety-net hook; keep them in the test file / fixture data.
- TDD sequence: land this suite first (expect exactly the 50 RED fixtures below to fail), then
  the hook change, then re-run — RED count must reach 0 with zero regressions among the greens.

---

## 3. Coverage assertion

**Totals: 138 fixtures — 73 block / 65 allow.** Every absorb item 1–13 has ≥1 block and ≥1
paired near-miss allow; every pre-existing built-in has regression rows.

| guard (absorb item) | block | allow | red today |
|---|---|---|---|
| checkout-discard (1) | 6 | 5 | 6 |
| switch-discard (2) | 3 | 2 | 3 |
| restore-worktree (3) | 4 | 2 | 4 |
| stash-destroy (4) | 3 | 4 | 3 |
| clean-force (5) | 4 | 4 | 4 |
| branch-force-delete (6) | 3 | 3 | 3 |
| reset --merge (7, in GS table) | 1 | 2 | 1 (GS-B3) |
| tag/reflog/worktree (8) | 3 | 5 | 3 |
| rm-hardening (9, incl. HOME gate) | 6 | 8 | 6 |
| quote-boundary bypasses (10/F1) | 6 | 3 | 6 |
| find/xargs (11) | 6 | 5 | 6 |
| disk-destroyer (12) | 4 | 4 | 4 |
| fail-closed (13) | 1 | 2 | 1 |
| REGRESSION rm-root (guard 1) | 11 | 4 | 0 |
| REGRESSION force-push (guard 2) | 2 | 3 | 0 |
| REGRESSION reset-dirty (guard 3, GS table) | 2 | 3 | 0 |
| REGRESSION sql (guard 4) | 5 | 3 | 0 |
| REGRESSION custom rules (guard 5) | 2 | 2 | 0 |
| REGRESSION heredoc smoke | 1 | 1 | 0 |
| **Total** | **73** | **65** | **50** |

### Audit fixtures dropped, merged, or reclassified (with reason)

1. **Audit item 10's allow proposal `echo "docs about rm -rf / go here"` → moved to the
   unasserted documented-FP table.** Probed this session: it is *already blocked today*
   (space-bounded `/` matches guard 1 pre-F1), so asserting "allow" would be red against current
   behavior and asserting "block" would pin a false positive as contract. Documented instead.
2. **`rm -rf ${TMPDIR}` variant merged into RH-A5** (`"$TMPDIR/cache"`) — same allowance branch;
   the braced form adds no distinct regex path worth a row.
3. **Empty-stdin fixture dropped** from item 13 — jq on empty input yields empty `tool_name` →
   exit 0 today; whether that should become fail-closed is a spec question the audit didn't
   answer. Only *malformed parse* (FC-B1) is asserted.
4. **No fixtures for deliberately-skipped rows** (`xargs sh -c`, GNU parallel, awk `system()`,
   `rebase/merge --abort`, paranoid modes, worktree relaxation, full-parity feature-branch
   force-push) — matching the audit's skip decisions; RG-FP-A2 positively pins the
   feature-branch-force-push *divergence* as allowed.
5. **`git reflog expire --expire=now --all` kept as ALLOW** (TG-A4) per the audit's parity
   decision, even though it is the more destructive reflog operation — documented residual risk.
6. **Audit's `sh -c "git reset --hard"` bypass example not included** — its verdict depends on
   working-tree state at hook runtime (guard 3 dirty-check), making it nondeterministic in the
   stateless table; the QB rows cover the F1 quote-boundary mechanism deterministically via rm
   targets, and F3 remains a documented accepted residual risk.

### Design decisions that deviate from the task brief

1. **`spawnSync` instead of `execFile`+promisify** — both existing hook suites
   (`parity-safety-net.test.ts`, `parity-safety-net-heredoc.test.ts`) use `spawnSync` with
   `input:`; matching existing conventions beats the brief's suggestion, and exit-code assertions
   need no async plumbing.
2. **New file `tests/unit/hooks/parity-safety-net-guards.test.ts`**, not
   `parity-safety-net.test.ts` — that path already exists with ~40 heredoc/force-push assertions
   that must be preserved, not overwritten.
3. **`SAFETY_NET_RULES_FILE` points at a nonexistent temp path** rather than an empty temp file —
   the hook's `[ -f ]` skips either way and nothing needs creating; the custom-rules describe
   overrides it with a real file.
4. **Added a "today" column** (green/RED) beyond the requested columns so the builder knows the
   exact expected RED set (50) before touching the hook.
5. **CL-A4 `git clean -fdn` → allow** is a policy call the audit's garbled wording implied but
   didn't state: `-n` anywhere wins because git itself performs no deletion under `--dry-run`.

---
name: lisa-parity-safety-net-rules
description: "View, set, and verify the custom guard rules enforced by Lisa's safety-net PreToolUse Bash hook (parity-safety-net.sh). The consolidated cross-agent equivalent of the upstream safety-net plugin's set-custom-rules + verify-custom-rules skills — manages a project-local list of extended-regex patterns that block destructive shell commands, on Codex, agy, Copilot, Cursor, and Claude."
allowed-tools: ["Read", "Edit", "Write", "Bash"]
synced-from: safety-net@cc-marketplace@1.0.6
---

# Parity Safety-Net Rules

Manage the **custom guard rules** that Lisa's safety-net hook enforces on every
Bash command. The hook (`hooks/parity-safety-net.sh`, registered as a
`PreToolUse` matcher on `Bash`) ships with built-in guards against catastrophic
commands; this skill lets a project **view**, **set**, and **verify** *additional*
project-specific rules on top of those built-ins.

> **Lisa-native reimplementation.** Upstream 0.9.0 shipped two rule-management
> skills (`set-custom-rules` + `verify-custom-rules`), which this skill
> consolidates. Upstream 1.0.6 consolidated them too (into `cc-safety-net`) and
> moved custom rules to a JSON rulebook system driven by the
> `npx cc-safety-net rule` CLI. Lisa **deliberately keeps** its simpler
> ERE-lines-file design: the Lisa hook must run identically on Codex, agy,
> Copilot, Cursor, and Claude without an npx dependency, and a flat regex file
> is auditable in any of those runtimes. It is reimplemented from scratch
> against Lisa conventions — it does **not** port or invoke upstream plugin
> code.
>
> **Drift tracking.** Pinned to `safety-net@cc-marketplace@1.0.6`.
> `scripts/plugin-parity-drift.mjs` compares this pin against the upstream
> version in the plugin cache and flags staleness. **Do not port or copy upstream
> plugin code.**

## How the rules work

- The hook always enforces its **built-in guards** (see below). These cannot be
  disabled from the rules file — they are the floor.
- **Custom rules** live in a project-local file, one **POSIX extended regular
  expression (ERE)** per line. Blank lines and lines beginning with `#` are
  ignored. Matching is case-insensitive (`grep -Ei`).
- If *any* built-in guard or custom rule matches the proposed command, the hook
  exits non-zero and the Bash call is **blocked**, with the reason shown to the
  agent.

### Rules file location

Resolved in this order:

1. `$SAFETY_NET_RULES_FILE` (explicit override), else
2. `${CLAUDE_PROJECT_DIR:-$PWD}/.claude/safety-net-rules.txt`

```bash
RULES_FILE="${SAFETY_NET_RULES_FILE:-${CLAUDE_PROJECT_DIR:-$PWD}/.claude/safety-net-rules.txt}"
```

### Built-in guards (always on)

1. `rm -rf` of a filesystem root, `$HOME`/`~`, or a top-level wildcard — with
   quote-aware boundaries, so wrapper/interpreter forms like
   `bash -c "rm -rf /"` and `python -c "… os.system('rm -rf /')"` match too.
   Path-prefixed spellings (`/bin/rm`, `./rm`) count as `rm` for every rm
   guard.
2. `rm -rf` target hardening: the cwd itself (`.`/`./`), `..`-traversal paths,
   home-anchored `~/…` paths, absolute paths outside the project (`/tmp`,
   `/var/tmp`, and `$TMPDIR` are allowed), `$VAR` targets other than `$TMPDIR`,
   and **any** recursive forced delete while the working directory is `$HOME`.
3. Force-pushing a protected branch
   (`main`/`master`/`production`/`prod`/`release`). `--force-with-lease` is
   intentionally allowed, and so is force-pushing a feature branch (sanctioned
   rebase workflow). Acceptable parity divergence: a refspec force-push
   (`git push origin +main`) is not blocked — upstream 1.0.6 allows it too.
4. `git reset --hard` / `git reset --merge` while the working tree is **dirty**
   (would discard work). Clean-tree resets are intentionally allowed.
5. `git checkout` discards: the `--` pathspec form (with or without a ref),
   `-f`/`--force`, `--pathspec-from-file`, and bare `git checkout .`.
   Branch switching and `-b`/`-B` creation stay allowed.
6. `git switch --discard-changes` / `-f`/`--force`.
7. `git restore` touching the worktree — only `git restore --staged <path>`
   without `--worktree` is allowed (unstaging is safe).
8. `git stash drop` / `git stash clear` (push/pop/list/apply stay allowed).
9. `git clean` with a force flag and no dry-run — `-n`/`--dry-run` anywhere
   makes it a safe preview.
10. `git branch -D` (or `-d` combined with `-f`, clustered or split);
    safe `-d` and rename `-m` stay allowed.
11. `git tag -d`, `git reflog delete`, `git worktree remove --force`.
12. Deletion via `find … -delete`, `find … -exec rm -rf`, and `xargs … rm -rf`
    (plain non-recursive `rm` on find/xargs output stays allowed).
13. Disk destroyers: `dd of=/dev/…`, `mkfs … /dev/…`, `shred`.
14. Destructive SQL — `DROP DATABASE/SCHEMA/TABLE`, `TRUNCATE TABLE`.

Every git guard sees through leading git **global options** (`-C <path>`,
`-c <k>=<v>`, `--git-dir[=…]`, `--no-pager`, …), so `git -C /path <destructive>`
is screened the same as `git <destructive>`.

Malformed hook input fails **closed** (exit 2 denies the command). A text-scan
hook cannot exempt display commands, so prose like
`echo "docs about rm -rf /"` can false-positive — quote-break the string or use
the gh-writer heredoc form (payload is stripped before the guards run).

## View the current rules

```bash
RULES_FILE="${SAFETY_NET_RULES_FILE:-${CLAUDE_PROJECT_DIR:-$PWD}/.claude/safety-net-rules.txt}"
if [ -f "$RULES_FILE" ]; then
  echo "Custom safety-net rules ($RULES_FILE):"
  grep -vE '^[[:space:]]*(#|$)' "$RULES_FILE" || echo "(no active rules)"
else
  echo "No custom rules file yet ($RULES_FILE). Only built-in guards are active."
fi
```

`Read` the file to show comments and structure as well.

## Set (add or edit) a rule

A rule is an ERE matched against the full command string. Keep rules **specific**
to avoid blocking legitimate work — anchor on the dangerous verb and its target.

1. Ensure the file exists, then **append** a commented rule (use `Edit`/`Write`,
   or append from the shell):

   ```bash
   RULES_FILE="${SAFETY_NET_RULES_FILE:-${CLAUDE_PROJECT_DIR:-$PWD}/.claude/safety-net-rules.txt}"
   mkdir -p "$(dirname "$RULES_FILE")"
   {
     echo "# Block deleting a Kubernetes namespace"
     echo 'kubectl[[:space:]]+delete[[:space:]]+namespace'
   } >> "$RULES_FILE"
   ```

2. **Always verify** the new rule (next section) before considering it set —
   confirm it blocks what it should and allows what it shouldn't.

Editing/removing: open the file with `Edit` and change or delete the line.
Removing a rule never affects the built-in guards.

## Verify the rules

Two checks — both should pass before you trust a rule.

### 1. The ERE is valid

An invalid regex would make the hook error on every command. Validate it:

```bash
printf '%s' "$RULE" | grep -Eq -- "$RULE" 2>/dev/null && echo "valid ERE" \
  || echo "INVALID ERE — fix before saving"
```

### 2. The rule behaves as intended

Drive the **actual hook** with a fake `PreToolUse` payload and assert the exit
code (non-zero = blocked, 0 = allowed). Build the JSON with `jq` so the test
command line itself never contains the dangerous literal:

```bash
HOOK="${CLAUDE_PLUGIN_ROOT}/hooks/parity-safety-net.sh"

check() { # check <expect: block|allow> <command>
  jq -nc --arg c "$2" '{tool_name:"Bash",tool_input:{command:$c}}' \
    | bash "$HOOK" >/dev/null 2>&1
  local code=$?
  local got=allow; [ "$code" -ne 0 ] && got=block
  printf '%-5s want=%-5s got=%-5s  %s\n' \
    "$([ "$got" = "$1" ] && echo OK || echo FAIL)" "$1" "$got" "$2"
}

# Should block (matches the new rule):
check block "kubectl delete namespace prod"
# Should allow (must not over-match):
check allow "kubectl get pods"
```

Report a table of cases with want/got/verdict. If any case disagrees, tighten the
ERE and re-verify.

## Rules

- **Built-in guards are the floor** — custom rules only *add* blocks; they cannot
  weaken the built-ins.
- **Prefer specific over broad** — a rule that blocks too much trains users to
  bypass the safety net. Anchor on verb + target.
- **Verify every rule against the real hook** before saving — never ship an
  unverified or syntactically invalid ERE.
- **Never weaken the net to unblock yourself.** If a built-in guard fires on a
  command that is genuinely safe, run it manually outside the agent after the
  user confirms — do not edit the hook to remove the guard.

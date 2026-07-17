#!/usr/bin/env bash
# PreToolUse hook for Bash: a safety net that blocks destructive shell commands
# before they run. Lisa-native reimplementation of the upstream
# `safety-net@cc-marketplace` plugin's PreToolUse Bash-guard (parity work, issue
# #1059). It does NOT port upstream code — it re-expresses the behavior in Lisa's
# hook conventions, modeled on block-no-verify.sh.
#
# It reads the hook stdin JSON, inspects the proposed Bash command, and EXITS
# NON-ZERO (2) to BLOCK when a known-destructive pattern matches:
#   - `rm -rf /` (recursive forced delete of a root / home / wildcard path)
#   - force-pushing a protected branch (main/master/production/release)
#   - `git reset --hard` while the working tree is dirty (would discard work)
#   - dropping or truncating a database/schema/table
# Otherwise it exits 0 and the command proceeds.
#
# Operators extend the built-in rules with a project-local rule file — one
# extended-regex (ERE) per line, blank lines and `#` comments ignored — managed
# by the parity-safety-net-rules skill. Default location (overridable via
# SAFETY_NET_RULES_FILE):
#   ${CLAUDE_PROJECT_DIR:-$PWD}/.claude/safety-net-rules.txt
set -euo pipefail

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"
if [ "$tool_name" != "Bash" ]; then
  exit 0
fi

command_str="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"
if [ -z "$command_str" ]; then
  exit 0
fi

command_for_guards="$command_str"
if command -v python3 >/dev/null 2>&1; then
  command_for_guards="$(SAFETY_NET_COMMAND="$command_str" python3 - <<'PY'
import os
import re

command = os.environ.get("SAFETY_NET_COMMAND", "")


def strip_heredocs(text: str) -> str:
    lines = text.splitlines()
    output = []
    pending = []
    # Quoted strings are matched (and thereby skipped over) as plain,
    # non-capturing alternatives BEFORE the heredoc-marker alternative gets a
    # chance to run, so a "<<MARKER"-looking sequence inside a string literal
    # (e.g. `echo "hello <<MARKER"`) is never mistaken for a real heredoc
    # start. Only the heredoc-marker alternative captures a group.
    marker_pattern = re.compile(
        r'"(?:\\.|[^"])*"|\'[^\']*\''
        r"|<<-?\s*(?:'([^']+)'|\"([^\"]+)\"|([A-Za-z_][A-Za-z0-9_]*))"
    )
    index = 0
    while index < len(lines):
        line = lines[index]
        output.append(line)
        pending.extend(
            next(group for group in match.groups() if group)
            for match in marker_pattern.finditer(line)
            if any(match.groups())
        )
        index += 1
        # Consume every pending heredoc body in order (chained same-line
        # heredocs, e.g. `cat <<A <<B`, push more than one marker at once).
        # Do NOT stop after the first terminator — dropping the `break` lets
        # this loop keep dropping body lines until each pending marker is
        # matched, instead of leaking the second body back into `output`
        # where the destructive-pattern guards would see it.
        while pending and index < len(lines):
            if lines[index].strip() == pending[0]:
                output.append(lines[index])
                pending.pop(0)
            index += 1
    return "\n".join(output)


print(strip_heredocs(command), end="")
PY
)"
fi

# block() prints the reason to stderr (surfaced to the model) and exits 2 so the
# Bash tool call is denied. $1 = human-readable reason for the block.
block() {
  cat >&2 <<EOF
Blocked by safety-net: $1

This command matched a destructive-operation guard. If it is genuinely safe and
intentional, ask the user to confirm, then run it manually outside the agent, or
narrow the command so it no longer matches the guard.
EOF
  exit 2
}

# 1. Recursive forced delete (`rm -rf`) of a filesystem root, home, or top-level
#    wildcard. Two gates ANDed: the command must invoke `rm` with BOTH a
#    recursive and a force flag, AND name a catastrophic target. Splitting the
#    flag check from the target check keeps each regex legible and testable.
if printf '%s' "$command_for_guards" \
  | grep -Eiq '(^|[^[:alnum:]_./-])rm([[:space:]]+-[[:alnum:]-]+)*[[:space:]]+(-[[:alnum:]]*r[[:alnum:]]*f|-[[:alnum:]]*f[[:alnum:]]*r)([[:space:]]|$)' \
  || printf '%s' "$command_for_guards" \
  | grep -Eiq '(^|[^[:alnum:]_./-])rm[[:space:]].*(-r\b.*[[:space:]]-f\b|-f\b.*[[:space:]]-r\b|--recursive\b.*--force\b|--force\b.*--recursive\b)'; then
  if printf '%s' "$command_for_guards" \
    | grep -Eq '([[:space:]]|=)(/|/\*|/\.\*?|~|~/\*?|\$HOME\b|\$\{HOME\}|\*)([[:space:]]|/?\*?$)'; then
    block "recursive forced delete of a root, home, or wildcard path (rm -rf)"
  fi
fi

# 2. Force-pushing a protected branch. `--force-with-lease` is the safe,
#    non-clobbering alternative and is intentionally NOT blocked.
#
#    The force flag AND the protected-branch name must appear in the SAME
#    `git push` statement. Checking them independently over the whole command is
#    a false-positive magnet: an unrelated `-f` (a `[ -f file ]` test, `rm -f`,
#    `grep -f`, `tail -f`) plus an unrelated protected name (`--base main`,
#    `origin/main`, `git fetch origin main`) alongside any feature-branch
#    `git push` would wrongly block. So split the command into statements
#    (`;`, `&&`, `||`, `|`, newlines), keep only the `git push` segments, and
#    inspect each in isolation — a real `git push --force origin main` still
#    matches, while a feature-branch push next to `[ -f ]`/`--base main` passes.
# Normalize bash line-continuations (a trailing backslash + newline → space)
# before segmenting the command. Without this, "git push --force origin
# \<newline>main" splits into a segment matching --force but not `main`, letting a
# protected force-push slip past. Uses awk (POSIX) instead of a GNU-only
# `sed ':a;N;$!ba;…'`, which errors on BSD sed (macOS) and there silently no-ops.
normalized_command_str="$(printf '%s' "$command_for_guards" \
  | awk '{ if (sub(/\\$/, "")) printf "%s ", $0; else print }')"

while IFS= read -r push_stmt; do
  if printf '%s' "$push_stmt" \
    | grep -Eiq '(--force([[:space:]]|=|$)|[[:space:]]-f([[:space:]]|$))' \
    && ! printf '%s' "$push_stmt" | grep -Eiq -- '--force-with-lease' \
    && printf '%s' "$push_stmt" \
    | grep -Eiq '(^|[^[:alnum:]_/-])(main|master|production|prod|release)([^[:alnum:]_/-]|$)'; then
    block "force-pushing a protected branch (use --force-with-lease, or push a feature branch)"
  fi
done < <(printf '%s' "$normalized_command_str" | tr '&|;' '\n' \
  | grep -Ei '(^|[^[:alnum:]_-])git[[:space:]]+push\b')

# 3. `git reset --hard` while the working tree has uncommitted changes — this
#    silently discards them. Only blocks when the tree is actually dirty, so a
#    clean-tree reset (a legitimate workflow) still passes.
if printf '%s' "$command_for_guards" | grep -Eiq '(^|[^[:alnum:]_-])git[[:space:]]+reset\b.*--hard\b'; then
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    && [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    block "git reset --hard on a dirty working tree would discard uncommitted changes (stash or commit first)"
  fi
fi

# 4. Dropping or truncating a database / schema / table.
if printf '%s' "$command_for_guards" \
  | grep -Eiq '\b(drop[[:space:]]+(database|schema|table)|truncate[[:space:]]+(table[[:space:]]+)?[[:alnum:]_."`]+)\b'; then
  block "destructive SQL (DROP/TRUNCATE) detected"
fi

# 5. Project-local custom rules. Each non-comment line is an ERE; a match blocks.
rules_file="${SAFETY_NET_RULES_FILE:-${CLAUDE_PROJECT_DIR:-$PWD}/.claude/safety-net-rules.txt}"
if [ -f "$rules_file" ]; then
  while IFS= read -r rule || [ -n "$rule" ]; do
    case "$rule" in
      '' | '#'*) continue ;;
    esac
    if printf '%s' "$command_for_guards" | grep -Eiq -- "$rule"; then
      block "matched a project custom safety rule (${rules_file##*/}): $rule"
    fi
  done <"$rules_file"
fi

exit 0

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

# Heredoc payloads are data only for a deliberately narrow set of GitHub CLI
# write commands. A companion parser proves that shape before removing payload
# text from the destructive-command scans below. Unknown executable heredocs
# remain visible to every built-in and custom rule. Ambiguous or malformed
# heredocs fail closed instead of guessing which text the shell would execute.
#
# block_heredoc() teaches the remediation the moment the wall is hit: heredoc
# denials overwhelmingly come from `git commit -m "$(cat <<EOF …)"` attempts,
# and a bare denial strands the agent with no path forward (gardener #1789).
block_heredoc() {
  block "$1
Heredoc commit invocations are blocked (the payload is executable shell).
Fix: write the commit message to a file and run \`git commit -F <file>\`.
Every commit must also carry a Co-authored-by trailer for a supported agent
(Claude/Codex/OpenCode) — the commit-msg hook enforces this."
}

command_for_guards="$command_str"
case "$command_str" in
  *'<<'*)
    hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    heredoc_parser="$hook_dir/parity-safety-net-heredoc.py"
    if ! command -v python3 >/dev/null 2>&1 || [ ! -r "$heredoc_parser" ]; then
      block_heredoc "cannot safely classify heredoc command because its parser runtime is unavailable"
    fi
    if ! printf '%s\n' "$command_str" | /bin/bash -n >/dev/null 2>&1; then
      block_heredoc "malformed heredoc command failed shell syntax validation"
    fi

    parser_status=0
    if parser_output="$(printf '%s' "$command_str" | python3 "$heredoc_parser" 2>/dev/null)"; then
      parser_status=0
    else
      parser_status=$?
    fi

    case "$parser_status" in
      0) command_for_guards="$parser_output" ;;
      10) command_for_guards="$command_str" ;;
      20) block_heredoc "malformed or ambiguous heredoc command cannot be safely classified" ;;
      *) block_heredoc "heredoc parser failed; command was denied fail-closed" ;;
    esac
    ;;
esac

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

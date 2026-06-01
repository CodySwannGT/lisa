#!/usr/bin/env bash
# Lisa-managed Codex hook script (PreToolUse Bash).
# Blocks git commands that bypass verification hooks: the --no-verify long flag,
# HUSKY=0 / HUSKY_SKIP_HOOKS= (disables husky hooks), and core.hooksPath pointed
# at /dev/null or set empty (disables all git hooks). The short `-n` form is
# intentionally NOT matched (parity with block-no-verify.sh / .agy.sh): grep
# cannot distinguish it from -n in commit-message prose or an unrelated piped
# command, and -n is far more common than --no-verify.
set -euo pipefail

input="$(cat 2>/dev/null || true)"
[ -n "$input" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null || true)"
[ "$tool_name" = "Bash" ] || exit 0

command_str="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -n "$command_str" ] || exit 0

if printf '%s' "$command_str" | grep -Eq '(^|[^[:alnum:]_-])--no-verify($|[^[:alnum:]_-])' \
  || printf '%s' "$command_str" | grep -Eq '(^|[^[:alnum:]_-])HUSKY=0($|[^[:alnum:]])' \
  || printf '%s' "$command_str" | grep -Eq '(^|[^[:alnum:]_-])HUSKY_SKIP_HOOKS=' \
  || printf '%s' "$command_str" | grep -Eq 'core\.hooksPath([[:space:]]*=)?[[:space:]]*/dev/null' \
  || printf '%s' "$command_str" | grep -Eq 'core\.hooksPath[[:space:]]*=[[:space:]]*($|[[:space:];&|"'\''])'; then
  jq -n '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": "Blocked: this command bypasses pre-commit/pre-push hooks (--no-verify, HUSKY=0, or core.hooksPath disabling). Fix the underlying issue or ask the user before bypassing."
    }
  }'
fi

exit 0

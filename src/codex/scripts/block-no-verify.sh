#!/usr/bin/env bash
# Lisa-managed Codex hook script (PreToolUse Bash).
# Blocks git commands that bypass verification hooks: the --no-verify long flag,
# HUSKY=0 / HUSKY_SKIP_HOOKS= (disables husky hooks), and core.hooksPath pointed
# at /dev/null or set empty (disables all git hooks). Shell-token matching
# avoids false positives from issue bodies, heredocs, and commit-message prose
# while still catching quoted real argv values such as
# `git -c "core.hooksPath=/dev/null"`.
set -euo pipefail

input="$(cat 2>/dev/null || true)"
[ -n "$input" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null || true)"
[ "$tool_name" = "Bash" ] || exit 0

command_str="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -n "$command_str" ] || exit 0

command -v python3 >/dev/null 2>&1 || exit 0

if ! BLOCK_NO_VERIFY_COMMAND="$command_str" python3 - <<'PY'
import os
import re
import shlex
import sys

command = os.environ.get("BLOCK_NO_VERIFY_COMMAND", "")


def strip_heredocs(text: str) -> str:
    lines = text.splitlines()
    output = []
    pending = []
    marker_pattern = re.compile(
        r"<<-?\s*(?:'([^']+)'|\"([^\"]+)\"|([A-Za-z_][A-Za-z0-9_]*))"
    )
    index = 0
    while index < len(lines):
        line = lines[index]
        output.append(line)
        pending.extend(
            next(group for group in match.groups() if group)
            for match in marker_pattern.finditer(line)
        )
        index += 1
        while pending and index < len(lines):
            if lines[index].strip() == pending[0]:
                output.append(lines[index])
                pending.pop(0)
                index += 1
                break
            index += 1
    return "\n".join(output)


try:
    tokens = shlex.split(strip_heredocs(command), posix=True)
except ValueError:
    sys.exit(0)

normalized_tokens = [token.strip("();|&") for token in tokens]

for i, token in enumerate(normalized_tokens):
    if token == "--no-verify":
        sys.exit(1)
    if token == "HUSKY=0" or token.startswith("HUSKY_SKIP_HOOKS="):
        sys.exit(1)
    if token.startswith("core.hooksPath="):
        value = token.split("=", 1)[1]
        if value in ("", "/dev/null"):
            sys.exit(1)
    if token == "core.hooksPath" and i + 1 < len(normalized_tokens) and normalized_tokens[i + 1] in ("", "/dev/null"):
        sys.exit(1)

sys.exit(0)
PY
then
  jq -n '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": "Blocked: this command bypasses pre-commit/pre-push hooks (--no-verify, HUSKY=0, or core.hooksPath disabling). Fix the underlying issue (security audit, lint, typecheck, tests, formatting) instead. If a fix is genuinely impossible, ask the user to make the risk-acceptance decision and add a specific documented ignore; never bypass the hook."
    }
  }'
fi

exit 0

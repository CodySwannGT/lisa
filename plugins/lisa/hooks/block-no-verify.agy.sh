#!/usr/bin/env bash
# Antigravity (agy) PreToolUse hook: blocks shell commands that bypass Lisa's
# git quality gates (exact parity with the Claude block-no-verify.sh): the
# `--no-verify` long flag, `HUSKY=0`/`HUSKY_SKIP_HOOKS=` (disables husky hooks),
# and `core.hooksPath` pointed at /dev/null or set empty (disables all git
# hooks). Shell-token matching avoids false positives from issue bodies,
# heredocs, and commit-message prose while still catching quoted real argv
# values such as `git -c "core.hooksPath=/dev/null"`.
#
# agy protocol (distinct from the Claude block-no-verify.sh exit-code protocol):
#   - stdin  = JSON: { "toolCall": { "name": "run_command",
#                      "args": { "CommandLine": "<shell command>" } }, ... }
#   - stdout = JSON decision: {"decision":"deny","reason":"..."} | {"decision":"allow"}
#
# Shipped as a GLOBAL agy plugin hook (hooks.json at the plugin root, installed
# to ~/.gemini/config/plugins/<variant>/). Matches agy's shell tool `run_command`
# on PreToolUse. jq parses the JSON envelope (per project rule: never grep/sed
# JSON); the command string itself is matched with grep (it is a plain string,
# not JSON). Malformed/empty stdin → allow (fail open, never crash the tool).
set -uo pipefail

allow() {
  printf '%s\n' '{"decision":"allow"}'
  exit 0
}

deny() {
  printf '%s\n' '{"decision":"deny","reason":"This command bypasses Lisa pre-commit/pre-push quality gates (--no-verify, HUSKY=0, or core.hooksPath disabling). Fix the underlying issue (lint, tests, formatting) or ask the user before bypassing."}'
  exit 0
}

input="$(cat 2>/dev/null || true)"
[ -z "$input" ] && allow

command_str="$(printf '%s' "$input" | jq -r '.toolCall.args.CommandLine // empty' 2>/dev/null || true)"
[ -z "$command_str" ] && allow

command -v python3 >/dev/null 2>&1 || allow

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
  deny
fi

allow

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

# Git resolves any UNAMBIGUOUS abbreviation of a long option, so `--no-veri`
# skips hooks exactly as completely as `--no-verify`. Matched as a prefix
# rather than by listing abbreviations; `--no-verbose` diverges after
# `--no-ver` and so is correctly not caught.
NO_VERIFY = "--no-verify"
NO_VERIFY_MIN_PREFIX = len("--no-v")


def disables_verification(token):
    """Whether a token is `--no-verify` or an abbreviation git would accept.

    Args:
        token: A single shell token from the command line.

    Returns:
        True if git would read this token as --no-verify.
    """
    return (
        len(token) >= NO_VERIFY_MIN_PREFIX
        and len(token) <= len(NO_VERIFY)
        and NO_VERIFY.startswith(token)
    )

# The only relocations that keep a repo's own hooks in play. Anything else —
# including "" and /dev/null, which are simply the two most obvious members of
# the blocked set rather than special cases — is refused.
PERMITTED_HOOKS_PATHS = {".husky", ".githooks"}


def is_permitted_hooks_path(value):
    """Whether a core.hooksPath value relocates hooks rather than disabling them.

    Args:
        value: The raw core.hooksPath value as it appeared on the command line.

    Returns:
        True if the path is an established in-repo hooks directory.
    """
    cleaned = value.strip().strip("'\"")
    if cleaned.startswith("./"):
        cleaned = cleaned[2:]
    return cleaned.rstrip("/") in PERMITTED_HOOKS_PATHS


for i, token in enumerate(normalized_tokens):
    if disables_verification(token):
        sys.exit(1)
    if token == "HUSKY=0" or token.startswith("HUSKY_SKIP_HOOKS="):
        sys.exit(1)
    # Allowlist the destinations, do not denylist the disabling ones: hooks are
    # disabled just as completely by any directory that happens to contain none
    # (`-c core.hooksPath=/tmp/empty`), so the set that DISABLES hooks is
    # unbounded while the set that legitimately relocates them is tiny. Matched
    # case-insensitively because git config names are.
    lowered = token.lower()
    if lowered.startswith("core.hookspath="):
        if not is_permitted_hooks_path(token.split("=", 1)[1]):
            sys.exit(1)
    if lowered == "core.hookspath" and i + 1 < len(normalized_tokens):
        if not is_permitted_hooks_path(normalized_tokens[i + 1]):
            sys.exit(1)
    # `--config-env=core.hooksPath=SOMEVAR` reads the path out of the named env
    # var, so it is not in the command at all and cannot be allowlisted.
    if lowered.startswith("--config-env="):
        spec = token.split("=", 1)[1]
        if spec.split("=", 1)[0].strip().lower() == "core.hookspath":
            sys.exit(1)
    # git also accepts `--config-env <name>=<envvar>` as two tokens. Guarding
    # only the `=` spelling let the trailing `core.hooksPath=.husky` fall
    # through to the allowlist above, which reads `.husky` as a path — but here
    # it names an ENVIRONMENT VARIABLE, which can hold /dev/null. Checked at the
    # `--config-env` token, which the loop reaches first.
    if lowered == "--config-env" and i + 1 < len(normalized_tokens):
        spec = normalized_tokens[i + 1]
        if spec.split("=", 1)[0].strip().strip("'\"").lower() == "core.hookspath":
            sys.exit(1)
    # `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath
    # GIT_CONFIG_VALUE_0=/dev/null git ...` sets the same command-scope config
    # via env-var-style assignments. The index is arbitrary below
    # GIT_CONFIG_COUNT, so it is matched as `\d+` rather than pinned to 0.
    key_match = re.match(r"git_config_key_\d+=(.*)$", lowered, re.DOTALL)
    if key_match and key_match.group(1).strip().strip("'\"") == "core.hookspath":
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

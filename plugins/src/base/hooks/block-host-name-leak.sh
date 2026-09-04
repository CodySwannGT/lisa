#!/usr/bin/env bash
# PreToolUse hook for Bash: refuse an outbound tracker write that names a host
# project.
#
# The classification lives in block-host-name-leak.mjs beside this file, because
# the detector it must consult is compiled JavaScript (`dist/core/`) and calling
# it from Node is the only way to keep ONE denylist. A bash reimplementation of
# the matcher would be a second copy of the thing the guard exists to protect,
# and copies drift.
#
# This wrapper does three things and nothing else: probe its interpreters,
# unwrap the Claude hook envelope, and hand the command string to Node.
#
# FAILING OPEN, LOUDLY
#
# Claude Code treats exit 2 as a refusal and every OTHER non-zero exit as a
# non-blocking hook error — meaning the command runs. Under `set -euo pipefail`
# an absent jq exits 127, so an unguarded probe would permit exactly what this
# exists to stop. Degrading to "allow" is correct: a hook that cannot read its
# input cannot tell a tracker write from a directory listing, and failing closed
# would block every Bash call on a machine missing an interpreter. Announcing it
# is mandatory, because a guard that is silently absent reads exactly like a
# guard that is passing. Same reasoning as block-direct-issue-create.sh.
set -euo pipefail

input="$(cat)"

for required in jq node; do
  if ! command -v "$required" >/dev/null 2>&1; then
    printf 'block-host-name-leak: %s not found; host-identity enforcement is NOT active\n' \
      "$required" >&2
    exit 0
  fi
done

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null || true)"
if [ "$tool_name" != "Bash" ]; then
  exit 0
fi

command_str="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
if [ -z "$command_str" ]; then
  exit 0
fi

project_dir="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$project_dir" ]; then
  project_dir="$PWD"
fi

hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
classifier="$hook_dir/block-host-name-leak.mjs"
if [ ! -r "$classifier" ]; then
  printf 'block-host-name-leak: classifier missing at %s; host-identity enforcement is NOT active\n' \
    "$classifier" >&2
  exit 0
fi

status=0
node "$classifier" "$command_str" "$project_dir" || status=$?
exit "$status"

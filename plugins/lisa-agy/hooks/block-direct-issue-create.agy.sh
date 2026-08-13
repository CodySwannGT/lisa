#!/usr/bin/env bash
# Antigravity (agy) PreToolUse adapter for Lisa's ready-role filing guard.
#
# agy sends `{toolCall:{name:"run_command",args:{CommandLine:"..."}}}` and
# expects an allow/deny JSON object on stdout. The canonical hook consumes the
# Claude Bash-hook envelope and communicates denial with exit status 2. This
# adapter only translates protocols; all classification stays in the canonical
# block-direct-issue-create.sh beside it (same delegation pattern as
# block-instruction-file-edits.agy.sh).
#
# No scope gap here, unlike the instruction-file adapter: the canonical guard is
# Bash-only by construction, and `run_command` is exactly the surface it needs.
# agy therefore receives the whole guard, not an arm of it.
#
# Fail-open on missing runtimes: a missed refusal costs one under-declared
# ticket, and `lisa-repair-intake` already sweeps for exactly that. Failing
# closed would block every command on a machine without jq.
set -uo pipefail

allow() {
  printf '%s\n' '{"decision":"allow"}'
  exit 0
}

deny() {
  local reason="$1"
  if command -v jq >/dev/null 2>&1; then
    jq -cn --arg reason "$reason" '{decision:"deny",reason:$reason}'
  else
    printf '%s\n' '{"decision":"allow"}'
  fi
  exit 0
}

input="$(cat 2>/dev/null || true)"
[ -z "$input" ] && allow
command -v jq >/dev/null 2>&1 || allow

tool_name="$(printf '%s' "$input" | jq -r '.toolCall.name // empty' 2>/dev/null || true)"
[ "$tool_name" != "run_command" ] && allow
command_str="$(printf '%s' "$input" | jq -r '.toolCall.args.CommandLine // empty' 2>/dev/null || true)"
[ -z "$command_str" ] && allow

hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
canonical_hook="$hook_dir/block-direct-issue-create.sh"
[ -r "$canonical_hook" ] || allow

canonical_input="$(jq -cn --arg command "$command_str" '{tool_name:"Bash",tool_input:{command:$command}}')"
canonical_output=""
canonical_status=0
if canonical_output="$(printf '%s' "$canonical_input" | /bin/bash "$canonical_hook" 2>&1)"; then
  canonical_status=0
else
  canonical_status=$?
fi

[ "$canonical_status" -eq 0 ] && allow
[ -n "$canonical_output" ] || canonical_output="Blocked: file work items through lisa-track / lisa-tracker-write with an explicit build_ready: or human_gate:."
deny "$canonical_output"

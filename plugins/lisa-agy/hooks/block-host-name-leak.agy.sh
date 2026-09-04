#!/usr/bin/env bash
# Antigravity (agy) PreToolUse adapter for Lisa's host-name leak guard.
#
# agy sends `{toolCall:{name:"run_command",args:{CommandLine:"..."}}}` and
# expects an allow/deny JSON object on stdout. The canonical hook consumes the
# Claude Bash-hook envelope and communicates denial with exit status 2. This
# adapter only translates protocols; all classification stays in the canonical
# block-host-name-leak.sh beside it (same delegation pattern as
# block-direct-issue-create.agy.sh).
#
# No scope gap: the canonical guard is Bash-only by construction, and
# `run_command` is exactly the surface it needs. agy receives the whole guard.
#
# Fail-open on missing runtimes, for the reason the canonical hook states — and
# note the cost here is higher than the filing guard's. A missed refusal is a
# host identity published to a public repository and shipped to npm, which
# cannot be quietly repaired later the way an under-declared ticket can. It is
# still the right default: failing closed would block every command on a machine
# without jq, which takes the guard out of service entirely.
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
canonical_hook="$hook_dir/block-host-name-leak.sh"
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
[ -n "$canonical_output" ] || canonical_output="Blocked: this tracker write names a host project. Write the evidence, not the identity."
deny "$canonical_output"

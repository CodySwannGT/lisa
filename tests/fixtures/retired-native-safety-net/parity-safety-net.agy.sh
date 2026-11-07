#!/usr/bin/env bash
# Antigravity (agy) PreToolUse adapter for Lisa's canonical parity safety net.
#
# agy sends `{toolCall:{name:"run_command",args:{CommandLine:"..."}}}` and
# expects an allow/deny JSON object on stdout. The canonical hook consumes the
# Claude Bash-hook envelope and communicates denial with exit status 2. This
# adapter only translates protocols; all classification stays in the canonical
# parity-safety-net.sh and parity-safety-net-heredoc.py files beside it.
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
    printf '%s\n' '{"decision":"deny","reason":"Blocked by safety-net: the required JSON runtime is unavailable, so this command could not be classified safely."}'
  fi
  exit 0
}

input="$(cat 2>/dev/null || true)"
[ -z "$input" ] && allow
command -v jq >/dev/null 2>&1 || deny "Blocked by safety-net: the required JSON runtime is unavailable, so this command could not be classified safely."

tool_name="$(printf '%s' "$input" | jq -r '.toolCall.name // empty' 2>/dev/null || true)"
[ "$tool_name" != "run_command" ] && allow
command_str="$(printf '%s' "$input" | jq -r '.toolCall.args.CommandLine // empty' 2>/dev/null || true)"
[ -z "$command_str" ] && allow

hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
canonical_hook="$hook_dir/parity-safety-net.sh"
[ -r "$canonical_hook" ] || deny "Blocked by safety-net: the canonical safety policy is unavailable, so this command could not be classified safely."

canonical_input="$(jq -cn --arg command "$command_str" '{tool_name:"Bash",tool_input:{command:$command}}')"
canonical_output=""
canonical_status=0
if canonical_output="$(printf '%s' "$canonical_input" | /bin/bash "$canonical_hook" 2>&1)"; then
  canonical_status=0
else
  canonical_status=$?
fi

[ "$canonical_status" -eq 0 ] && allow
[ -n "$canonical_output" ] || canonical_output="Blocked by safety-net: the canonical safety policy failed closed."
deny "$canonical_output"

#!/usr/bin/env bash
# Antigravity (agy) PreToolUse adapter for Lisa's managed-file guard.
#
# agy sends `{toolCall:{name:"run_command",args:{CommandLine:"..."}}}` and
# expects an allow/deny JSON object on stdout. The canonical hook consumes the
# Claude Bash-hook envelope and communicates denial with exit status 2. This
# adapter only translates protocols; all classification stays in the canonical
# block-managed-file-edits.sh beside it (same delegation pattern as
# block-instruction-file-edits.agy.sh).
#
# Scope note: agy plugin hooks match `run_command`, so only the Bash arm of the
# guard reaches agy — an agy file-edit tool call writing a copy-overwrite
# template cannot be intercepted. That gap is accepted and recorded here, and in
# the pull request that added this adapter, rather than papered over. The
# redirection / append / tee signatures the canonical guard follows into
# executed scripts still hold on agy, which is the majority of the surface.
#
# Fail-open on missing runtimes, matching every sibling adapter. A missed
# refusal here costs a silently forked template — recoverable, and `lisa apply`
# reports it as out of date on every subsequent run — where failing closed would
# block every command on a machine without jq.
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
canonical_hook="$hook_dir/block-managed-file-edits.sh"
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
[ -n "$canonical_output" ] || canonical_output="Blocked: this file is Lisa-managed and is replaced by \`lisa apply\`. Edit the template upstream in Lisa, or use the local escape hatch beside the file."
deny "$canonical_output"

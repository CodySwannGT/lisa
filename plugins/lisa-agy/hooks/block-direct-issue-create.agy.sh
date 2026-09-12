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
# THE SECOND SUBSTRATE (CodySwannGT/lisa#3785). CodySwannGT/lisa#3753 taught the
# canonical guard that a creation also arrives as NAMED FIELDS rather than as a
# command line. This adapter used to forward `run_command` and nothing else, and
# the registration matched `run_command` only, so on agy that substrate was
# unenforced — refused entry twice over, exactly as it was on Claude before
# CodySwannGT/lisa#3753. Widening one without the other changes nothing.
#
# agy's envelope was CAPTURED, not guessed — a probe plugin registered with an
# empty matcher, driven through `agy --dangerously-skip-permissions -p`, on
# agy 1.1.3:
#
#   {"toolCall":{"name":"call_mcp_tool","args":{
#      "ServerName":"probe-tracker","ToolName":"create_issue",
#      "Arguments":{"title":"envelope probe","body":"capture"},
#      "toolAction":"...","toolSummary":"..."}}}
#
# Two things about it decide the translation below, and both would have been got
# wrong by a plausible guess:
#
#   - EVERY MCP call arrives under the single tool name `call_mcp_tool`. The
#     server and tool the model actually asked for live in `ServerName` /
#     `ToolName`, so forwarding agy's outer name verbatim hands the canonical
#     guard a name carrying no tracker noun, and its shape gate ALLOWS the lot.
#     Measured before this change: forwarding `call_mcp_tool` raw ALLOWED an
#     undeclared `create_issue`. So the adapter reassembles the name into the
#     `mcp__<server>__<tool>` spelling the canonical guard already classifies on
#     Claude — one vocabulary, one classifier.
#   - The arguments land under `Arguments`, not inline beside the metadata, so
#     `toolAction` / `toolSummary` — agy's own prose about the call — stay OUT
#     of the payload the declaration is read from. Passing them would let a
#     summary sentence mentioning the ready role answer for the filing.
#
# Every other tool is forwarded generically (`{tool_name, tool_input}`) rather
# than allowed here. The canonical guard owns the question of what counts as a
# creation; an adapter that pre-filtered would be a second copy of that policy,
# and the first native creation tool agy adds would arrive on the wrong side of
# it. The cost is one extra `bash` + `jq` per non-shell tool call, which is what
# the canonical guard's subprocess-free shape gate exists to keep cheap.
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
[ -z "$tool_name" ] && allow

canonical_input=""
if [ "$tool_name" = "run_command" ]; then
  # The shell substrate, byte-identical to what it was before the second
  # substrate arrived. Its verdicts are the control for this change.
  command_str="$(printf '%s' "$input" | jq -r '.toolCall.args.CommandLine // empty' 2>/dev/null || true)"
  [ -z "$command_str" ] && allow
  canonical_input="$(jq -cn --arg command "$command_str" '{tool_name:"Bash",tool_input:{command:$command}}')"
elif [ "$tool_name" = "call_mcp_tool" ]; then
  # A missing ServerName or ToolName is a payload this adapter cannot name, and
  # naming is the whole of its job here. It hands the canonical guard the
  # unspellable name rather than inventing a plausible one, so the guard's own
  # fail-closed arm decides — never this adapter.
  canonical_input="$(
    printf '%s' "$input" |
      jq -c '(.toolCall.args // {}) as $a
        | {tool_name: ("mcp__" + ($a.ServerName // "?") + "__" + ($a.ToolName // "?")),
           tool_input: ($a.Arguments // {})}' 2>/dev/null || true
  )"
else
  canonical_input="$(
    printf '%s' "$input" |
      jq -c '{tool_name: .toolCall.name, tool_input: (.toolCall.args // {})}' 2>/dev/null || true
  )"
fi
[ -z "$canonical_input" ] && allow

hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
canonical_hook="$hook_dir/block-direct-issue-create.sh"
[ -r "$canonical_hook" ] || allow

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

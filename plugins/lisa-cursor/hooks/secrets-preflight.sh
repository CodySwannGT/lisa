#!/usr/bin/env bash
# Prove at session start that this agent can actually do the work: that the
# credentials the project needs resolve, and that the CLIs it needs are on PATH.
#
# One hook for both because it is one question — can this agent do the work —
# and an operator reading two separate reports has to assemble the answer
# themselves. Both halves also share the same failure mode if split: two hooks
# means two subprocess spawns on every session start, for a check that is silent
# almost every time.
#
# Injects rather than blocks, and that is deliberate. The right response to a
# missing credential or tool is for the agent to know before it claims work and
# to route the item to blocked with a reason a human can act on — not for the
# session to die. A session that cannot reach the vault can still write code,
# review a PR, or answer a question; killing it would tax every session for a
# minority need, and a control people route around enforces nothing.
#
# The hard gates live where they can afford to be hard: `lisa doctor` and CI
# run the same two scripts and exit non-zero on them.
#
# Silent on success on purpose. A control that announces itself when everything
# is fine trains its readers to skim past it, and then it is decoration.
set -uo pipefail

INPUT=$(cat 2>/dev/null || true)
if [ -n "$INPUT" ]; then
  HOOK_EVENT=$(printf '%s' "$INPUT" | jq -r '.hook_event_name // "SessionStart"' 2>/dev/null || echo "SessionStart")
else
  HOOK_EVENT="SessionStart"
fi

ROOT="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
SECRETS="$ROOT/skills/lisa-secrets-access/scripts/preflight-secrets.mjs"
TOOLS="$ROOT/skills/lisa-setup-remote-env/scripts/preflight-tools.mjs"

command -v node >/dev/null 2>&1 || exit 0
# The hook's whole output is one `jq -n` document. Without jq there is nothing
# to write, so exiting is the only honest outcome — the alternative is a hook
# that prints `jq: command not found` and exits 127, which reports a failure
# from a check designed never to block. The doctor and CI gates run the same
# two scripts without jq involved.
command -v jq >/dev/null 2>&1 || exit 0

# stderr carries each report; stdout is reserved for the hook's JSON. A script
# that is absent (partial or older install) or fails to run at all contributes
# nothing, because a broken hook must not manufacture a finding.
REPORT=""
for script in "$SECRETS" "$TOOLS"; do
  [ -f "$script" ] || continue
  # An escape hatch that is honest about what it costs, and scoped to what it
  # names. Set when a surface has no secrets provider by design and the noise is
  # not worth it; the doctor and CI gates are unaffected, so opting out here
  # does not opt out of the check entirely. It must not also silence the
  # TOOLING half — a variable about secrets that hides a missing `gh` or
  # `maestro` is an opt-out from a check nobody opted out of.
  if [ "$script" = "$SECRETS" ] && [ "${LISA_SKIP_SECRETS_PREFLIGHT:-}" = "1" ]; then
    continue
  fi
  OUT=$(node "$script" 2>&1 >/dev/null) || true
  [ -n "$OUT" ] || continue
  [ -n "$REPORT" ] && REPORT+=$'\n\n'
  REPORT+="$OUT"
done

[ -n "$REPORT" ] || exit 0

CONTEXT="## Readiness preflight

$REPORT"

jq -n --arg event "$HOOK_EVENT" --arg ctx "$CONTEXT" \
  '{"hookSpecificOutput": {"hookEventName": $event, "additionalContext": $ctx}}'

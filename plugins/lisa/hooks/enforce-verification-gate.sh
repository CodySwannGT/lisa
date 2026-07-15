#!/usr/bin/env bash
# Enforces the /lisa:implement completion gate: the lead session may not stop
# while an implement flow is active until an independent, machine-readable
# verification verdict proves every acceptance criterion passed.
#
# This carries over the most valuable property of the native `/goal` primitive
# (Claude Code v2.1.139, Codex 0.128.0): a NON-BYPASSABLE completion gate where
# the agent doing the work cannot self-certify "done". Unlike `/goal`'s small
# evaluator model — which only reads the transcript and cannot run tools — this
# gate is deterministic and judges a structured artifact the
# verification-specialist writes from REAL tool output, so it is both stronger
# and not foolable by a prose claim of success.
#
# Intentionally Claude-specific (like enforce-team-first.sh). Other harnesses
# may not fire a Stop hook; they fall back to the prose completion gate in
# skills/lisa-implement/SKILL.md.
#
# Triggered on four hook events:
#   - UserPromptSubmit : arm enforcement when the prompt starts with
#                        /lisa:implement (or /implement)
#   - PreToolUse       : arm enforcement when the Skill tool loads lisa-implement
#                        (covers nested/programmatic invocation, e.g. intake)
#   - SubagentStart    : mark teammate sessions exempt — teammates inherit the
#                        lead's flow and must not be gated on their own stop
#   - Stop             : block the lead stop unless a FRESH terminal verdict
#                        (status pass|blocked, all criteria pass) exists, bounded
#                        by a per-session block counter so a genuinely-stuck flow
#                        ESCALATES instead of looping forever.
#
# The verdict artifact lives at "$CLAUDE_PROJECT_DIR/.lisa/verification-status.json":
#   {
#     "plan": "<plan-name>",
#     "status": "pass" | "fail" | "blocked" | "in_progress",
#     "criteria": [
#       { "task": "...", "criterion": "...", "status": "pass" | "fail" | "blocked", "evidence": "..." }
#     ],
#     "updated_at": "<ISO8601 UTC>"
#   }
# status "pass" (all criteria pass) or "blocked" (flow recorded a blocker and is
# stopping deliberately) are terminal and release the gate. "fail"/"in_progress"
# or a missing/stale file keep it closed.
#
# Per-session state lives under "$STATE_DIR" as flag files keyed by session_id.
# Stale state (>24h) is cleaned on each invocation.
#
# Fail-open: any unexpected jq parse failure or missing field exits 0 rather
# than blocking. A broken gate must never brick a session.

set -uo pipefail

INPUT=$(cat 2>/dev/null || true)
if [ -z "$INPUT" ]; then
  exit 0
fi

HOOK_EVENT=$(printf '%s' "$INPUT" | jq -r '.hook_event_name // empty' 2>/dev/null || true)
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

STATE_DIR="${TMPDIR:-/tmp}/lisa-verification-gate"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

ARM_FLAG="${STATE_DIR}/${SESSION_ID}.armed"
SUBAGENT_FLAG="${STATE_DIR}/${SESSION_ID}.subagent"
COUNT_FILE="${STATE_DIR}/${SESSION_ID}.blocks"

# Best-effort cleanup of stale state files. Errors are ignored.
find "$STATE_DIR" -maxdepth 1 -type f -mmin +1440 -delete 2>/dev/null || true

# How many consecutive blocks before the gate releases (with escalation) to
# avoid an infinite stop loop. Mirrors /goal's "or stop after N turns" clause.
MAX_BLOCKS=8

arm_once() {
  # Arm without bumping mtime if already armed — the arm time is the freshness
  # baseline for the verdict, so re-arming on a later prompt must not make an
  # already-written verdict look stale.
  [ -f "$ARM_FLAG" ] || touch "$ARM_FLAG" 2>/dev/null || true
}

case "$HOOK_EVENT" in
  SubagentStart)
    touch "$SUBAGENT_FLAG" 2>/dev/null || true
    exit 0
    ;;

  UserPromptSubmit)
    PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null || true)
    if [ -n "$PROMPT" ]; then
      LEADING=$(printf '%s' "$PROMPT" | sed -n '1p' | sed -E 's/^[[:space:]]*//')
      case "$LEADING" in
        /lisa:implement*|/implement*)
          arm_once
          ;;
      esac
    fi
    exit 0
    ;;

  PreToolUse)
    TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null || true)
    if [ "$TOOL_NAME" = "Skill" ]; then
      SKILL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_input.skill // empty' 2>/dev/null || true)
      case "$SKILL_NAME" in
        lisa-implement|implement)
          arm_once
          ;;
      esac
    fi
    exit 0
    ;;

  Stop)
    : # fall through to enforcement
    ;;

  *)
    exit 0
    ;;
esac

# --- Stop enforcement path ---

# Teammates inherit the lead's flow; never gate a subagent stop.
if [ -f "$SUBAGENT_FLAG" ]; then
  exit 0
fi

# No implement flow armed — nothing to gate.
if [ ! -f "$ARM_FLAG" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
VERDICT_FILE="${PROJECT_DIR}/.lisa/verification-status.json"

# A terminal verdict (pass or blocked) with no failing criterion, written AFTER
# the flow was armed, releases the gate.
verdict_is_terminal() {
  [ -f "$VERDICT_FILE" ] || return 1

  local status fails
  status=$(jq -r '.status // empty' "$VERDICT_FILE" 2>/dev/null || true)
  case "$status" in
    pass|blocked) : ;;
    *) return 1 ;;
  esac

  fails=$(jq -r '[.criteria[]? | select((.status // "") == "fail")] | length' "$VERDICT_FILE" 2>/dev/null || echo 1)
  [ "$fails" = "0" ] || return 1

  # Reject a stale verdict left over from a previous plan in this session.
  if [ "$VERDICT_FILE" -ot "$ARM_FLAG" ]; then
    return 1
  fi

  return 0
}

if verdict_is_terminal; then
  # Gate satisfied — disarm so a follow-up stop in the same session is not
  # re-gated against the now-consumed verdict, and allow the stop.
  rm -f "$ARM_FLAG" "$COUNT_FILE" 2>/dev/null || true
  exit 0
fi

# Verdict missing, failing, or stale — block, but bound the loop.
COUNT=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
case "$COUNT" in
  ''|*[!0-9]*) COUNT=0 ;;
esac
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNT_FILE" 2>/dev/null || true

if [ "$COUNT" -gt "$MAX_BLOCKS" ]; then
  rm -f "$ARM_FLAG" "$COUNT_FILE" 2>/dev/null || true
  cat >&2 <<EOF
Verification gate: still no passing verdict after ${MAX_BLOCKS} attempts.
Releasing the stop gate to avoid an infinite loop. The /lisa:implement Verify
flow did NOT prove completion. Do NOT claim this work is verified — escalate to
a human, or file a build-ready fix ticket and move the work item to blocked.
EOF
  exit 0
fi

REASON_DETAIL=""
if [ -f "$VERDICT_FILE" ]; then
  REASON_DETAIL=$(jq -r '[.criteria[]? | select((.status // "") != "pass") | "  - \(.task // "?"): \(.criterion // "?") [\(.status // "missing")]"] | .[]' "$VERDICT_FILE" 2>/dev/null || true)
fi

{
  echo "Blocked: /lisa:implement may not stop until verification is proven."
  echo
  if [ ! -f "$VERDICT_FILE" ]; then
    echo "No verification verdict found at .lisa/verification-status.json."
    echo "The Verify flow must run the verification-specialist (run the actual"
    echo "system, observe results) and write a machine-readable verdict — schema"
    echo "in skills/lisa-implement/SKILL.md — with status \"pass\" and every"
    echo "acceptance criterion proven."
    echo
    echo "If you are stopping deliberately because of a blocker (readiness gate"
    echo "failed, base branch missing, unresolved dependency), write the verdict"
    echo "with status \"blocked\" and the reason instead. That records the"
    echo "outcome and releases this gate."
  else
    echo "The verification verdict is not terminal-and-passing. Outstanding:"
    if [ -n "$REASON_DETAIL" ]; then
      printf '%s\n' "$REASON_DETAIL"
    else
      echo "  (status is not pass/blocked, or the verdict is older than this run)"
    fi
    echo
    echo "Fix the failing criteria and re-verify, or — if genuinely blocked —"
    echo "set status \"blocked\" with the reason."
  fi
  echo
  echo "(Attempt ${COUNT}/${MAX_BLOCKS} — the gate releases after ${MAX_BLOCKS} to avoid a loop.)"
} >&2
exit 2

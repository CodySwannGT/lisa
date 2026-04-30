#!/usr/bin/env bash
# Enforces team-first orchestration for lifecycle skills.
#
# Triggered on four hook events:
#   - UserPromptSubmit  : detects /lisa:research|plan|implement|intake|debrief in the
#                         raw prompt and arms enforcement for the session
#   - PreToolUse        : detects the same skills via a `Skill` tool call,
#                         arms enforcement, and blocks bypass tool calls
#                         until ToolSearch+TeamCreate have fired
#   - PostToolUse       : on a successful TeamCreate, marks the session as
#                         team-created (lifts enforcement)
#   - SubagentStart     : marks the new subagent session as a teammate so
#                         it is exempt — teammates inherit the lead's team
#                         and must never call TeamCreate (double-create
#                         is rejected by the harness)
#
# Per-session state lives under "$STATE_DIR" as flag files keyed by
# session_id. Stale state (>24h) is cleaned on each invocation.
#
# Fail-open: any unexpected jq parse failure or missing field exits 0
# rather than blocking. A broken hook must never brick a session.

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

STATE_DIR="${TMPDIR:-/tmp}/lisa-team-enforce"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

SUBAGENT_FLAG="${STATE_DIR}/${SESSION_ID}.subagent"
SKILL_FLAG="${STATE_DIR}/${SESSION_ID}.skill"
TEAM_FLAG="${STATE_DIR}/${SESSION_ID}.team"

# Best-effort cleanup of stale state files. Errors are ignored.
find "$STATE_DIR" -maxdepth 1 -type f -mmin +1440 -delete 2>/dev/null || true

is_lifecycle_skill() {
  case "$1" in
    lisa:research|lisa:plan|lisa:implement|lisa:intake|lisa:debrief) return 0 ;;
    *) return 1 ;;
  esac
}

case "$HOOK_EVENT" in
  SubagentStart)
    touch "$SUBAGENT_FLAG" 2>/dev/null || true
    exit 0
    ;;

  UserPromptSubmit)
    PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null || true)
    if [ -n "$PROMPT" ]; then
      # Match a slash command at the start of the prompt (allow optional whitespace).
      LEADING=$(printf '%s' "$PROMPT" | sed -n '1p' | sed -E 's/^[[:space:]]*//')
      case "$LEADING" in
        # /lisa:debrief:apply is single-agent — explicitly excluded by listing
        # it first with a no-op pattern; the broader /lisa:debrief* below would
        # otherwise capture it.
        /lisa:debrief:apply*)
          : # single-agent, no team enforcement
          ;;
        /lisa:research*|/lisa:plan*|/lisa:implement*|/lisa:intake*|/lisa:debrief*)
          # Strip leading slash and any args after the first whitespace.
          SKILL_NAME=$(printf '%s' "$LEADING" | sed -E 's|^/||; s/[[:space:]].*$//')
          printf '%s\n' "$SKILL_NAME" >"$SKILL_FLAG" 2>/dev/null || true
          ;;
      esac
    fi
    exit 0
    ;;

  PostToolUse)
    TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null || true)
    if [ "$TOOL_NAME" = "TeamCreate" ]; then
      ERROR=$(printf '%s' "$INPUT" | jq -r '.tool_response.error // empty' 2>/dev/null || true)
      IS_ERROR=$(printf '%s' "$INPUT" | jq -r '.tool_response.is_error // empty' 2>/dev/null || true)
      if [ -z "$ERROR" ] && [ "$IS_ERROR" != "true" ]; then
        touch "$TEAM_FLAG" 2>/dev/null || true
      fi
    fi
    exit 0
    ;;

  PreToolUse)
    : # fall through
    ;;

  *)
    exit 0
    ;;
esac

# --- PreToolUse enforcement path ---

# Teammates inherit the team; never enforce on subagent sessions.
if [ -f "$SUBAGENT_FLAG" ]; then
  exit 0
fi

TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null || true)
if [ -z "$TOOL_NAME" ]; then
  exit 0
fi

# Detect lifecycle skill invocation via the Skill tool.
if [ "$TOOL_NAME" = "Skill" ]; then
  SKILL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_input.skill // empty' 2>/dev/null || true)
  if is_lifecycle_skill "$SKILL_NAME"; then
    printf '%s\n' "$SKILL_NAME" >"$SKILL_FLAG" 2>/dev/null || true
    # The skill load itself is allowed; enforcement begins on the next call.
    exit 0
  fi
fi

# No lifecycle skill armed — nothing to enforce.
if [ ! -f "$SKILL_FLAG" ]; then
  exit 0
fi

# Team has been created — enforcement complete.
if [ -f "$TEAM_FLAG" ]; then
  exit 0
fi

# These two are the path forward; never block them.
case "$TOOL_NAME" in
  ToolSearch|TeamCreate)
    exit 0
    ;;
esac

# Determine whether this tool is a bypass path. Anything not in this set
# is allowed (e.g. TodoWrite, AskUserQuestion, ExitPlanMode) so we don't
# over-block.
should_block=0
case "$TOOL_NAME" in
  Task|TaskCreate|TaskGet|TaskList|TaskOutput|TaskStop|TaskUpdate)
    should_block=1 ;;
  Skill|Read|Write|Edit|MultiEdit|NotebookEdit|Bash|Grep|Glob|WebSearch|WebFetch)
    should_block=1 ;;
  mcp__*)
    should_block=1 ;;
esac

if [ "$should_block" -eq 0 ]; then
  exit 0
fi

ACTIVE_SKILL=$(cat "$SKILL_FLAG" 2>/dev/null || echo "lisa:???")
cat >&2 <<EOF
Blocked: this session invoked /${ACTIVE_SKILL}, which is an agent-team flow.
Before any other tool call, you must:

  1. ToolSearch with query: "select:TeamCreate"  (load the deferred schema)
  2. TeamCreate                                   (actually create the team)

The current attempt to call \`${TOOL_NAME}\` is a team-bypass path. Reading
the ticket, exploring the code, fetching context — those are tasks for the
team you are about to create, not for the lead session before the team
exists.

Re-read the orchestration preamble in /${ACTIVE_SKILL} and start with
ToolSearch.
EOF
exit 2

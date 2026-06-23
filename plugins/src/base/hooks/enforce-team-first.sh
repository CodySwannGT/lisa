#!/usr/bin/env bash
# Enforces Claude's TeamCreate-first orchestration for lifecycle skills.
#
# This hook is intentionally Claude-specific. Other harnesses may use different
# team tooling or an explicit no-team fallback; those paths are described in the
# shared rules/skills but are not enforced by this Claude hook.
#
# Triggered on four hook events:
#   - UserPromptSubmit  : detects /lisa:research|plan|implement|intake|debrief in the
#                         raw prompt and arms enforcement for the session
#   - PreToolUse        : detects the same skills via a `Skill` tool call,
#                         arms enforcement, and blocks bypass tool calls until
#                         the team is established — i.e. until a TeamCreate
#                         (older Claude Code) or the first Agent spawn
#                         (implicit-team model, Claude Code >= 2.1.178) fires
#   - PostToolUse       : on a successful Claude TeamCreate OR a successful
#                         Agent spawn (implicit team), marks the session as
#                         team-established (lifts enforcement)
#   - SubagentStart     : marks the new subagent session as a teammate so
#                         it is exempt — teammates inherit the lead's team
#                         and must never create a second team (double-create
#                         is rejected by the Claude harness)
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
    # A successful TeamCreate (older Claude Code) OR a successful Agent spawn
    # (Claude Code >= 2.1.178, where TeamCreate/TeamDelete were removed in favor
    # of the implicit-team model — the team forms automatically when the lead
    # spawns its first teammate via the Agent tool) marks the session as
    # team-established and lifts enforcement.
    if [ "$TOOL_NAME" = "TeamCreate" ] || [ "$TOOL_NAME" = "Agent" ]; then
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

# These are the path forward; never block them.
#   - ToolSearch / TeamCreate : the older explicit-team path (Claude Code < 2.1.178)
#   - Agent                   : the implicit-team path (Claude Code >= 2.1.178) —
#                               spawning the first teammate IS what forms the team
case "$TOOL_NAME" in
  ToolSearch|TeamCreate|Agent)
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
In Claude, before any other tool call, you must establish the team by spawning
your FIRST teammate — and that first spawn MUST be the bounded input-resolver,
NOT a builder/implementer that does the whole task inline:

  Call the \`Agent\` tool with an appropriate \`subagent_type\`, scoped to ONLY
  resolving the input (read the ticket/file/prompt and return it).

The team forms automatically the moment the lead spawns its first teammate —
this is the implicit-team model on Claude Code >= 2.1.178, where the explicit
\`TeamCreate\`/\`TeamDelete\` tools were removed. (On older Claude Code the
\`TeamCreate\` tool path still works and is also accepted.)

Spawning a single fat agent that does the whole build satisfies this gate but
collapses the flow into the 1-agent ad-hoc fix the skill forbids. After the
input-resolver returns, record the Roster Decision — enumerate every available
\`subagent_type\` with an INCLUDE/EXCLUDE line — BEFORE spawning any lifecycle,
research, implementation, review, or verification specialist.

The current attempt to call \`${TOOL_NAME}\` is a team-bypass path. Reading
the ticket, exploring the code, fetching context — those are tasks for the
team you are about to spawn, not for the lead session before the team exists.

If you are running Lisa in a non-Claude harness, this Claude enforcement hook
should not be installed; follow the runtime-aware orchestration preamble in the
skill instead.

Re-read the orchestration preamble in /${ACTIVE_SKILL} and start by spawning the
bounded input-resolver with the \`Agent\` tool.
EOF
exit 2

#!/usr/bin/env bash
#
# track-plan-sessions.sh - Tracks which sessions work on each plan file
#
# Triggered by two hooks:
#   1. PostToolUse (Write|Edit) - Detects plan file writes via absolute path comparison,
#      stamps session ID into the plan's ## Sessions table, and saves a session-specific
#      marker file so subsequent UserPromptSubmit events can reliably find the active plan.
#   2. UserPromptSubmit - Finds the active plan file by checking for a session-specific
#      marker file first (set by PostToolUse), falling back to the most recently CREATED
#      .md file in plans/ (ls -tU on macOS sorts by birth time). This avoids the mtime bug
#      where another plan file's modification time (e.g., from a hook writing a session ID
#      to it, or format-on-edit touching it) could cause the wrong file to appear "newest."
#
# Marker files: $PLANS_DIR/.active-plan-<session-id> contain the absolute path to the
# active plan file. Stale markers (>24h) are cleaned up on each invocation.
#
# Dedup: Session ID dedup is scoped to the ## Sessions section only, not the entire
# file. This prevents false positives when session IDs appear elsewhere in plan content
# (e.g., scratchpad directory paths like /private/tmp/claude-501/.../SESSION_ID/...).
#
# Debug logging: All key decisions are logged to $PLANS_DIR/.track-plan-debug.log for
# diagnostics if session IDs land in the wrong plan file.
#
# Input (via stdin): JSON with session_id, permission_mode, hook_event_name, etc.
#

set -euo pipefail

INPUT=$(cat)

# Temporarily disabled. The hook still reads its event and parses the three
# fields it used, so a malformed event fails exactly as it did, and then exits.
# The tracking body that followed this exit never ran; it is in git history
# (74981f5be1) for whoever re-enables the hook.
printf '%s\n' "$INPUT" | jq -r '.session_id // empty' >/dev/null
printf '%s\n' "$INPUT" | jq -r '.permission_mode // "default"' >/dev/null
printf '%s\n' "$INPUT" | jq -r '.hook_event_name // empty' >/dev/null

exit 0

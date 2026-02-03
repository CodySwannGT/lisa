# Plan: Fix track-plan-sessions Hook Active-Plan Detection

## Summary

The `track-plan-sessions.sh` hook's `UserPromptSubmit` trigger uses `ls -t *.md | head -1` to find the active plan, which sorts by **modification time** rather than **creation time**. When another plan file gets its mtime updated (e.g., a hook writes a session ID to it, or `format-on-edit` touches it), that older file appears "newer" than the actually-new plan file, and the hook writes the session ID to the wrong plan. Fix with a session-specific marker file set by `PostToolUse`, plus debug logging.

## Branch

Current branch: `fix/expo-knip-and-tsconfig` (non-protected). Pushes go to the existing open PR if one exists; otherwise clarify target branch.

## Root Cause

1. **`UserPromptSubmit` path (line 63)**: `ls -t "$PLANS_DIR"/*.md | head -1` sorts by **modification time**. A newly created plan file has the most recent **creation time**, but if any other plan file was modified more recently (e.g., by the hook itself writing a session ID to it from a previous/concurrent session, or by `format-on-edit`), `ls -t` picks that other file instead.
2. **`PostToolUse` path (lines 39-59)**: Only fires when Claude uses Write/Edit on a file in the plans directory. Once planning is done and execution begins, this trigger stops firing. Only `UserPromptSubmit` runs for subsequent prompts — and it picks the wrong file due to mtime vs ctime.
3. **Net result**: The session ID gets written to the wrong plan file (one that had a more recent mtime), or the dedup check (line 78) matches the session ID already written to that wrong file, so the actual active plan gets no session entries.

## Fix

### Hybrid marker + fallback approach

When `PostToolUse` detects a plan file write, save a marker file `$PLANS_DIR/.active-plan-$SESSION_ID` containing the plan file path. When `UserPromptSubmit` fires, check for a marker file for the current session first. Fall back to `ls -tU` (creation time on macOS) only if no marker exists.

Clean up stale marker files (older than 24 hours) on each run to prevent accumulation.

### Debug logging

Always write to a log file at `$PLANS_DIR/.track-plan-debug.log`. Log:
- Hook event type
- Session ID
- Resolved plan file path (and how it was resolved: marker vs fallback)
- Whether dedup triggered
- Whether a write was performed

This gives diagnostic info if it fails again.

## Files

| Action | File |
|--------|------|
| Edit | `.claude/hooks/track-plan-sessions.sh` |
| Edit | `all/copy-overwrite/.claude/hooks/track-plan-sessions.sh` (template copy) |

## Implementation Details

### Marker file approach (in `track-plan-sessions.sh`)

```bash
MARKER_FILE="$PLANS_DIR/.active-plan-${SESSION_ID}"

if [[ "$HOOK_EVENT" == "PostToolUse" ]]; then
  # ... existing path-matching logic ...
  # After resolving PLAN_FILE, save marker:
  echo "$PLAN_FILE" > "$MARKER_FILE"

elif [[ "$HOOK_EVENT" == "UserPromptSubmit" ]]; then
  # Try marker first (reliable — set by PostToolUse when plan was written)
  if [[ -f "$MARKER_FILE" ]]; then
    PLAN_FILE=$(cat "$MARKER_FILE")
  else
    # Fallback: most recently CREATED file (ls -tU on macOS sorts by birth time)
    PLAN_FILE=$(ls -tU "$PLANS_DIR"/*.md 2>/dev/null | head -1)
  fi
fi
```

### Debug logging

```bash
DEBUG_LOG="$PLANS_DIR/.track-plan-debug.log"

log_debug() {
  printf '[%s] [%s] [%s] %s\n' \
    "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    "$SESSION_ID" \
    "$HOOK_EVENT" \
    "$1" >> "$DEBUG_LOG" 2>/dev/null || true
}
```

Log at key decision points:
- Plan file resolution method and result
- Dedup check result
- Write performed or skipped
- Full resolved path

### Stale marker cleanup

```bash
# Clean markers older than 24h (runs on each invocation, lightweight)
find "$PLANS_DIR" -name ".active-plan-*" -mmin +1440 -delete 2>/dev/null || true
```

### Add `.active-plan-*` and `.track-plan-debug.log` to `.gitignore`

Marker files and debug logs should not be committed.

## Reusable Code

The existing `track-plan-sessions.sh` structure is sound. The fix is additive — wrapping the existing `ls -t` fallback with a marker-file check and adding logging.

## Skills

- `/git:commit` for committing the fix

## Verification

1. **Marker file created**: After writing a plan file in plan mode, verify `.active-plan-<session-id>` exists in `./plans/` with the correct path
2. **Session ID recorded**: Start a new session, create/edit a plan, verify `## Sessions` gets the session ID in the correct plan file (not a different one)
3. **Debug log populated**: Check `./plans/.track-plan-debug.log` contains entries showing resolution method and resolved path
4. **Fallback works**: Delete the marker file manually, verify `ls -tU` creation-time fallback still works
5. **Stale cleanup**: Create an old marker file, verify it gets cleaned up

## Task List

Create tasks using TaskCreate:

1. **Implement marker file and debug logging in track-plan-sessions.sh** — Edit `.claude/hooks/track-plan-sessions.sh` to add marker file logic (PostToolUse saves marker, UserPromptSubmit reads it), change fallback from `ls -t` to `ls -tU` (creation time), add debug logging throughout, and add stale marker cleanup. Use a subagent.
2. **Sync template copy** — Copy the updated hook to `all/copy-overwrite/.claude/hooks/track-plan-sessions.sh`. Use a subagent.
3. **Update .gitignore** — Add `.active-plan-*` and `.track-plan-debug.log` patterns to relevant gitignore files. Use a subagent.
4. **Update/add documentation** — Update the preamble comments in the hook script explaining the marker file approach, the mtime vs ctime issue, and the debug logging.
5. **Test the fix end-to-end** — Manually verify by entering plan mode, writing a plan, checking marker file and debug log, confirming session ID lands in the correct plan file.
6. **Archive the plan** — After all other tasks complete:
   - Create folder `fix-track-plan-sessions` in `./plans/completed`
   - Rename this plan to a name befitting the actual plan contents
   - Move it into `./plans/completed/fix-track-plan-sessions`
   - Read the session IDs from `./plans/completed/fix-track-plan-sessions`
   - For each session ID, move `~/.claude/tasks/<session-id>` directory to `./plans/completed/fix-track-plan-sessions/tasks`

Tasks 1-4 can run in parallel via subagents. Task 5 depends on 1-4. Task 6 runs last.

## Sessions
| e867ba9e-7d17-4027-b2b9-f3ea95c20b52 | 2026-02-03T00:09:17Z | plan |
| b7f38936-9c17-48fd-8f31-a32af94b308e | 2026-02-03T00:16:19Z | implement |

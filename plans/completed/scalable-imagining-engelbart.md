# Fix: Replace Active Plan Marker with Most-Recent-File Detection

Replace the `.claude-active-plan` marker file approach in `track-plan-sessions.sh` with automatic detection of the most recently modified plan file in `plans/`. This eliminates the bug where the marker was never created due to absolute vs relative path mismatch.

## Problem

The `track-plan-sessions.sh` hook's PostToolUse trigger compares `file_path` from tool input (absolute, e.g. `/Users/cody/workspace/lisa/plans/foo.md`) against `./plans` (relative). The prefix check on line 53 never matches, so the `.claude-active-plan` marker file is never written. This means the UserPromptSubmit trigger (which reads the marker) also does nothing.

## Solution

Remove the marker file approach entirely. Instead, in the UserPromptSubmit path, find the most recently modified `.md` file in the plans directory and use that as the active plan. Keep the PostToolUse path for stamping sessions immediately after a plan file edit (but fix the path comparison).

## Changes

### 1. `.claude/hooks/track-plan-sessions.sh`

**PostToolUse path (lines 40-59):** Fix the path comparison to handle absolute paths. Resolve `PLANS_DIR` to an absolute path before comparing:

```bash
# Resolve PLANS_DIR to absolute path for comparison
ABS_PLANS_DIR=$(cd "$PLANS_DIR" 2>/dev/null && pwd)

if [[ -z "$ABS_PLANS_DIR" ]]; then
  exit 0
fi

# Check if the written file is in the plans directory
if [[ "$FILE_PATH" == "$ABS_PLANS_DIR"/* ]]; then
  PLAN_FILE="$FILE_PATH"
else
  exit 0
fi
```

**UserPromptSubmit path (lines 61-75):** Replace marker file reading with most-recently-modified file detection:

```bash
elif [[ "$HOOK_EVENT" == "UserPromptSubmit" ]]; then
  # Find the most recently modified .md file in plans directory
  PLAN_FILE=$(ls -t "$PLANS_DIR"/*.md 2>/dev/null | head -1)

  if [[ -z "$PLAN_FILE" || ! -f "$PLAN_FILE" ]]; then
    exit 0
  fi
```

**Remove all marker file references:** Delete `MARKER_FILE=".claude-active-plan"` and the `echo "$PLAN_FILENAME" > "$MARKER_FILE"` line.

### 2. Cleanup

- Remove `.claude-active-plan` from `.gitignore` (and `all/copy-contents/.gitignore`)
- Delete `.claude-active-plan` file if it exists (it doesn't currently)

### 3. Update script preamble comment

Update the header comment to reflect the new behavior — no more marker file, UserPromptSubmit uses most-recently-modified detection.

## Files to Modify

| File | Change |
|------|--------|
| `.claude/hooks/track-plan-sessions.sh` | Fix absolute path comparison, replace marker with `ls -t` detection |
| `.gitignore` | Remove `.claude-active-plan` entry |
| `all/copy-contents/.gitignore` | Remove `.claude-active-plan` entry |

## Skills

- `git:commit` — commit the changes
- Push to existing PR on branch `fix/expo-knip-and-tsconfig`

## Tests / Documentation

- **Tests:** No unit tests exist for hooks currently. Manual verification below.
- **Documentation:** Update JSDoc preamble in `track-plan-sessions.sh`.

## Verification

```bash
# 1. Verify the hook resolves the most recent plan file
echo '{"session_id":"test-123","permission_mode":"plan","hook_event_name":"UserPromptSubmit"}' | \
  CLAUDE_PROJECT_DIR=. bash .claude/hooks/track-plan-sessions.sh

# 2. Check that the most recent plan file got the session stamped
tail -5 plans/scalable-imagining-engelbart.md

# 3. Verify PostToolUse path works with absolute paths
echo '{"session_id":"test-456","permission_mode":"plan","hook_event_name":"PostToolUse","tool_input":{"file_path":"'"$(pwd)"'/plans/scalable-imagining-engelbart.md"}}' | \
  CLAUDE_PROJECT_DIR=. bash .claude/hooks/track-plan-sessions.sh

# 4. Confirm marker file references are gone
grep -r "claude-active-plan" .gitignore .claude/hooks/track-plan-sessions.sh
# Expected: no matches
```

## Archive Task

After all tasks complete:
1. Create `./plans/completed/fix-active-plan-detection/`
2. Move this plan into it
3. Read session IDs from the plan
4. Move `~/.claude/tasks/<session-id>` directories to `./plans/completed/fix-active-plan-detection/tasks`

## Sessions

<!-- Auto-maintained by track-plan-sessions.sh -->
| Session ID | First Seen | Phase |
|------------|------------|-------|
| 6acc688d-9b07-4854-83dd-acef2db80c46 | 2026-02-02T23:37:04Z | implement |
| 2863632b-a243-458b-9c3c-167efee01bf6 | 2026-02-02T23:39:23Z | plan |

# Fix track-plan-sessions.sh Dedup False Positive

## Summary

The `track-plan-sessions.sh` hook's dedup check (`grep -qF "$SESSION_ID" "$PLAN_FILE"`) searches the **entire file** for the session ID string. When a session ID appears in plan content (e.g., in scratchpad paths like `/private/tmp/claude-501/-Users-cody-workspace-lisa/68a7b384-a3cc-4e42-9077-c40c76e70232/scratchpad/play-horn.sh`), the grep matches it and incorrectly skips writing the `## Sessions` table entry.

## Root Cause

Line 127 of `.claude/hooks/track-plan-sessions.sh`:

```bash
if grep -qF "$SESSION_ID" "$PLAN_FILE" 2>/dev/null; then
```

This searches all file content. The session ID `68a7b384-a3cc-4e42-9077-c40c76e70232` appeared in the plan body as part of a scratchpad directory path, causing a false-positive dedup match.

## Branch Strategy

On `feat/add-task-spec-to-plan-rules` with open PR #139 to `main`. Push changes to this PR.

## Skills to Use

- `/coding-philosophy`

## Implementation Plan

**Fix:** Restrict the dedup grep to only search within the `## Sessions` section of the plan file, not the entire file content.

Replace lines 126-130 in both files:
- `.claude/hooks/track-plan-sessions.sh`
- `all/copy-overwrite/.claude/hooks/track-plan-sessions.sh`

**Current (buggy):**

```bash
# Check if session ID already exists in the file (dedup)
if grep -qF "$SESSION_ID" "$PLAN_FILE" 2>/dev/null; then
  log_debug "dedup: session ID already in $PLAN_FILE (resolved via $RESOLUTION_METHOD), skipping write"
  exit 0
fi
```

**Fixed:**

```bash
# Check if session ID already exists in the ## Sessions section (dedup)
# Only search within the Sessions section to avoid false positives from session IDs
# appearing in plan content (e.g., scratchpad paths contain session IDs)
if sed -n '/^## Sessions$/,$p' "$PLAN_FILE" 2>/dev/null | grep -qF "$SESSION_ID"; then
  log_debug "dedup: session ID already in $PLAN_FILE sessions section (resolved via $RESOLUTION_METHOD), skipping write"
  exit 0
fi
```

The `sed -n '/^## Sessions$/,$p'` extracts only the content from `## Sessions` to end-of-file, then pipes to `grep`. If `## Sessions` doesn't exist yet, `sed` outputs nothing, `grep` finds no match, and the session gets written — which is the correct behavior.

## Task List

Create the following tasks using `TaskCreate`. Tasks 1 and 2 can run in parallel.

### Task 1: Fix dedup grep in track-plan-sessions.sh

- **subject**: "Fix dedup grep to only search Sessions section in track-plan-sessions.sh"
- **activeForm**: "Fixing dedup grep in track-plan-sessions.sh"
- **description**:

**Type:** Bug

**Description:** The dedup check on line 127 of `track-plan-sessions.sh` uses `grep -qF "$SESSION_ID" "$PLAN_FILE"` which searches the entire file. Session IDs appearing in plan content (e.g., scratchpad paths) cause false-positive dedup matches, preventing the `## Sessions` table from being created.

**Acceptance Criteria:**
- [ ] Dedup grep restricted to `## Sessions` section only
- [ ] Both files updated: `.claude/hooks/track-plan-sessions.sh` and `all/copy-overwrite/.claude/hooks/track-plan-sessions.sh`
- [ ] Debug log message updated to say "sessions section"
- [ ] Hook comment updated to explain why the restriction exists

**Relevant Research:**
- Bug file: `.claude/hooks/track-plan-sessions.sh:127`
- Template file: `all/copy-overwrite/.claude/hooks/track-plan-sessions.sh:127`
- Both files are identical and must stay in sync
- `sed -n '/^## Sessions$/,$p'` extracts from the Sessions header to EOF; outputs nothing if section doesn't exist

**Skills to Invoke:** `/coding-philosophy`

**Implementation Details:**
- Replace lines 126-130 in both files with the `sed` + `grep` pipeline shown in the plan
- Update the comment from "already exists in the file" to "already exists in the ## Sessions section"
- Update the debug log message similarly

**Testing Requirements:**

```
describe("track-plan-sessions.sh dedup check")
  it("should not false-positive when session ID appears in plan content")
  it("should correctly dedup when session ID is in the Sessions table")
  it("should write session when Sessions section does not exist")
```

**Verification:**
- Type: `manual-check`
- Command: `echo '{"session_id":"test-1234","permission_mode":"plan","hook_event_name":"PostToolUse","tool_input":{"file_path":"PLAN_FILE_PATH"}}' | bash .claude/hooks/track-plan-sessions.sh` (with a plan file containing "test-1234" in body but not in Sessions)
- Expected: Session is written to `## Sessions` section despite the ID appearing elsewhere in the file

**Learnings:** On task completion, use `TaskUpdate` to save discoveries: `metadata: { learnings: [...] }`

**Metadata:**
```json
{
  "plan": "fix-track-plan-sessions-dedup",
  "type": "bug",
  "skills": ["/coding-philosophy"],
  "verification": {
    "type": "manual-check",
    "command": "grep -c 'sed -n' .claude/hooks/track-plan-sessions.sh && diff .claude/hooks/track-plan-sessions.sh all/copy-overwrite/.claude/hooks/track-plan-sessions.sh",
    "expected": "1 (sed usage present) and no diff (files in sync)"
  }
}
```

### Task 2: Add/update tests

- **subject**: "Add test for track-plan-sessions.sh dedup false positive"
- **activeForm**: "Adding test for dedup false positive fix"
- **description**:

**Type:** Task

**Description:** Create a shell-based integration test that verifies the dedup logic correctly distinguishes between session IDs in plan content vs. the `## Sessions` table.

**Acceptance Criteria:**
- [ ] Test verifies session ID in plan body does NOT trigger dedup
- [ ] Test verifies session ID in Sessions table DOES trigger dedup
- [ ] Test verifies missing Sessions section results in session being written

**Relevant Research:** No existing test file for this hook. The hook reads JSON from stdin and operates on plan files in the `plans/` directory.

**Skills to Invoke:** `/coding-philosophy`

**Implementation Details:**
- Create test script or Jest test that:
  1. Creates a temp plan file with a session ID embedded in body text
  2. Runs the hook with that same session ID
  3. Asserts `## Sessions` section was created with the session ID
  4. Runs the hook again with the same session ID
  5. Asserts no duplicate entry was added

**Testing Requirements:** This IS the test task.

**Verification:**
- Type: `test`
- Command: `bun test -- track-plan-sessions`
- Expected: All tests pass

**Learnings:** On task completion, use `TaskUpdate` to save discoveries: `metadata: { learnings: [...] }`

**Metadata:**
```json
{
  "plan": "fix-track-plan-sessions-dedup",
  "type": "task",
  "skills": ["/coding-philosophy"],
  "verification": {
    "type": "test",
    "command": "bun test -- track-plan-sessions",
    "expected": "All tests pass"
  }
}
```

### Task 3: Update documentation

- **subject**: "Update track-plan-sessions.sh preamble comment"
- **activeForm**: "Updating track-plan-sessions.sh preamble"
- **description**:

**Type:** Task

**Description:** Update the file preamble comment in `track-plan-sessions.sh` to document the scoped dedup behavior and the false-positive bug it fixes.

**Acceptance Criteria:**
- [ ] Preamble mentions that dedup is scoped to the `## Sessions` section
- [ ] Both files updated (project and template)

**Relevant Research:** Current preamble (lines 1-22) describes the hook's triggers and marker files but doesn't mention dedup scoping.

**Skills to Invoke:** `/coding-philosophy`, `/jsdoc-best-practices`

**Implementation Details:** Add a note to the preamble explaining the dedup scope.

**Testing Requirements:** N/A

**Verification:**
- Type: `documentation`
- Command: `head -25 .claude/hooks/track-plan-sessions.sh | grep -c 'Sessions section'`
- Expected: At least 1 match

**Metadata:**
```json
{
  "plan": "fix-track-plan-sessions-dedup",
  "type": "task",
  "skills": ["/coding-philosophy", "/jsdoc-best-practices"],
  "verification": {
    "type": "documentation",
    "command": "head -25 .claude/hooks/track-plan-sessions.sh | grep -c 'Sessions section'",
    "expected": "1"
  }
}
```

### Task 4: Archive the plan

- **subject**: "Archive fix-track-plan-sessions-dedup plan"
- **activeForm**: "Archiving fix-track-plan-sessions-dedup plan"
- **description**:

**Type:** Task

**Description:** Archive the plan after all other tasks are completed.

**Acceptance Criteria:**
- [ ] Create folder `fix-track-plan-sessions-dedup` in `./plans/completed`
- [ ] Rename this plan to `fix-track-plan-sessions-dedup.md`
- [ ] Move it into `./plans/completed/fix-track-plan-sessions-dedup/`
- [ ] Read session IDs from `./plans/completed/fix-track-plan-sessions-dedup/fix-track-plan-sessions-dedup.md`
- [ ] For each session ID, move `~/.claude/tasks/<session-id>` directory to `./plans/completed/fix-track-plan-sessions-dedup/tasks`

**Skills to Invoke:** `/coding-philosophy`

**Implementation Details:** Standard plan archival process.

**Testing Requirements:** N/A

**Verification:**
- Type: `manual-check`
- Command: `ls ./plans/completed/fix-track-plan-sessions-dedup/fix-track-plan-sessions-dedup.md`
- Expected: File exists

**Metadata:**
```json
{
  "plan": "fix-track-plan-sessions-dedup",
  "type": "task",
  "skills": ["/coding-philosophy"],
  "verification": {
    "type": "manual-check",
    "command": "ls ./plans/completed/fix-track-plan-sessions-dedup/fix-track-plan-sessions-dedup.md",
    "expected": "File exists"
  }
}
```

## Sessions

<!-- Auto-maintained by track-plan-sessions.sh -->
| Session ID | First Seen | Phase |
|------------|------------|-------|
| 9b44165c-a14e-4437-b185-9924d7aaaf9b | 2026-02-03T14:57:18Z | plan |

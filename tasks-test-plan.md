# Task Syncing Feature - Test Plan

## Overview

This document describes the task syncing feature implementation and how to test it. This feature enables Claude Code tasks to be synced to project directories so they can be checked into git and shared with the team.

## What Was Implemented

### Problem Statement

Claude Code's task management system (v2.1.16+) stores tasks in `~/.claude/tasks/{session-uuid}/`, which is:
- Session-specific (new UUID each session)
- Outside the repo
- Not shareable with team

We needed a way to sync tasks to `./projects/{project-name}/tasks/` so they're version-controlled.

### Solution Architecture

```
User prompt (complex, score 5+)
         ↓
prompt-complexity-scorer suggests creating a project
         ↓
Project created: projects/{name}/ + .claude-active-project marker
         ↓
TaskCreate calls include metadata: { "project": "{name}" }
         ↓
PostToolUse hook (sync-tasks.sh) syncs to ./projects/{name}/tasks/
         ↓
Tasks are in repo, shareable with team
```

### Files Created/Modified

#### New Files

| File | Purpose |
|------|---------|
| `all/copy-overwrite/.claude/hooks/sync-tasks.sh` | PostToolUse hook that syncs tasks to project directories |
| `all/copy-overwrite/.claude/commands/tasks/load.md` | `/tasks:load {project}` - Load tasks from project into session |
| `all/copy-overwrite/.claude/commands/tasks/sync.md` | `/tasks:sync {project}` - Manual sync of session tasks to project |

#### Modified Files

| File | Changes |
|------|---------|
| `all/copy-overwrite/.claude/skills/prompt-complexity-scorer/SKILL.md` | Now suggests creating projects (not specs) for complex prompts; sets `.claude-active-project` marker |
| `all/copy-overwrite/.claude/settings.json` | Added PostToolUse hook for `TaskCreate\|TaskUpdate` |
| `all/copy-overwrite/.claude/commands/project/fix-linter-error.md` | Migrated from TodoWrite to Task tools; added project context check |
| `all/copy-overwrite/.claude/commands/project/add-test-coverage.md` | Migrated from TodoWrite to Task tools; added project context check |
| `all/copy-overwrite/.claude/commands/project/lower-code-complexity.md` | Migrated from TodoWrite to Task tools; added project context check |
| `all/copy-contents/.gitignore` | Added `.claude-active-project` (session-specific, not committed) |

### How It Works

#### 1. Project Context Detection

Commands check for active project at the start:

```bash
cat .claude-active-project 2>/dev/null
```

If found, include `metadata: { "project": "<name>" }` in TaskCreate calls.

#### 2. Task Syncing Hook

`sync-tasks.sh` is triggered on PostToolUse for TaskCreate/TaskUpdate:

1. Reads `tool_input.metadata.project` from hook input JSON
2. Falls back to `.claude-active-project` marker file
3. Finds task JSON in `~/.claude/tasks/{session}/`
4. Copies to `./projects/{project}/tasks/{id}.json`
5. Stages file for git

#### 3. Loading Tasks

`/tasks:load {project}` command:

1. Reads JSON files from `./projects/{project}/tasks/`
2. Creates tasks in current session via TaskCreate
3. Sets `.claude-active-project` for continued syncing

## Test Plan

### Unit Test: Hook Script

```bash
#!/usr/bin/env bash
# Run from repo root

set -e

echo "=== Testing sync-tasks.sh ==="

# Setup
TEST_PROJECT="test-sync-$(date +%s)"
mkdir -p "projects/$TEST_PROJECT/tasks"
echo "$TEST_PROJECT" > .claude-active-project

# Create mock task in Claude's task directory
MOCK_SESSION="test-session-$$"
mkdir -p "$HOME/.claude/tasks/$MOCK_SESSION"
cat > "$HOME/.claude/tasks/$MOCK_SESSION/42.json" << 'EOF'
{
  "id": "42",
  "subject": "Test task",
  "description": "Testing sync",
  "activeForm": "Testing",
  "status": "pending",
  "blocks": [],
  "blockedBy": []
}
EOF

# Test 1: Sync via metadata.project
echo "Test 1: Sync via metadata.project"
echo '{"tool_name":"TaskCreate","tool_input":{"metadata":{"project":"'"$TEST_PROJECT"'"}},"tool_output":{"id":"42"}}' | .claude/hooks/sync-tasks.sh

if [[ -f "projects/$TEST_PROJECT/tasks/42.json" ]]; then
  echo "✓ Task synced via metadata"
else
  echo "✗ Task not synced via metadata"
  exit 1
fi

rm "projects/$TEST_PROJECT/tasks/42.json"

# Test 2: Sync via .claude-active-project fallback
echo "Test 2: Sync via .claude-active-project fallback"
echo '{"tool_name":"TaskCreate","tool_input":{},"tool_output":{"id":"42"}}' | .claude/hooks/sync-tasks.sh

if [[ -f "projects/$TEST_PROJECT/tasks/42.json" ]]; then
  echo "✓ Task synced via marker file"
else
  echo "✗ Task not synced via marker file"
  exit 1
fi

# Test 3: No sync when no project context
echo "Test 3: No sync when no project context"
rm .claude-active-project
rm "projects/$TEST_PROJECT/tasks/42.json"
echo '{"tool_name":"TaskCreate","tool_input":{},"tool_output":{"id":"42"}}' | .claude/hooks/sync-tasks.sh

if [[ ! -f "projects/$TEST_PROJECT/tasks/42.json" ]]; then
  echo "✓ Task correctly NOT synced without project context"
else
  echo "✗ Task incorrectly synced without project context"
  exit 1
fi

# Cleanup
rm -rf "projects/$TEST_PROJECT" "$HOME/.claude/tasks/$MOCK_SESSION"
rm -f .claude-active-project

echo ""
echo "=== All unit tests passed ==="
```

### Integration Test: Manual Steps

1. **Start Claude Code in the lisa repo**
   ```bash
   cd /path/to/lisa
   claude
   ```

2. **Create a test project manually**
   ```bash
   mkdir -p projects/test-integration/tasks
   echo "test-integration" > .claude-active-project
   ```

3. **Create a task with metadata**
   - Ask Claude: "Create a task to test the sync feature. Use TaskCreate with metadata project set to test-integration"

4. **Verify sync**
   ```bash
   ls projects/test-integration/tasks/
   cat projects/test-integration/tasks/*.json
   ```

5. **Test /tasks:load**
   - Clear tasks or start new session
   - Run: `/tasks:load test-integration`
   - Verify tasks appear via `TaskList`

6. **Cleanup**
   ```bash
   rm -rf projects/test-integration .claude-active-project
   ```

### End-to-End Test: Full Flow

1. **Start fresh Claude session**

2. **Trigger complexity scorer with complex prompt**
   - Ask: "Add a comprehensive logging system with multiple log levels, file rotation, and remote shipping"
   - Expected: Scores 6-8, suggests creating a project

3. **Accept project creation**
   - Should create `projects/add-logging/` with `tasks/` subdirectory
   - Should create `.claude-active-project` with "add-logging"

4. **Let Claude create tasks**
   - Continue with implementation or ask Claude to break it into tasks

5. **Verify tasks synced**
   ```bash
   ls projects/add-logging/tasks/
   ```

6. **Test cross-session persistence**
   - Exit Claude (`/exit`)
   - Start new session
   - Run `/tasks:load add-logging`
   - Verify tasks loaded

7. **Cleanup**
   ```bash
   rm -rf projects/add-logging .claude-active-project
   ```

### Edge Cases to Test

| Scenario | Test | Expected |
|----------|------|----------|
| No project context | Create task without metadata or marker | Task not synced (silent) |
| Invalid project name | Set marker to `../etc/passwd` | Rejected, warning in stderr |
| Missing tasks dir | Set marker but no `tasks/` dir | Directory created automatically |
| TaskUpdate sync | Update existing task | Updated JSON synced |
| Non-task tool | Call Write tool | Hook exits early (no sync) |

### Validation Checklist

- [ ] `sync-tasks.sh` is executable (`chmod +x`)
- [ ] Hook registered in `settings.json` for `TaskCreate|TaskUpdate`
- [ ] `.claude-active-project` in `.gitignore`
- [ ] Project commands have "Step 0: Check Project Context"
- [ ] TaskCreate examples include `metadata: { "project": "..." }`
- [ ] `/tasks:load` and `/tasks:sync` commands exist
- [ ] `prompt-complexity-scorer` suggests projects (not specs)

## Known Limitations

1. **Task dependencies not preserved** - `blocks`/`blockedBy` arrays sync but IDs change when loading into new session

2. **One active project at a time** - `.claude-active-project` is single-valued; can't work on multiple projects simultaneously

3. **Manual load required** - Tasks don't auto-load on session start; must run `/tasks:load`

4. **No conflict resolution** - If same task ID exists in project, it's overwritten

## Future Improvements

1. **Auto-load on session start** - SessionStart hook could check for recent project and offer to load tasks

2. **Task ID mapping** - Preserve original IDs or create mapping file for dependency preservation

3. **Multi-project support** - Support comma-separated projects or project stack

4. **Conflict detection** - Warn if local task differs from repo version

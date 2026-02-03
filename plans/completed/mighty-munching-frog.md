# Track Plan Session IDs via Marker File + Hooks

## Overview

Track which Claude Code sessions work on each plan file by combining a `.claude-active-plan` marker file (mirroring the `.claude-active-project` pattern) with a `UserPromptSubmit` hook that auto-stamps session IDs into the plan's `## Sessions` section.

## Research Findings

### What hooks CAN detect

| Signal | How | Reliability |
|--------|-----|-------------|
| Session ID | `session_id` field in hook stdin JSON | 100% |
| Plan mode | `permission_mode === "plan"` in stdin JSON | 100% |
| Plan file writes | `PostToolUse` on `Write\|Edit` + path check | 100% |

### What hooks CANNOT detect

- Which plan is "active" during implementation (`permission_mode` resets to `"default"`)
- Plan file path (not exposed in any hook field)
- Whether a session is implementing a plan vs ad-hoc work

### Existing pattern: `.claude-active-project`

- **Set by**: Skills (`project-plan`, `project-implement`, `project-execute`, etc.) via `echo "project-name" > .claude-active-project`
- **Read by**: `sync-tasks.sh` hook as fallback when task metadata lacks project name
- **Cleaned up by**: `project-archive` skill via `rm -f .claude-active-project`
- **Format**: Plain text, kebab-case project name
- **Git-ignored**: Yes (line 188 of `.gitignore`)
- **Note**: `sync-tasks.sh` exists but is currently **not wired** into `settings.json`

## Design

### How it works

```text
┌─ Plan Mode (permission_mode === "plan")
│  └─ PostToolUse on Write|Edit to plans/
│     └─ Hook detects plan file write
│        ├─ Sets .claude-active-plan → plan filename
│        └─ Stamps session ID into plan's ## Sessions table
│
├─ Plan Approval (ExitPlanMode)
│  └─ .claude-active-plan persists across mode change
│
├─ Implementation (permission_mode === "default")
│  └─ UserPromptSubmit hook
│     ├─ Reads .claude-active-plan
│     ├─ If set, stamps session ID into plan's ## Sessions table
│     └─ Deduplicates (same session only recorded once)
│
└─ Cleanup
   └─ project-archive skill or manual rm
      └─ Deletes .claude-active-plan
```

### Marker file: `.claude-active-plan`

- **Format**: Plain text, plan filename only (e.g., `mighty-munching-frog.md`)
- **Location**: Project root (same as `.claude-active-project`)
- **Set automatically**: By the `PostToolUse` hook when a plan file is written
- **Can also be set manually**: By skills or Claude instructions
- **Cleaned up**: By `project-archive` skill or manually

### Plan file format

Each plan gets a `## Sessions` section (auto-created if missing):

```markdown
## Sessions

<!-- Auto-maintained by track-plan-sessions.sh -->
| Session ID | First Seen | Phase |
|------------|------------|-------|
| a1b2c3d4-... | 2026-02-02T10:30:00Z | plan |
| e5f6g7h8-... | 2026-02-02T11:45:00Z | implement |
```

Phase is derived from `permission_mode`: `plan` when in plan mode, `implement` otherwise.

## Implementation Plan

Subagents should handle Tasks 1-3 in parallel.

### Task 1: Create `track-plan-sessions.sh` hook

**File**: `.claude/hooks/track-plan-sessions.sh`

Two triggers, one script:

**Trigger A — `PostToolUse` on `Write|Edit`**:
1. Extract `session_id`, `permission_mode`, `tool_input.file_path` from stdin JSON
2. Resolve `plansDirectory` from `.claude/settings.json` (default `./plans`)
3. If the written file is in `plansDirectory`:
   - Write plan filename to `.claude-active-plan`
   - Append session ID row to `## Sessions` table (create section if missing)
   - Dedup: skip if session ID already in table

**Trigger B — `UserPromptSubmit`**:
1. Extract `session_id`, `permission_mode` from stdin JSON
2. If `.claude-active-plan` exists:
   - Read plan filename from marker
   - Resolve full path via `plansDirectory`
   - Append session ID row to `## Sessions` table (create section if missing)
   - Dedup: skip if session ID already in table
3. Determine trigger from `hook_event_name` field

**Reusable code**: Session ID extraction pattern from `sync-tasks.sh`, jq parsing from `enforce-plan-rules.sh`

### Task 2: Wire hook into `.claude/settings.json`

Add two entries:
1. `PostToolUse` array: matcher `Write|Edit`, command `track-plan-sessions.sh`, timeout 5
2. `UserPromptSubmit` array: matcher `""`, command `track-plan-sessions.sh`, timeout 5

### Task 3: Update `.gitignore` and ESLint ignore

- Add `.claude-active-plan` to `.gitignore` (next to `.claude-active-project` on line 188)
- Add `.claude-active-plan` to `eslint.ignore.config.json` (next to `.claude-active-project`)

### Task 4: Update plan mode rules

**File**: `.claude/rules/plan.md`

- Add instruction: "The `## Sessions` section in plan files is auto-maintained by a hook — do not manually edit it"
- No need for Claude to manually add session IDs (the hook handles everything)

### Task 5: Propagate to downstream templates

- Copy `track-plan-sessions.sh` to `all/copy-overwrite/.claude/hooks/`
- Update `all/copy-overwrite/.claude/settings.json` with hook entries
- Add `.claude-active-plan` to template `.gitignore` and `eslint.ignore.config.json`

### Task 6: Wire `sync-tasks.sh` (bonus fix)

`sync-tasks.sh` exists but is **not wired** into `settings.json`. Add it:
- `PostToolUse` array: matcher `TaskCreate|TaskUpdate`, command `sync-tasks.sh`, timeout 5

### Task 7: Update documentation

- Update relevant docs to describe session tracking

## Critical Files

| File | Action |
|------|--------|
| `.claude/hooks/track-plan-sessions.sh` | Create |
| `.claude/settings.json` | Edit (add 2 hook entries + wire sync-tasks.sh) |
| `.claude/rules/plan.md` | Edit (add Sessions section note) |
| `.gitignore` | Edit (add `.claude-active-plan`) |
| `eslint.ignore.config.json` | Edit (add `.claude-active-plan`) |
| `all/copy-overwrite/.claude/hooks/track-plan-sessions.sh` | Create |
| `all/copy-overwrite/.claude/settings.json` | Edit (add hook entries) |
| `all/copy-overwrite/.gitignore` | Edit (if exists) |

## Skills to Use

- `/hooks-expert` for creating and validating the hook
- `/git:commit` for atomic commits
- `/jsdoc-best-practices` if any TypeScript is involved

## Verification

```bash
# 1. Verify hook is executable
ls -la .claude/hooks/track-plan-sessions.sh

# 2. Verify hook is wired in settings
jq '.hooks.PostToolUse[] | select(.hooks[].command | contains("track-plan"))' .claude/settings.json
jq '.hooks.UserPromptSubmit[] | select(.hooks[].command | contains("track-plan"))' .claude/settings.json

# 3. Test PostToolUse trigger (plan mode write)
echo '## Test Plan' > ./plans/test-session-tracking.md
echo '{"session_id":"test-aaa","permission_mode":"plan","tool_name":"Write","tool_input":{"file_path":"./plans/test-session-tracking.md"},"hook_event_name":"PostToolUse"}' | .claude/hooks/track-plan-sessions.sh
grep "test-aaa" ./plans/test-session-tracking.md  # should find it
cat .claude-active-plan  # should contain "test-session-tracking.md"

# 4. Test UserPromptSubmit trigger (implementation session)
echo '{"session_id":"test-bbb","permission_mode":"default","prompt":"implement the plan","hook_event_name":"UserPromptSubmit"}' | .claude/hooks/track-plan-sessions.sh
grep "test-bbb" ./plans/test-session-tracking.md  # should find it

# 5. Test dedup (same session again)
echo '{"session_id":"test-bbb","permission_mode":"default","prompt":"continue","hook_event_name":"UserPromptSubmit"}' | .claude/hooks/track-plan-sessions.sh
grep -c "test-bbb" ./plans/test-session-tracking.md  # should be 1, not 2

# 6. Cleanup
rm ./plans/test-session-tracking.md .claude-active-plan

# 7. Verify .gitignore
grep ".claude-active-plan" .gitignore
```

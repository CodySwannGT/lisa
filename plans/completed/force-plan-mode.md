# Enforce Plan Mode Before Code Changes

## Problem

When a user asks Claude Code to make modifications, Claude should create a plan first and get approval before writing code. Read-only interactions (questions, research) should work normally without planning overhead.

## Research Findings

### What Exists

| Mechanism | Enforcement | Limitation |
|-----------|------------|------------|
| `defaultMode: "plan"` in settings.json | Starts session in plan mode | User/Claude can exit; doesn't re-engage for subsequent changes |
| `PreToolUse` hook blocking Edit/Write | Hard blocks modification tools | After exiting plan mode, `permission_mode` resets to `"default"` — would block ALL edits including post-plan implementation |
| `UserPromptSubmit` hook | Injects planning reminder on every prompt | Soft enforcement only (advisory) |
| CLAUDE.md instructions | Advisory | Weakest; Claude can ignore |
| Permission denial + subagent | Architectural separation | Overly restrictive; main agent can't run any commands |

### The `permission_mode` Timing Problem

The `PreToolUse` hook approach has a fundamental flaw: after a user approves a plan and Claude exits plan mode to implement it, `permission_mode` resets to `"default"`. A hook that blocks edits when not in plan mode would also block the implementation phase. There's no clean way to distinguish "just exited plan mode with approval" from "never planned at all."

### Recommended Approach

**Layer 1 (Hard):** `defaultMode: "plan"` — forces plan mode at session start. The first interaction requiring changes must go through planning.

**Layer 2 (Soft but effective):** `UserPromptSubmit` hook — injects a planning reminder into Claude's context on every new user message. This catches subsequent change requests within the same session.

**Layer 3 (Documentation):** CLAUDE.md rule — belt-and-suspenders reinforcement.

This combination handles the core use case: Claude starts in plan mode, must plan before first changes, and gets reminded to plan for subsequent changes. It's not 100% deterministic for subsequent changes (Layer 2 is advisory), but it avoids the `permission_mode` timing problem.

## Implementation Plan

### Task 1: Add `defaultMode: "plan"` to all settings.json templates

Update each stack's `copy-overwrite/.claude/settings.json` to include:

```json
{
  "permissions": {
    "defaultMode": "plan"
  }
}
```

**Files to modify:**
- `all/copy-overwrite/.claude/settings.json`
- `typescript/copy-overwrite/.claude/settings.json`
- `expo/copy-overwrite/.claude/settings.json`
- `nestjs/copy-overwrite/.claude/settings.json`
- `cdk/copy-overwrite/.claude/settings.json`

Also update Lisa's own `.claude/settings.json`.

### Task 2: Create `enforce-plan-mode.sh` hook script

Create `all/copy-overwrite/.claude/hooks/enforce-plan-mode.sh` that reads from stdin and outputs a planning reminder. This runs on `UserPromptSubmit` and injects context:

```bash
#!/bin/bash
# Hook: UserPromptSubmit - Remind Claude to plan before making changes
# Stdout from this hook is added to Claude's context for the current prompt.

cat << 'EOF'
PLANNING REQUIREMENT: Before making ANY code modifications (Edit, Write, file changes),
you MUST first create a plan and get explicit user approval. Use EnterPlanMode or create
a plan file in the plans directory. Read-only operations (research, questions, analysis)
do not require planning. If the user's request requires code changes, enter plan mode first.
EOF
```

**File:** `all/copy-overwrite/.claude/hooks/enforce-plan-mode.sh`

### Task 3: Wire up the hook in all settings.json templates

Add to the `UserPromptSubmit` hook array in each settings.json:

```json
{
  "matcher": "",
  "hooks": [
    {
      "type": "command",
      "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/enforce-plan-mode.sh",
      "timeout": 5
    }
  ]
}
```

**Files:** Same settings.json files as Task 1.

### Task 4: Add CLAUDE.md template rule

Add planning enforcement to the CLAUDE.md governance content that Lisa manages. This goes in the template that generates CLAUDE.md rules for projects.

```markdown
Always enter plan mode (Shift+Tab or EnterPlanMode) before making code modifications.
Read-only operations (questions, research, analysis) do not require planning.
```

**Files to find:** The CLAUDE.md template source in Lisa (need to locate the template that generates project CLAUDE.md files).

### Task 5: Apply to Lisa's own configuration

Update Lisa's own `.claude/settings.json` with the same changes (dogfooding).

### Task 6: Test empirically

1. Run `lisa` on a test project to deploy templates
2. Start a Claude Code session in the test project
3. Verify session starts in plan mode
4. Ask a question (should work without planning)
5. Request a code change (should trigger planning workflow)
6. After plan approval, verify implementation proceeds normally

## Critical Files

| File | Action |
|------|--------|
| `.claude/settings.json` | Add `permissions.defaultMode` and `UserPromptSubmit` hook |
| `all/copy-overwrite/.claude/settings.json` | Add `permissions.defaultMode` and `UserPromptSubmit` hook |
| `all/copy-overwrite/.claude/hooks/enforce-plan-mode.sh` | Create new hook script |
| `typescript/copy-overwrite/.claude/settings.json` | Add `permissions.defaultMode` and `UserPromptSubmit` hook |
| `expo/copy-overwrite/.claude/settings.json` | Add same |
| `nestjs/copy-overwrite/.claude/settings.json` | Add same |
| `cdk/copy-overwrite/.claude/settings.json` | Add same |

## Skills to Use During Execution

- `/hooks-expert` — For creating and validating the hook script
- `/git-commit` — For committing changes
- `/lisa-review-implementation` — To verify template consistency after changes

## Verification

```bash
# 1. Verify settings.json has defaultMode
jq '.permissions.defaultMode' .claude/settings.json
# Expected: "plan"

# 2. Verify hook script exists and is executable
ls -la all/copy-overwrite/.claude/hooks/enforce-plan-mode.sh

# 3. Verify hook is wired in settings
jq '.hooks.UserPromptSubmit' all/copy-overwrite/.claude/settings.json
# Expected: contains enforce-plan-mode.sh entry

# 4. Run Lisa on a test project and verify deployment
# (manual verification in a fresh Claude Code session)
```

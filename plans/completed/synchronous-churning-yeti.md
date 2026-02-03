# Plan Mode Prompt Injection Hook

## Overview

Create a `.claude/rules/plan.md` file as the single source of truth for plan-mode rules, and a `UserPromptSubmit` hook that re-injects those rules when Claude is in plan mode. Rules get loaded once at session start (normal behavior) and reinforced on every prompt while in plan mode (hook output).

## Implementation Tasks

### Task 1: Create `.claude/rules/plan.md`

Move the existing "When making a plan" rules from CLAUDE.md (lines 56-61) into `.claude/rules/plan.md` and expand as needed.

**File:** `.claude/rules/plan.md`

### Task 2: Remove plan rules from CLAUDE.md

Delete lines 56-61 from CLAUDE.md (the "When making a plan" block).

**File:** `CLAUDE.md`

### Task 3: Create `enforce-plan-rules.sh` hook script

`UserPromptSubmit` hook that:
1. Reads `permission_mode` from stdin JSON (via `jq`)
2. If `"plan"`, reads `.claude/rules/plan.md` and outputs contents to stdout (injected into Claude's context)
3. If not plan mode, exits silently

```bash
#!/bin/bash
INPUT=$(cat)
PERMISSION_MODE=$(echo "$INPUT" | jq -r '.permission_mode // "default"')

if [ "$PERMISSION_MODE" = "plan" ]; then
  PLAN_RULES="$CLAUDE_PROJECT_DIR/.claude/rules/plan.md"
  if [ -f "$PLAN_RULES" ]; then
    echo "PLAN MODE RULES (reinforced):"
    cat "$PLAN_RULES"
  fi
fi
exit 0
```

**File:** `.claude/hooks/enforce-plan-rules.sh`

### Task 4: Wire hook into settings.json

Add to `UserPromptSubmit` array in `.claude/settings.json`.

**File:** `.claude/settings.json`

### Task 5: Create Lisa templates

- `all/copy-overwrite/.claude/hooks/enforce-plan-rules.sh` — hook script (copy-overwrite, governance-managed)
- `all/create-only/.claude/rules/plan.md` — rules file (create-only, projects can customize)
- Update all stack `settings.json` templates with the hook wiring
- Update CLAUDE.md templates to remove the "When making a plan" block

### Task 6: Update documentation

Update any relevant docs reflecting where plan rules now live.

## Critical Files

| File | Action |
|------|--------|
| `.claude/rules/plan.md` | Create |
| `CLAUDE.md` | Edit — remove lines 56-61 |
| `.claude/hooks/enforce-plan-rules.sh` | Create |
| `.claude/settings.json` | Edit — add UserPromptSubmit hook |
| `all/copy-overwrite/.claude/hooks/enforce-plan-rules.sh` | Create |
| `all/create-only/.claude/rules/plan.md` | Create |
| `all/copy-overwrite/.claude/settings.json` | Edit — add hook |
| `typescript/copy-overwrite/.claude/settings.json` | Edit — add hook |
| `expo/copy-overwrite/.claude/settings.json` | Edit — add hook |
| `nestjs/copy-overwrite/.claude/settings.json` | Edit — add hook |
| `cdk/copy-overwrite/.claude/settings.json` | Edit — add hook |

## Skills to Use During Execution

- `/hooks-expert` — Creating and validating the hook script
- `/git-commit` — Committing changes

## Verification

```bash
# 1. plan.md exists with rules
cat .claude/rules/plan.md

# 2. CLAUDE.md no longer has plan rules
grep -c "When making a plan" CLAUDE.md
# Expected: 0

# 3. Hook is executable
ls -la .claude/hooks/enforce-plan-rules.sh

# 4. Hook wired in settings
jq '.hooks.UserPromptSubmit' .claude/settings.json

# 5. Simulate plan mode — should output plan.md contents
echo '{"permission_mode":"plan"}' | .claude/hooks/enforce-plan-rules.sh

# 6. Simulate normal mode — should produce no output
echo '{"permission_mode":"default"}' | .claude/hooks/enforce-plan-rules.sh
```

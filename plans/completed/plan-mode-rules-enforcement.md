# Plan Mode Rules Enforcement

## Overview

Create a `.claude/rules/plan.md` file containing all plan-mode-specific rules, and a `UserPromptSubmit` hook that re-injects those rules when Claude is in plan mode. This gives double reinforcement: rules are loaded once at session start (normal rules behavior) and injected again on every prompt while in plan mode (hook behavior).

## Implementation Tasks

### Task 1: Create `.claude/rules/plan.md`

Move existing plan rules from CLAUDE.md (lines 56-61) into a dedicated file and expand them.

**File:** `.claude/rules/plan.md`

Contents should include:
- The existing "When making a plan" rules currently in CLAUDE.md
- Any additional plan-mode requirements

### Task 2: Remove plan rules from CLAUDE.md

Remove lines 56-61 from CLAUDE.md (the "When making a plan" block) since they'll live in `plan.md` now.

**File:** `CLAUDE.md`

### Task 3: Create `enforce-plan-rules.sh` hook script

Create a `UserPromptSubmit` hook script that:
1. Reads `permission_mode` from stdin JSON
2. If `permission_mode` is `"plan"`, reads `.claude/rules/plan.md` and outputs its contents to stdout
3. If not in plan mode, exits silently (no output)

Stdout from `UserPromptSubmit` hooks gets injected into Claude's context for the current prompt.

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

Add the hook to the `UserPromptSubmit` array in `.claude/settings.json`:

```json
{
  "matcher": "",
  "hooks": [
    {
      "type": "command",
      "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/enforce-plan-rules.sh",
      "timeout": 5
    }
  ]
}
```

**File:** `.claude/settings.json`

### Task 5: Create Lisa templates

Add the same files to Lisa's template directories so all managed projects get this:

- `all/copy-overwrite/.claude/hooks/enforce-plan-rules.sh` — the hook script
- `all/create-only/.claude/rules/plan.md` — the rules file (`create-only` so projects can customize their plan rules)
- Update `all/copy-overwrite/.claude/settings.json` and each stack's settings.json with the hook wiring
- Update CLAUDE.md templates to remove the "When making a plan" block

### Task 6: Test empirically

1. Start a Claude Code session (should load plan.md rules normally)
2. Enter plan mode (Shift+Tab)
3. Submit a prompt — hook should inject plan.md contents again
4. Verify Claude follows plan-mode rules
5. Exit plan mode — hook should stop injecting plan rules
6. Submit a prompt in normal mode — no extra injection

## Critical Files

| File | Action |
|------|--------|
| `.claude/rules/plan.md` | Create — plan-mode rules |
| `CLAUDE.md` | Edit — remove "When making a plan" lines 56-61 |
| `.claude/hooks/enforce-plan-rules.sh` | Create — conditional hook script |
| `.claude/settings.json` | Edit — add UserPromptSubmit hook |
| `all/copy-overwrite/.claude/hooks/enforce-plan-rules.sh` | Create — template hook |
| `all/create-only/.claude/rules/plan.md` | Create — template rules (create-only so projects can customize) |
| `all/copy-overwrite/.claude/settings.json` | Edit — add hook wiring |
| `typescript/copy-overwrite/.claude/settings.json` | Edit — add hook wiring |
| `expo/copy-overwrite/.claude/settings.json` | Edit — add hook wiring |
| `nestjs/copy-overwrite/.claude/settings.json` | Edit — add hook wiring |
| `cdk/copy-overwrite/.claude/settings.json` | Edit — add hook wiring |

## Skills to Use During Execution

- `/hooks-expert` — For creating and validating the hook script
- `/git-commit` — For committing changes

## Verification

```bash
# 1. Verify plan.md exists
cat .claude/rules/plan.md

# 2. Verify CLAUDE.md no longer has "When making a plan" lines
grep -c "When making a plan" CLAUDE.md
# Expected: 0

# 3. Verify hook is executable
ls -la .claude/hooks/enforce-plan-rules.sh

# 4. Verify hook is wired in settings
jq '.hooks.UserPromptSubmit' .claude/settings.json

# 5. Test hook manually (simulate plan mode input)
echo '{"permission_mode":"plan"}' | .claude/hooks/enforce-plan-rules.sh
# Expected: outputs plan.md contents

# 6. Test hook manually (simulate normal mode input)
echo '{"permission_mode":"default"}' | .claude/hooks/enforce-plan-rules.sh
# Expected: no output
```

# Task: Register ast-grep Hook in .claude/settings.json

**Type:** Task
**Parent:** None

## Description

Register the sg-scan-on-edit.sh hook in the Claude settings.json file so it runs on PostToolUse events (Write and Edit operations). This follows the same pattern as the existing lint-on-edit.sh hook registration.

## Acceptance Criteria

- [ ] `sg-scan-on-edit.sh` is registered in `.claude/settings.json` PostToolUse hooks
- [ ] Hook is configured with correct matcher pattern (`Write|Edit`)
- [ ] Hook command uses bash with the hook script path

## Relevant Research

From research.md:

**Settings Configuration:** `typescript/merge/.claude/settings.json`
```json
{
  "hooks": {
    "SessionStart": [{...}],
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [
        {
          "type": "command",
          "command": "bash .claude/hooks/lint-on-edit.sh"
        }
      ]
    }]
  }
}
```

The settings.json uses `merge` strategy, so we need to add the hook to the existing PostToolUse array.

## Applicable Skills

Invoke these skills before writing implementation code:

- `/coding-philosophy` - Always required for all code

## Implementation Details

1. Read the existing `typescript/merge/.claude/settings.json` file
2. Add a new hook entry to PostToolUse for sg-scan-on-edit.sh:
```json
{
  "matcher": "Write|Edit",
  "hooks": [
    {
      "type": "command",
      "command": "bash .claude/hooks/sg-scan-on-edit.sh"
    }
  ]
}
```

Note: Because the settings file uses merge strategy and PostToolUse is an array, we need to check how to properly add to it. Looking at the existing structure, each matcher group is a separate object in the array.

Files to modify:
- `typescript/merge/.claude/settings.json`

## Testing Requirements

### Unit Tests
N/A - Configuration file modification

### Integration Tests
N/A - no integration points

### E2E Tests
N/A - no user-facing changes

## Documentation Requirements

### Code Documentation (JSDoc)
N/A - JSON configuration file

### Database Comments
N/A - no database changes

### GraphQL Descriptions
N/A - no GraphQL changes

## Verification

### Type
`manual-check`

### Proof Command
```bash
cat /Users/cody/workspace/lisa/typescript/merge/.claude/settings.json | grep -A5 'sg-scan-on-edit'
```

### Expected Output
Should show the sg-scan-on-edit.sh hook configuration with type "command" and the bash command.

## Implementation Steps

### Step 0: Setup Tracking
Use TodoWrite to create task tracking todos:
- Invoke skills
- Write failing tests
- Write implementation
- Verify implementation
- Update documentation
- Commit changes

### Step 1: Invoke Skills
Mark "Invoke skills" as in_progress.

1. Mark this task as "in progress" in `progress.md`
2. Invoke each skill listed in "Applicable Skills" using the Skill tool

Mark "Invoke skills" as completed.

### Step 2: Write Failing Tests
Mark "Write failing tests" as in_progress.

N/A - Configuration file only, no tests needed.

Mark "Write failing tests" as completed.

### Step 3: Write Implementation
Mark "Write implementation" as in_progress.

1. Read `typescript/merge/.claude/settings.json`
2. Add sg-scan-on-edit.sh to PostToolUse hooks

Mark "Write implementation" as completed.

### Step 4: Verify Implementation
Mark "Verify implementation" as in_progress.

1. Run the Proof Command from Verification section
2. Confirm output matches Expected Output
3. If verification fails, fix and re-verify

Mark "Verify implementation" as completed.

### Step 5: Update Documentation
Mark "Update documentation" as in_progress.

N/A - No documentation updates needed for this task.

Mark "Update documentation" as completed.

### Step 6: Commit Changes
Mark "Commit changes" as in_progress.

1. Run `/git:commit`
2. Mark this task as "completed" in `progress.md`
3. Record any learnings in `findings.md`

Mark "Commit changes" as completed.

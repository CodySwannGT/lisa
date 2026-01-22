# Task: Add sg:scan Script to package.json

**Type:** Task
**Parent:** None

## Description

Add the `sg:scan` npm script to the TypeScript merge package.json file, following the pattern used for other quality check scripts. This script will be used by the Claude hook, lint-staged, and CI/CD workflow.

## Acceptance Criteria

- [ ] `sg:scan` script is defined in `typescript/merge/package.json`
- [ ] Script runs `ast-grep scan` command

## Relevant Research

From research.md:

**Package.json script pattern** (claude-code-safety-net):
```json
{
  "scripts": {
    "sg:scan": "ast-grep scan"
  }
}
```

**Existing Lisa script patterns** in package.json:
- `lint`: `eslint . --quiet`
- `lint:fix`: `eslint . --fix`
- `format:check`: `prettier --check .`

## Applicable Skills

Invoke these skills before writing implementation code:

- `/coding-philosophy` - Always required for all code

## Implementation Details

1. Read the existing `typescript/merge/package.json` file
2. Add `sg:scan` script with value `ast-grep scan`

Files to modify:
- `typescript/merge/package.json`

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
cat /Users/cody/workspace/lisa/typescript/merge/package.json | grep -A1 '"sg:scan"'
```

### Expected Output
Should show `"sg:scan": "ast-grep scan"` in the scripts section.

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

1. Read `typescript/merge/package.json`
2. Add `sg:scan` script to scripts section

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

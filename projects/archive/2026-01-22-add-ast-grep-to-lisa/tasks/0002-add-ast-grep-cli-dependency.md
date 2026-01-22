# Task: Add @ast-grep/cli Dependency to package.json

**Type:** Task
**Parent:** None

## Description

Add the `@ast-grep/cli` package as a devDependency to the TypeScript merge package.json file, following Lisa's pattern for adding dependencies that should be available to all TypeScript projects.

## Acceptance Criteria

- [ ] `@ast-grep/cli` is listed in devDependencies in `typescript/merge/package.json`
- [ ] `@ast-grep/cli` is listed in trustedDependencies in `typescript/merge/package.json`
- [ ] Version follows the caret (^) pattern for semver

## Relevant Research

From research.md:

**Package.json Integration pattern** (claude-code-safety-net):
```json
{
  "devDependencies": {
    "@ast-grep/cli": "^0.40.4"
  },
  "trustedDependencies": ["@ast-grep/cli"]
}
```

**Answer from Q1**: Add to `typescript/merge/package.json` for all TypeScript projects automatically.

**Merge Strategy**: Lisa uses JSON deep merge for package.json files where:
- Lisa provides default values
- Project's values take precedence
- Missing scripts/dependencies are added without overwriting existing ones

## Applicable Skills

Invoke these skills before writing implementation code:

- `/coding-philosophy` - Always required for all code

## Implementation Details

1. Read the existing `typescript/merge/package.json` file
2. Add `@ast-grep/cli` to devDependencies with version `^0.40.4`
3. Add `@ast-grep/cli` to trustedDependencies array

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
cat /Users/cody/workspace/lisa/typescript/merge/package.json | grep -A2 '"@ast-grep/cli"' && cat /Users/cody/workspace/lisa/typescript/merge/package.json | grep -A5 'trustedDependencies'
```

### Expected Output
Should show `@ast-grep/cli` in devDependencies with a version like `^0.40.4` and in the trustedDependencies array.

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
2. Add `@ast-grep/cli` to devDependencies
3. Add `@ast-grep/cli` to trustedDependencies

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

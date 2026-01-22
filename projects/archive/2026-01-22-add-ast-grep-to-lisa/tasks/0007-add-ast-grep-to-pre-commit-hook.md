# Task: Add ast-grep to Pre-commit Hook

**Type:** Task
**Parent:** None

## Description

Add ast-grep scan as a quality check step in the Husky pre-commit hook. This should run as part of the pre-commit workflow alongside typecheck and lint-staged, only if sgconfig.yml exists in the project.

## Acceptance Criteria

- [ ] Pre-commit hook includes ast-grep scan step
- [ ] Scan only runs if sgconfig.yml exists (conditional check)
- [ ] Scan runs using the detected package manager
- [ ] Step is placed logically in the pre-commit flow (after typecheck, before/alongside lint-staged)

## Relevant Research

From research.md:

**Pre-commit Hook:** `typescript/copy-contents/.husky/pre-commit`

Current pre-commit flow:
1. Detect package manager (bun > yarn > npm)
2. Check branch protection (prevent direct commits to dev/staging/main)
3. Run Gitleaks secret detection
4. Run typecheck (`$RUNNER typecheck`)
5. Run lint-staged (`$EXECUTOR lint-staged --config .lintstagedrc.json`)

**Package Manager Detection:**
```bash
if ([ -f "bun.lockb" ] || [ -f "bun.lock" ]) && command -v bun >/dev/null 2>&1; then
  RUNNER="bun run"
  EXECUTOR="bun"
elif [ -f "yarn.lock" ] && command -v yarn >/dev/null 2>&1; then
  RUNNER="yarn"
  EXECUTOR="yarn"
elif [ -f "package-lock.json" ]; then
  RUNNER="npm run"
  EXECUTOR="npx"
else
  RUNNER="npm run"
  EXECUTOR="npx"
fi
```

The pre-commit file uses `copy-contents` strategy, meaning Lisa appends missing lines.

## Applicable Skills

Invoke these skills before writing implementation code:

- `/coding-philosophy` - Always required for all code

## Implementation Details

1. Read the existing `typescript/copy-contents/.husky/pre-commit` file
2. Add ast-grep scan step with conditional check for sgconfig.yml:

```bash
# Run ast-grep scan if sgconfig.yml exists
if [ -f "sgconfig.yml" ]; then
  echo "Running ast-grep scan..."
  $RUNNER sg:scan
fi
```

This should be added after the typecheck step and before or alongside lint-staged.

Files to modify:
- `typescript/copy-contents/.husky/pre-commit`

## Testing Requirements

### Unit Tests
N/A - Shell script modification

### Integration Tests
N/A - Manual testing via git commit

### E2E Tests
N/A - no user-facing changes

## Documentation Requirements

### Code Documentation (JSDoc)
N/A - Shell script with inline comments

### Database Comments
N/A - no database changes

### GraphQL Descriptions
N/A - no GraphQL changes

## Verification

### Type
`manual-check`

### Proof Command
```bash
grep -A3 'ast-grep\|sg:scan' /Users/cody/workspace/lisa/typescript/copy-contents/.husky/pre-commit
```

### Expected Output
Should show the conditional ast-grep scan block with the sgconfig.yml check and the `$RUNNER sg:scan` command.

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

N/A - Shell script, no unit tests needed.

Mark "Write failing tests" as completed.

### Step 3: Write Implementation
Mark "Write implementation" as in_progress.

1. Read `typescript/copy-contents/.husky/pre-commit`
2. Add ast-grep scan step with sgconfig.yml conditional

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

# Task: Create ast-grep Claude Hook

**Type:** Task
**Parent:** None

## Description

Create a Claude hook script (`sg-scan-on-edit.sh`) that runs ast-grep scan on files when Claude edits them. Unlike the lint-on-edit.sh hook which always exits 0, this hook should block (return non-zero) on errors to give Claude feedback so it can fix the issues.

## Acceptance Criteria

- [ ] `typescript/copy-overwrite/.claude/hooks/sg-scan-on-edit.sh` exists
- [ ] Hook is executable (chmod +x)
- [ ] Hook reads JSON input from stdin
- [ ] Hook extracts file path from tool_input
- [ ] Hook validates file exists and has supported extension (.ts, .tsx, .js, .jsx)
- [ ] Hook checks file is in scannable directory (src/, apps/, libs/, test/, tests/)
- [ ] Hook detects package manager from lock file
- [ ] Hook runs ast-grep scan on the specific file
- [ ] Hook returns non-zero exit code on scan errors (blocking behavior)
- [ ] Hook skips gracefully if sgconfig.yml doesn't exist

## Relevant Research

From research.md:

**Hook Pattern (lint-on-edit.sh):**
1. Read JSON input from stdin
2. Extract file path from tool_input
3. Validate file exists and has supported extension
4. Check file is in lintable directory (src/, apps/, libs/, test/, etc.)
5. Detect package manager from lock file
6. Run linter with --fix flag
7. Exit 0 always to not interrupt Claude's workflow

**Answer from Q2**: Blocking. The hook should give Claude feedback so it has to fix the error.

**Package Manager Detection:**
```bash
if ([ -f "bun.lockb" ] || [ -f "bun.lock" ]) && command -v bun >/dev/null 2>&1; then
  PACKAGE_MANAGER="bun"
elif [ -f "yarn.lock" ] && command -v yarn >/dev/null 2>&1; then
  PACKAGE_MANAGER="yarn"
elif [ -f "package-lock.json" ]; then
  PACKAGE_MANAGER="npm"
else
  PACKAGE_MANAGER="npm"
fi
```

**Existing hook reference:** `/Users/cody/workspace/lisa/typescript/copy-overwrite/.claude/hooks/lint-on-edit.sh`

## Applicable Skills

Invoke these skills before writing implementation code:

- `/coding-philosophy` - Always required for all code

## Implementation Details

Create `typescript/copy-overwrite/.claude/hooks/sg-scan-on-edit.sh`:

```bash
#!/usr/bin/env bash
# sg-scan-on-edit.sh - Run ast-grep scan on edited files
# This hook blocks on errors to give Claude feedback for fixing issues

set -euo pipefail

# Read JSON input from stdin
INPUT=$(cat)

# Extract file path from tool_input
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty')

# Skip if no file path
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Skip if sgconfig.yml doesn't exist
if [ ! -f "sgconfig.yml" ]; then
  exit 0
fi

# Skip if file doesn't exist
if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# Check file extension
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx) ;;
  *) exit 0 ;;
esac

# Check if file is in scannable directory
case "$FILE_PATH" in
  src/*|apps/*|libs/*|test/*|tests/*) ;;
  *) exit 0 ;;
esac

# Detect package manager
if ([ -f "bun.lockb" ] || [ -f "bun.lock" ]) && command -v bun >/dev/null 2>&1; then
  RUNNER="bun run"
elif [ -f "yarn.lock" ] && command -v yarn >/dev/null 2>&1; then
  RUNNER="yarn"
elif [ -f "package-lock.json" ]; then
  RUNNER="npm run"
else
  RUNNER="npm run"
fi

# Run ast-grep scan on the specific file
# This will return non-zero if there are errors, blocking Claude
$RUNNER sg:scan "$FILE_PATH"
```

## Testing Requirements

### Unit Tests
N/A - Shell script, tested via integration

### Integration Tests
N/A - Manual testing via Claude hook execution

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
ls -la /Users/cody/workspace/lisa/typescript/copy-overwrite/.claude/hooks/sg-scan-on-edit.sh && head -30 /Users/cody/workspace/lisa/typescript/copy-overwrite/.claude/hooks/sg-scan-on-edit.sh
```

### Expected Output
File should exist with executable permissions (-rwxr-xr-x) and contain the hook script with proper shebang, input parsing, file validation, package manager detection, and ast-grep scan execution.

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

1. Create `typescript/copy-overwrite/.claude/hooks/sg-scan-on-edit.sh` with the hook script
2. Make the script executable with `chmod +x`

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

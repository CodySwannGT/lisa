---
description: Fix all violations of a specific ESLint rule across the codebase
allowed-tools: Read, Write, Edit, Bash, Task, TaskCreate, TaskUpdate, TaskList, TaskGet
argument-hint: <eslint-rule-name>
model: sonnet
---

# Fix Linter Errors

Target rule: $ARGUMENTS

If no argument provided, prompt the user for a lint rule name.

## Process

### Step 0: Check Project Context

Check if there's an active project for task syncing:

```bash
cat .claude-active-project 2>/dev/null
```

If a project is active, include `metadata: { "project": "<project-name>" }` in all TaskCreate calls.

### Step 1: Locate Configuration

Find the ESLint config (eslint.config.ts, eslint.config.local.ts, or similar).

### Step 2: Enable Rule as Error

Temporarily set the rule `$ARGUMENTS` to `"error"` severity in the local config if not already an error.

### Step 3: Identify Violations

Run `npm run lint 2>&1 | grep "$ARGUMENTS"` and collect all files with violations.

Parse the output to extract:
- File path
- Line number
- Error message

### Step 4: Create Task List

Use TaskCreate to create a task for each file with violations, ordered by number of violations (highest first).

Each task should have:
- **subject**: "Fix $ARGUMENTS violations in [file]" (imperative form)
- **description**: Include file path, number of violations, sample error messages, and fix approach
- **activeForm**: "Fixing $ARGUMENTS in [file]" (present continuous)
- **metadata**: `{ "project": "<active-project>" }` if project context exists

Example:
```
TaskCreate(
  subject: "Fix no-explicit-any violations in src/utils/api.ts",
  description: "File: src/utils/api.ts\nViolations: 5\nErrors: line 12, 34, 56...\n\nApply: Add proper TypeScript types",
  activeForm: "Fixing no-explicit-any in api.ts",
  metadata: { "project": "cleanup-types" }
)
```

### Step 5: Parallel Execution

Launch **up to 5 sub-agents** to fix tasks in parallel.

Each subagent should:
1. Use TaskList to find pending tasks with no blockers
2. Use TaskUpdate to claim a task (set status to `in_progress`)
3. Read the file and understand the violations
4. Apply appropriate fixes based on the rule type:
   - **Complexity rules**: Extract functions, use early returns, simplify conditions
   - **Style rules**: Apply formatting fixes
   - **Best practice rules**: Refactor to follow the recommended pattern
   - **Type rules**: Add proper types, remove `any`
5. Use Edit tool to make changes while preserving functionality
6. Verify the file no longer has violations for that rule
7. Run `/git:commit` to commit the changes
8. If hooks fail, fix the errors and re-run `/git:commit`
9. Use TaskUpdate to mark task as `completed` only after a successful commit

### Step 6: Iterate

Use TaskList to check for remaining pending tasks. Re-run lint for the specific rule.

If violations remain, repeat from Step 4.

Continue until all files pass the rule check.

### Step 7: Final Commit

Run `/git:commit` with message format:
```
fix(lint): resolve all $ARGUMENTS violations

- Fixed [N] files with [rule-name] violations
- [Brief description of fix pattern applied]
```

Report summary:
```
Lint rule fix complete:
- Rule: $ARGUMENTS
- Files fixed: [N]
- Total violations resolved: [M]
```

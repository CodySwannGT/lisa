---
description: Reduces the code complexity of the codebase by 2 on each run
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, TaskCreate, TaskUpdate, TaskList, TaskGet
---

## Step 0: Check Project Context

Check if there's an active project for task syncing:

```bash
cat .claude-active-project 2>/dev/null
```

If a project is active, include `metadata: { "project": "<project-name>" }` in all TaskCreate calls.

## Step 1: Lower Complexity Threshold

1. Read the eslint config file to find the current `cognitive-complexity` rule threshold
2. Use Edit tool to lower the threshold by 2 (e.g., 15 → 13)
3. Verify the change was applied

## Step 2: Identify Violations

1. Run the project's lint command to find all cognitive complexity violations
2. For each violation, note the file path, function name, and current complexity score

If no violations are found, skip to Step 4 and report success.

## Step 3: Create Task List

Use TaskCreate to create a task for each function needing refactoring, ordered by complexity score (highest first).

Each task should have:
- **subject**: "Reduce complexity in [function] ([file])" (imperative form)
- **description**: Include file path, function name, current complexity score, target threshold, and refactoring instructions
- **activeForm**: "Reducing complexity in [function]" (present continuous)
- **metadata**: `{ "project": "<active-project>" }` if project context exists

Example:
```
TaskCreate(
  subject: "Reduce complexity in processUserData (src/handlers/user.ts)",
  description: "File: src/handlers/user.ts\nFunction: processUserData\nCurrent: 18\nTarget: 13\n\nApply: extract functions, early returns, extract conditions",
  activeForm: "Reducing complexity in processUserData",
  metadata: { "project": "reduce-complexity" }
)
```

## Step 4: Parallel Execution

Launch **up to 5 sub-agents** using the `code-simplifier` subagent to refactor in parallel.

Each subagent should:
1. Use TaskList to find pending tasks with no blockers
2. Use TaskUpdate to claim a task (set status to `in_progress`)
3. Read the file and understand the complex function's purpose
4. Apply refactoring strategies:
   - **Extract functions**: Break complex logic into smaller, named functions
   - **Early returns**: Reduce nesting with guard clauses
   - **Extract conditions**: Move complex boolean logic into named variables
   - **Use lookup tables**: Replace complex switch/if-else chains with object maps
5. Use Edit tool to make changes while preserving function behavior
6. Verify the function no longer violates the complexity threshold
7. Run `/git:commit` to commit the changes
8. If hooks fail, fix the errors and re-run `/git:commit`
9. Use TaskUpdate to mark task as `completed` only after a successful commit

## Step 5: Iterate

Use TaskList to check for remaining pending tasks. If violations remain, repeat from Step 4.

Continue until all tasks are completed.

## Step 6: Final Commit

Run `/git:commit` with message format:
```
refactor: reduce cognitive complexity threshold

- Lowered sonarjs/cognitive-complexity from [X] to [Y]
- Refactored [list functions] to reduce complexity
```

Report summary:
```
Code complexity reduction complete:
- Previous threshold: [X]
- New threshold: [Y]
- Files refactored: [Z]
- Functions simplified: [list]
```

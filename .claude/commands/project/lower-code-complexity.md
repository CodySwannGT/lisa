---
description: Reduces the code complexity of the codebase by 2 on each run
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, TodoWrite
---

## Step 1: Lower Complexity Threshold

1. Read the eslint config file to find the current `cognitive-complexity` rule threshold
2. Use Edit tool to lower the threshold by 2 (e.g., 15 → 13)
3. Verify the change was applied

## Step 2: Identify Violations

1. Run the project's lint command to find all cognitive complexity violations
2. For each violation, note the file path, function name, and current complexity score

If no violations are found, skip to Step 4 and report success.

## Step 3: Create Work Plan

Use TodoWrite to create a checklist of all files needing refactoring, ordered by complexity score (highest first).

Each todo should include:
- File path
- Function name
- Current complexity score
- Target threshold

## Step 4: Parallel Execution

Launch **5 sub-agents** using the `code-simplifier` subagent to refactor in parallel. Each agent should claim unclaimed files from the todo list and mark them complete when done.

Each subagent should:
1. Read the file and understand the complex function's purpose
2. Apply refactoring strategies:
   - **Extract functions**: Break complex logic into smaller, named functions
   - **Early returns**: Reduce nesting with guard clauses
   - **Extract conditions**: Move complex boolean logic into named variables
   - **Use lookup tables**: Replace complex switch/if-else chains with object maps
3. Use Edit tool to make changes while preserving function behavior
4. Verify the function no longer violates the complexity threshold
5. Run `/git:commit` to commit the changes
6. If hooks fail, fix the errors and re-run `/git:commit`
7. Only mark the todo as completed after a successful commit

## Step 5: Iterate

Re-run lint. If violations remain, repeat from Step 3.

Continue until all functions meet the new threshold.

## Step 6: Commit and Push Changes

Use Task tool with prompt: "run /git:commit"

The commit message should follow this format:
```
refactor: reduce cognitive complexity threshold

- Lowered sonarjs/cognitive-complexity from [X] to [Y]
- Refactored [list functions] to reduce complexity
```

Report summary:
```
🎉 Code complexity reduction complete:
- Previous threshold: [X]
- New threshold: [Y]
- Files refactored: [Z]
- Functions simplified: [list]
```

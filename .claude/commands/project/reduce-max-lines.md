---
description: Reduce max file lines threshold and fix violations
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, TaskCreate, TaskUpdate, TaskList, TaskGet
argument-hint: <max-lines-value>
model: sonnet
---

# Reduce Max Lines

Target threshold: $ARGUMENTS lines per file

If no argument provided, prompt the user for a target.

## Process

### Step 0: Check Project Context

Check if there's an active project for task syncing:

```bash
cat .claude-active-project 2>/dev/null
```

If a project is active, include `metadata: { "project": "<project-name>" }` in all TaskCreate calls.

### Step 1: Locate Configuration

Read the eslint thresholds config (`eslint.thresholds.json` or similar).

### Step 2: Update Threshold

Set the `maxLines` threshold to $ARGUMENTS (e.g., `"maxLines": $ARGUMENTS`).

### Step 3: Identify Violations

Run lint to find all files exceeding the new threshold. Note file path and current line count.

If no violations, report success and exit.

### Step 4: Create Task List

Create a task for each file needing refactoring, ordered by line count (highest first).

Each task should have:
- **subject**: "Reduce lines in [file]" (imperative form)
- **description**: File path, current line count, target threshold, refactoring strategies
- **activeForm**: "Reducing lines in [file]" (present continuous)
- **metadata**: `{ "project": "<active-project>" }` if project context exists

Refactoring strategies:
- **Extract modules**: Break file into smaller focused modules
- **Remove duplication**: Consolidate repeated logic
- **Delete dead code**: Remove unused functions/code paths
- **Simplify logic**: Use early returns, reduce nesting

### Step 5: Parallel Execution

Launch **up to 5 sub-agents** using the `code-simplifier` subagent to refactor in parallel.

### Step 6: Iterate

Check for remaining pending tasks. Re-run lint to verify.

If violations remain, repeat from Step 3.

Continue until all files meet or are under $ARGUMENTS lines.

### Step 7: Report

```
Max lines reduction complete:
- Target threshold: $ARGUMENTS
- Files refactored: [count]
- Files reduced: [list with line counts]
```

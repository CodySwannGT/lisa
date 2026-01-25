---
description: Reduce max lines per function threshold and fix violations
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, TaskCreate, TaskUpdate, TaskList, TaskGet
argument-hint: <max-lines-per-function-value>
model: sonnet
---

# Reduce Max Lines Per Function

Target threshold: $ARGUMENTS lines per function

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

Set the `maxLinesPerFunction` threshold to $ARGUMENTS (e.g., `"maxLinesPerFunction": $ARGUMENTS`).

### Step 3: Identify Violations

Run lint to find all functions exceeding the new threshold. Note file path, function name, and current line count.

If no violations, report success and exit.

### Step 4: Create Task List

Create a task for each function needing refactoring, ordered by line count (highest first).

Each task should have:
- **subject**: "Reduce lines in [function-name]" (imperative form)
- **description**: File path and line number, function name, current line count, target threshold, refactoring strategies
- **activeForm**: "Reducing lines in [function-name]" (present continuous)
- **metadata**: `{ "project": "<active-project>" }` if project context exists

Refactoring strategies:
- **Extract functions**: Break function into smaller named functions
- **Early returns**: Reduce nesting with guard clauses
- **Extract conditions**: Move complex boolean logic into named variables
- **Use lookup tables**: Replace complex switch/if-else chains with object maps
- **Consolidate logic**: Merge similar code paths

### Step 5: Parallel Execution

Launch **up to 5 sub-agents** using the `code-simplifier` subagent to refactor in parallel.

### Step 6: Iterate

Check for remaining pending tasks. Re-run lint to verify.

If violations remain, repeat from Step 3.

Continue until all functions meet or are under $ARGUMENTS lines.

### Step 7: Report

```
Max lines per function reduction complete:
- Target threshold: $ARGUMENTS
- Functions refactored: [count]
- Functions reduced: [list with line counts]
```

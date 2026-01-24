---
description: Reduces the code complexity of the codebase by 2 on each run
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, TaskCreate, TaskUpdate, TaskList, TaskGet
---

## Setup

Check for active project: `cat .claude-active-project 2>/dev/null`

If active, include `metadata: { "project": "<project-name>" }` in TaskCreate calls.

## Step 1: Lower Threshold

1. Read the eslint config to find the current `cognitive-complexity` threshold
2. Lower the threshold by 2 (e.g., 15 → 13)

## Step 2: Identify Violations

Run lint to find all cognitive complexity violations. Note file path, function name, and complexity score.

If no violations, report success and exit.

## Step 3: Create Tasks

Create a task for each function needing refactoring, ordered by complexity score (highest first).

Each task should include:
- File path and function name
- Current complexity score and target threshold
- Refactoring strategies:
  - **Extract functions**: Break complex logic into smaller, named functions
  - **Early returns**: Reduce nesting with guard clauses
  - **Extract conditions**: Move complex boolean logic into named variables
  - **Use lookup tables**: Replace complex switch/if-else chains with object maps

## Step 4: Execute

Launch up to 5 sub-agents using `code-simplifier` to refactor in parallel.

Work through all tasks until complete.

## Step 5: Report

```
Code complexity reduction complete:
- Previous threshold: [X]
- New threshold: [Y]
- Functions simplified: [list]
```

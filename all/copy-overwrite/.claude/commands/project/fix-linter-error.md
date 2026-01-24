---
description: Fix all violations of a specific ESLint rule across the codebase
allowed-tools: Read, Write, Edit, Bash, Task, TaskCreate, TaskUpdate, TaskList, TaskGet
argument-hint: <eslint-rule-name>
model: sonnet
---

# Fix Linter Errors

Target rule: $ARGUMENTS

If no argument provided, prompt the user for a lint rule name.

## Setup

Check for active project: `cat .claude-active-project 2>/dev/null`

If active, include `metadata: { "project": "<project-name>" }` in TaskCreate calls.

## Step 1: Enable Rule

Find the ESLint config and temporarily set `$ARGUMENTS` to `"error"` severity if not already.

## Step 2: Identify Violations

Run `npm run lint 2>&1 | grep "$ARGUMENTS"` and collect files with violations.

## Step 3: Create Tasks

Create a task for each file with violations, ordered by violation count (highest first).

Each task should include:
- File path and violation count
- Sample error messages
- Fix approach based on rule type:
  - **Complexity rules**: Extract functions, use early returns, simplify conditions
  - **Style rules**: Apply formatting fixes
  - **Best practice rules**: Refactor to follow recommended pattern
  - **Type rules**: Add proper types, remove `any`

## Step 4: Execute

Launch up to 5 sub-agents to work through tasks in parallel.

Each fix should be verified and committed before marking complete.

## Step 5: Report

```
Lint rule fix complete:
- Rule: $ARGUMENTS
- Files fixed: [N]
- Total violations resolved: [M]
```

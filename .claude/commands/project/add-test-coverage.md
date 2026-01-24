---
description: Increase test coverage to a specified threshold percentage
allowed-tools: Read, Write, Edit, Bash, Task, TaskCreate, TaskUpdate, TaskList, TaskGet
argument-hint: <threshold-percentage>
model: sonnet
---

# Increase Test Coverage

Target threshold: $ARGUMENTS%

If no argument provided, prompt the user for a target.

## Process

### Step 0: Check Project Context

Check if there's an active project for task syncing:

```bash
cat .claude-active-project 2>/dev/null
```

If a project is active, include `metadata: { "project": "<project-name>" }` in all TaskCreate calls.

### Step 1: Locate Configuration

Find the test coverage config (jest.config.js, vitest.config.ts, .nycrc, etc.).

### Step 2: Update Thresholds

Set any threshold below $ARGUMENTS% to $ARGUMENTS% (line, branch, function, statement).

### Step 3: Identify Gaps

Run coverage and identify the **20 files** with the lowest coverage.

### Step 4: Create Task List

Create a task for each file needing test coverage, ordered by coverage gap (lowest first).

Each task should have:
- **subject**: "Add test coverage for [file]" (imperative form)
- **description**: File path, current coverage %, target threshold, notes about uncovered lines/branches
- **activeForm**: "Adding tests for [file]" (present continuous)
- **metadata**: `{ "project": "<active-project>" }` if project context exists

### Step 5: Parallel Execution

Launch **up to 5 sub-agents** using the `test-coverage-agent` subagent to add tests in parallel.

### Step 6: Iterate

Check for remaining pending tasks. Re-run coverage to verify.

If thresholds aren't met, repeat from Step 3.

Continue until all thresholds meet or exceed $ARGUMENTS%.

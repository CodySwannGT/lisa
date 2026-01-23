---
description: Increase test coverage to a specified threshold percentage
allowed-tools: Read, Write, Edit, Bash, TodoWrite, Task
argument-hint: <threshold-percentage>
model: sonnet
---

# Increase Test Coverage

Target threshold: $ARGUMENTS%

If no argument provided, prompt the user for a target.

## Process

### Step 1: Locate Configuration
Find the test coverage config (jest.config.js, vitest.config.ts, .nycrc, etc.).

### Step 2: Update Thresholds
Set any threshold below $ARGUMENTS% to $ARGUMENTS% (line, branch, function, statement).

### Step 3: Identify Gaps
Run coverage and identify the **20 files** with the lowest coverage.

### Step 4: Create Work Plan
Use TodoWrite to create a checklist of those 20 files, ordered by coverage gap.

### Step 5: Parallel Execution
Launch **5 sub-agents** using the `test-coverage-agent` subagent to add tests in parallel. Each agent should claim unclaimed files from the todo list and mark them complete when done.

Each subagent MUST:
1. Write tests for their claimed file(s)
2. Run `/git:commit` to commit their changes
3. If hooks fail, fix the errors and re-run `/git:commit`
4. Only mark the todo as completed after a successful commit

### Step 6: Iterate
Re-run coverage. If thresholds aren't met, repeat from Step 3.

Continue until all thresholds meet or exceed $ARGUMENTS%.
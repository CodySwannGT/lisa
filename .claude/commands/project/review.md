---
description: Performs extensive code review and optimization on the current project
argument-hint: <project-directory>
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, TaskCreate, TaskUpdate, TaskList, Skill
---

The current branch is a feature branch with full implementation of the project in $ARGUMENTS.

**IMPORTANT**: Perform each step and move to the next without stopping.

## Setup

Create workflow tracking tasks with `metadata: { "project": "<project-name>", "phase": "review" }`:

1. Perform Claude Review
2. Implement Claude Review Fixes
3. Perform CodeRabbit Review
4. Implement CodeRabbit Review Fixes
5. Perform Claude Optimizations

## Step 1: Perform Claude Review

If `$ARGUMENTS/claude-review.md` already exists, skip to Step 2.

Otherwise, run `/project:local-code-review $ARGUMENTS`

## Step 2: Implement Claude Review Fixes

1. Read `$ARGUMENTS/claude-review.md`
2. Fix any suggestions that score above 45

## Step 3: Perform CodeRabbit Review

If `$ARGUMENTS/coderabbit-review.md` already exists, skip to Step 4.

Otherwise, use Task tool with prompt: "Run `coderabbit review --plain || true` and write results to $ARGUMENTS/coderabbit-review.md"

## Step 4: Implement CodeRabbit Review Fixes

Evaluate suggestions in `$ARGUMENTS/coderabbit-review.md` and implement fixes for valid findings.

## Step 5: Perform Claude Optimizations

Use the code simplifier agent to clean up code added to the current branch.

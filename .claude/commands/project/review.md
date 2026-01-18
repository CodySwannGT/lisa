---
description: Performs extensive code review and optimization on the current project
argument-hint: <project-directory>
---

The current branch is a feature branch that contains full implementation of the project described in $ARGUMENTS

IMPORTANT: Perform each step and then move to the next one without stopping

## Step 0: MANDATORY SETUP

Use TodoWrite to create workflow tracking todos:
- Step 1: Perform Claude Review
- Step 2: Implement Claude Review Fixes
- Step 3: Perform CodeRabbit Review
- Step 4: Implement CodeRabbit Review Fixes
- Step 5: Perform Claude Optimizations

## Step 1: Perform Claude Review

Mark "Step 1: Perform Claude Review" as in_progress.

If $ARGUMENTS/claude-review.md already exists, Mark "Step 1: Perform Claude Review" as completed. Proceed to Step 2

Otherwise, run /local-code-review $ARGUMENTS

Mark "Step 1: Perform Claude Review" as completed. Proceed to Step 2

## Step 2: Implement Claude Review Fixes

Mark "Step 2: Implement Claude Review Fixes" as in_progress.

1. Read $ARGUMENTS/claude-review.md 
2. Fix any suggestions that score above 45 in $ARGUMENTS/claude-review.md 

Mark "Step 2: Implement Claude Review Fixes" as completed. Proceed to Step 3

## Step 3: Perform CodeRabbit Review

Mark "Step 3: Perform CodeRabbit Review" as in_progress.

If $ARGUMENTS/coderabbit-review.md already exists, Mark "Step 3: Perform CodeRabbit Review" as completed. Proceed to Step 4

Otherwise, use Task tool with prompt: "Run !`coderabbit review --plain || true` to get comprehensive code analysis and improvement suggestions and write the results to $ARGUMENTS/coderabbit-review.md"

Mark "Step 3: Perform CodeRabbit Review" as completed. Proceed to Step 4

## Step 4: Implement CodeRabbit Review Fixes

Mark "Step 4: Implement CodeRabbit Review Fixes" as in_progress.

Evaluate the suggestions in $ARGUMENTS/coderabbit-review.md and implement fixes/changes for any valid findings

Mark "Step 4: Implement CodeRabbit Review Fixes" as completed. Proceed to Step 5

## Step 5: Perform Claude Optimizations

Mark "Step 5: Perform Claude Optimizations" as in_progress.

Use the code simplifier agent to clean up the code that was added to the current branch.

Mark "Step 5: Perform Claude Optimizations" as completed. 


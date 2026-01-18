---
description: Comprehensive verification that a feature branch fully implements all project requirements with proper code quality, tests, and documentation
argument-hint: <project-directory>
---

The current branch is a feature branch that contains full implementation of the project described in $ARGUMENTS

## Step 0: MANDATORY SETUP

Use TodoWrite to create workflow tracking todos:
- Step 1: Review Requirements for $ARGUMENTS
- Step 2: Verify Implementation
- Step 3: Document Drift

## Step 1: Review Requirements

Mark "Step 1: Review Requirements" as in_progress.

Read all the requirements for $ARGUMENTS

Mark "Step 1: Review Requirements" as completed. Proceed to Step 2

## Step 2: Verify Implementation

Mark "Step 2: Verify Implementation" as in_progress.

Verify that the implementation completely and fully satisfies all the requirements from Step 1

Mark "Step 2: Verify Implementation" as completed. Proceed to Step 3


## Step 3: Document Drift

Mark "Step 3: Document Drift" as in_progress.

IF there is any divergence from the requirements, document what this drift is to $ARGUMENTS/drift.md

Mark "Step 3: Document Drift" as completed. 
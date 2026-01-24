---
description: Comprehensive verification that a feature branch fully implements all project requirements with proper code quality, tests, and documentation
argument-hint: <project-directory>
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, TaskCreate, TaskUpdate, TaskList
---

The current branch is a feature branch with full implementation of the project in $ARGUMENTS.

## Setup

Create workflow tracking tasks with `metadata: { "project": "<project-name>", "phase": "verify" }`:

1. Review Requirements
2. Verify Implementation
3. Document Drift

## Step 1: Review Requirements

Read all requirements for $ARGUMENTS.

## Step 2: Verify Implementation

Verify the implementation completely and fully satisfies all requirements from Step 1.

## Step 3: Document Drift

If there is any divergence from the requirements, document the drift to `$ARGUMENTS/drift.md`.

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
3. Run Task Verification Commands
4. Document Drift

## Step 1: Review Requirements

Read all requirements for $ARGUMENTS.

## Step 2: Verify Implementation

Verify the implementation completely and fully satisfies all requirements from Step 1.

## Step 3: Run Task Verification Commands

### 3a: Create Verification Tasks

First, read all task files in `$ARGUMENTS/tasks/` and create a new task for each one that has verification metadata:

For each task file:
1. **Read the task file** (JSON or markdown)
2. **Check for verification metadata**:
   - JSON tasks: Look for `metadata.verification`
   - Markdown tasks: Look for `## Verification` section with `### Proof Command`
3. **If verification exists**, create a new task:
   ```
   subject: "Verify: <original-task-subject>"
   description: "Run verification for task <id>: <verification.command>"
   activeForm: "Verifying <original-task-subject>"
   metadata: {
     "project": "<project-name>",
     "phase": "verify",
     "originalTaskId": "<id>",
     "verification": <copy the verification object>
   }
   ```

### 3b: Execute Verification Tasks

Work through each verification task:

1. **Run verification command** using Bash tool:
   - JSON: Execute `metadata.verification.command`
   - Markdown: Execute the command in `### Proof Command` code block
2. **Compare output to expected**:
   - JSON: Compare to `metadata.verification.expected`
   - Markdown: Compare to `### Expected Output` section
3. **Record results and mark task**:
   - If verification passes → Mark task completed
   - If verification fails → Keep task in_progress, document failure in drift.md
   - If command cannot run → Keep task in_progress, document blocker in drift.md

### Verification Summary

After running all verification tasks, report:
- Total tasks with verification: X
- Passed: Y
- Failed: Z
- Blocked: W

## Step 4: Document Drift

If there is any divergence from the requirements or verification failures, document the drift to `$ARGUMENTS/drift.md`.

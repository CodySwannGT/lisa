---
description: Comprehensive verification that a feature branch fully implements all project requirements with proper code quality, tests, and documentation
argument-hint: <project-directory>
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, TaskCreate, TaskUpdate, TaskList
---

The current branch is a feature branch with full implementation of the project in $ARGUMENTS.

## Setup

Set active project marker: `echo "$ARGUMENTS" | sed 's|.*/||' > .claude-active-project`

Extract `<project-name>` from the last segment of `$ARGUMENTS`.

## Create and Execute Tasks

Create workflow tracking tasks with `metadata.project` set to the project name:

```
TaskCreate:
  subject: "Review requirements"
  description: "Read all requirements for $ARGUMENTS (brief.md, research.md, task files)."
  metadata: { project: "<project-name>" }

TaskCreate:
  subject: "Verify implementation"
  description: "Verify the implementation completely and fully satisfies all requirements from the brief and research."
  metadata: { project: "<project-name>" }

TaskCreate:
  subject: "Run task verification commands"
  description: "Read all task files in $ARGUMENTS/tasks/. For each task with verification metadata (JSON: metadata.verification, or Markdown: ## Verification section), create a verification task with subject 'Verify: <original-subject>' and metadata including originalTaskId and verification details. Then execute each verification task: run the command, compare output to expected. If pass, mark completed. If fail, keep in_progress and document failure in $ARGUMENTS/drift.md. Report summary: total tasks, passed, failed, blocked."
  metadata: { project: "<project-name>" }

TaskCreate:
  subject: "Document drift"
  description: "If there is any divergence from requirements or verification failures, ensure all drift is documented in $ARGUMENTS/drift.md."
  metadata: { project: "<project-name>" }
```

Work through these tasks in order. Do not stop until all are completed.

---

## Next Step

After completing this phase, tell the user: "To continue, run `/project:debrief $ARGUMENTS`"

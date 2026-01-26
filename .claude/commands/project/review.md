---
description: Performs extensive code review and optimization on the current project
argument-hint: <project-directory>
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, TaskCreate, TaskUpdate, TaskList, Skill
---

The current branch is a feature branch with full implementation of the project in $ARGUMENTS.

**IMPORTANT**: Perform each step and move to the next without stopping.

## Setup

Set active project marker: `echo "$ARGUMENTS" | sed 's|.*/||' > .claude-active-project`

Extract `<project-name>` from the last segment of `$ARGUMENTS`.

## Create and Execute Tasks

Create workflow tracking tasks with `metadata.project` set to the project name:

```
TaskCreate:
  subject: "Perform Claude review"
  description: "If $ARGUMENTS/claude-review.md already exists, skip this task. Otherwise, run /project:local-code-review $ARGUMENTS"
  metadata: { project: "<project-name>" }

TaskCreate:
  subject: "Implement Claude review fixes"
  description: "Read $ARGUMENTS/claude-review.md and fix any suggestions that score above 45."
  metadata: { project: "<project-name>" }

TaskCreate:
  subject: "Perform CodeRabbit review"
  description: "If $ARGUMENTS/coderabbit-review.md already exists, skip this task. Otherwise, run `coderabbit review --plain || true` and write results to $ARGUMENTS/coderabbit-review.md"
  metadata: { project: "<project-name>" }

TaskCreate:
  subject: "Implement CodeRabbit review fixes"
  description: "Evaluate suggestions in $ARGUMENTS/coderabbit-review.md and implement fixes for valid findings."
  metadata: { project: "<project-name>" }

TaskCreate:
  subject: "Perform Claude optimizations"
  description: "Use the code simplifier agent to clean up code added to the current branch."
  metadata: { project: "<project-name>" }
```

**Execute each task via a subagent** to preserve main context. Launch up to 6 in parallel where tasks don't have dependencies. Do not stop until all are completed.

---

## Next Step

After completing this phase, tell the user: "To continue, run `/project:verify $ARGUMENTS`"

---
description: Automated project execution from planning through debrief (requires gap-free research)
argument-hint: <project-directory>
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, TaskCreate, TaskUpdate, TaskList, TaskGet, Skill
---

Execute complete implementation workflow for $ARGUMENTS.

## Execution Rules

1. **Continuous execution**: After each step completes, immediately invoke the next
2. **No summaries**: Do not summarize progress between steps
3. **No waiting**: Do not wait for user confirmation between steps
4. **Only stop when done**: Only stop when all steps are completed

## Setup

1. Set active project marker: `echo "$ARGUMENTS" | sed 's|.*/||' > .claude-active-project`
2. Read `$ARGUMENTS/research.md` and check "## Open Questions" section
   - If gaps exist: STOP with "Cannot proceed - research.md has unresolved open questions"
3. Check if planning is already complete: `ls $ARGUMENTS/tasks/*.md 2>/dev/null | head -3`
   - If task files exist: Skip planning, start at implementation

## Create and Execute Tasks

Create workflow tracking tasks with `metadata.project` set to the project name:

```
TaskCreate:
  subject: "Planning"
  description: "Run /project:plan $ARGUMENTS to create implementation tasks."
  metadata: { project: "<project-name>" }

TaskCreate:
  subject: "Implementation"
  description: "Run /project:implement $ARGUMENTS to execute all planned tasks."
  metadata: { project: "<project-name>" }

TaskCreate:
  subject: "Review"
  description: "Run /project:review $ARGUMENTS to review code changes."
  metadata: { project: "<project-name>" }

TaskCreate:
  subject: "Verification"
  description: "Run /project:verify $ARGUMENTS to verify all requirements are met."
  metadata: { project: "<project-name>" }

TaskCreate:
  subject: "Debrief"
  description: "Run /project:debrief $ARGUMENTS to capture learnings."
  metadata: { project: "<project-name>" }

TaskCreate:
  subject: "Archive"
  description: "Run /project:archive $ARGUMENTS to archive the completed project."
  metadata: { project: "<project-name>" }
```

Work through these tasks in order. Do not stop until all are completed.

Report "Project complete and archived" when done.

---

## Next Step

The project workflow is now complete. The implementation is done, reviewed, verified, learnings captured, and the project is archived.

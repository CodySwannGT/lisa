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

## Workflow Tasks

Create workflow tracking tasks with `metadata: { "project": "<project-name>", "phase": "execution" }`:

1. Step 1: Planning
2. Step 2: Implementation
3. Step 3: Review
4. Step 4: Verification
5. Step 5: Debrief
6. Step 6: Archive

## Execution

Work through each workflow task:

| Step | Command |
|------|---------|
| Planning | `run /project:plan $ARGUMENTS` |
| Implementation | `run /project:implement $ARGUMENTS` |
| Review | `run /project:review $ARGUMENTS` |
| Verification | `run /project:verify $ARGUMENTS` |
| Debrief | `run /project:debrief $ARGUMENTS` |
| Archive | `run /project:archive $ARGUMENTS` |

**CRITICAL**: Use Task tool with subagent for Planning, Implementation, Verification, Debrief, and Archive steps.

Report "Project complete and archived" when done.

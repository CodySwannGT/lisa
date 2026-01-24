---
description: Systematically implements all tasks in a specified project
argument-hint: <project-directory>
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, TaskCreate, TaskUpdate, TaskList, TaskGet, Skill
---

## Setup

1. Set active project marker: `echo "$ARGUMENTS" | sed 's|.*/||' > .claude-active-project`
2. Extract `<project-name>` from the last segment of `$ARGUMENTS`
3. Use **TaskList** to verify tasks exist for this project (check metadata.project)
4. If no tasks found, error: "No tasks found. Run /project:plan first"

## Implementation

Use **TaskList** to get current task status.

For each pending, unblocked task (filter by `metadata.project` = `<project-name>`):

1. Use **TaskUpdate** to mark it `in_progress`
2. Use **TaskGet** to retrieve full task details (description contains all instructions)
3. Launch a subagent to complete the task:
   - Pass the task's full description (includes skills to invoke, verification, etc.)
   - Subagent should follow the instructions in the description
   - Subagent runs the verification command and confirms expected output
4. When subagent completes successfully, use **TaskUpdate** to mark it `completed`
5. If verification fails, keep task `in_progress` and report the failure
6. Check **TaskList** for newly unblocked tasks

Continue until all tasks are completed.

## Complete

Use **TaskList** to generate a summary showing:
- Total tasks completed
- Any tasks that failed or remain in progress

Suggest running `/project:review`.

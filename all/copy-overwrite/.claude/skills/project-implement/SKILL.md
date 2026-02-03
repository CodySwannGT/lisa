---
name: project-implement
description: This skill should be used when systematically implementing all tasks in a specified project. It retrieves planned tasks, executes them via subagents in parallel, runs verification commands, and tracks completion status.
allowed-tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "Skill"]
argument-hint: "<project-directory>"
---

> **DEPRECATED**: This skill is deprecated. Use Claude's native plan mode instead.
> Enter plan mode with `/plan`, describe your requirements, and Claude will create a plan with tasks automatically.
> This skill will be removed in a future release.

## Setup

1. Set active project marker: `echo "$ARGUMENTS" | sed 's|.*/||' > .claude-active-project`
2. Extract `<project-name>` from the last segment of `$ARGUMENTS`
3. Use **TaskList** to verify tasks exist for this project (check metadata.project)
4. If no tasks found, error: "No tasks found. Run /project-plan first"

## Implementation

Use **TaskList** to get current task status.

**Always execute tasks via subagents** to keep the main context window clean. Launch up to 6 subagents in parallel for unblocked tasks.

For each pending, unblocked task (filter by `metadata.project` = `<project-name>`):

1. Use **TaskUpdate** to mark it `in_progress`
2. Use **TaskGet** to retrieve full task details
3. Complete the task following the instructions in its description
4. Run the verification command and confirm expected output
5. If verification passes, use **TaskUpdate** to mark it `completed`
6. If verification fails, keep task `in_progress` and report the failure
7. Check **TaskList** for newly unblocked tasks

Continue until all tasks are completed.

## Complete

Use **TaskList** to generate a summary showing:
- Total tasks completed
- Any tasks that failed or remain in progress

After completing this phase, tell the user: "To continue, run `/project-review $ARGUMENTS`"

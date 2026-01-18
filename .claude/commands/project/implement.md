---
description: Systematically implements all tasks in a specified project
argument-hint: <project-directory>
---

### Get Task State

Read $ARGUMENTS/progress.md

If the file does not exist or is empty, report an error: "Error: $ARGUMENTS/progress.md not found or empty. Run /project:plan first to create the task list."

If the file contains no task items (checkbox items), report an error: "Error: No tasks found in $ARGUMENTS/progress.md. The file should contain markdown checklist items."

Count tasks: total=X, completed=Y, remaining=X-Y

### Create Workflow Tracking for all tasks
Use TodoWrite to create workflow todos for each task using the following format:
- Step <task-number>: <task-name>

### Sync with progress file

If any of the tasks are marked as completed in $ARGUMENTS/progress.md, mark them as completed in the Workflow Tracking

If any of the tasks are marked as in_progress in $ARGUMENTS/progress.md, mark them as in_progress in the Workflow Tracking

### Complete the outstanding Workflow items

Work on the non-completed tasks in sequence

⚠️ **CRITICAL**: DO NOT STOP until all todos are marked completed.

For each non-completed task:

1. mark the task as in_progress in $ARGUMENTS/progress.md
2. mark the task as in_progress in Workflow Tracking
3. Use Task tool with subagent_type "general-purpose" and prompt: "run /project:complete-task <task-markdown-file>"
4. Wait for the subagent to finish the task
5. After subagent finishes with the task, mark the task as completed in $ARGUMENTS/progress.md
6. After subagent finishes with the task, mark the task as completed in Workflow Tracking
7. CRITICAL. DO NOT STOP. Move on to the next non-completed task

Repeat until all tasks are marked completed
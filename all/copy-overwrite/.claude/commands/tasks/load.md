---
description: Load tasks from a project directory into the current session
argument-hint: <project-name>
allowed-tools: Read, Bash, TaskCreate, TaskUpdate, TaskList
---

# Load Project Tasks

Load tasks from `projects/$ARGUMENTS/tasks/` into the current Claude Code session.

## Process

### Step 1: Validate Project

Check if the project exists:

```bash
ls projects/$ARGUMENTS/tasks/*.json 2>/dev/null
```

If no task files exist, report: "No tasks found in projects/$ARGUMENTS/tasks/"

### Step 2: Set Active Project

Create the active project marker:

```bash
echo "$ARGUMENTS" > .claude-active-project
```

This ensures any new tasks created will sync back to this project.

### Step 3: Load Tasks

For each JSON file in `projects/$ARGUMENTS/tasks/`:

1. Read the task JSON file
2. Use TaskCreate to recreate the task with:
   - subject from JSON
   - description from JSON
   - activeForm from JSON
   - metadata: `{ "project": "$ARGUMENTS" }`
3. If the task was already completed (status: "completed"), use TaskUpdate to mark it completed

### Step 4: Report

After loading all tasks, report:

```
Loaded X tasks from projects/$ARGUMENTS/tasks/
- Pending: Y
- Completed: Z

Active project set to: $ARGUMENTS
New tasks will automatically sync to this project.
```

## Notes

- Tasks are recreated with new IDs in the current session
- The original task IDs from the project are not preserved
- Task dependencies (blocks/blockedBy) are NOT currently preserved across load/sync cycles
- Use TaskList to see the loaded tasks

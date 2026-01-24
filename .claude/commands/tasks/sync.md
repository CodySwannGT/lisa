---
description: Sync current session tasks to a project directory
argument-hint: <project-name>
allowed-tools: Read, Write, Bash, TaskList, TaskGet
---

# Sync Tasks to Project

Sync all tasks from the current session to `projects/$ARGUMENTS/tasks/`.

## Process

### Step 1: Validate Project

Check if the project directory exists:

```bash
ls -d projects/$ARGUMENTS 2>/dev/null
```

If the project doesn't exist, ask: "Project '$ARGUMENTS' doesn't exist. Create it?"

If yes, create the project structure:

```bash
mkdir -p projects/$ARGUMENTS/tasks
```

### Step 2: Set Active Project

Create/update the active project marker:

```bash
echo "$ARGUMENTS" > .claude-active-project
```

### Step 3: Get Current Tasks

Use TaskList to get all tasks in the current session.

### Step 4: Sync Each Task

For each task from TaskList:

1. Use TaskGet to get full task details
2. Create a JSON file with the task data:

```json
{
  "id": "<task-id>",
  "subject": "<subject>",
  "description": "<description>",
  "activeForm": "<activeForm>",
  "status": "<status>",
  "blocks": [],
  "blockedBy": []
}
```

3. Write to `projects/$ARGUMENTS/tasks/<id>.json`

### Step 5: Stage for Git

```bash
git add projects/$ARGUMENTS/tasks/*.json
```

### Step 6: Report

```
Synced X tasks to projects/$ARGUMENTS/tasks/
- Pending: Y
- In Progress: Z
- Completed: W

Files staged for commit. Run /git:commit when ready.
```

## Notes

- This command manually syncs all current tasks to a project
- Use this when you started work without a project context
- After syncing, the active project is set so future tasks auto-sync
- Existing task files in the project directory will be overwritten

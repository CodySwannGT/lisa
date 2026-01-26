---
description: Initialize a project with full requirements analysis, planning, and structure setup
argument-hint: <file-path|jira-issue|text-description>
allowed-tools: Read, Write, Bash(git*), Glob, Grep, Task, TaskCreate, TaskUpdate, TaskList
---

## Step 1: Determine Input Type

Examine $ARGUMENTS to determine which type:
- **Jira issue**: Matches pattern like `SE-123`, `PROJ-456` (letters-dash-numbers)
- **File path**: Path exists as a file (check with Glob or Read)
- **Text prompt**: Everything else - a description of work to be done

## Step 2: Get Brief Content

Based on input type:

**If Jira issue:**
1. Use the atlassian MCP server to Read the issue FULLY
2. If MCP server not working, STOP and let human know

**If file path:**
1. Read the file FULLY (no limit/offset)

**If text prompt:**
1. The prompt IS the brief content - use $ARGUMENTS directly

## Step 3: Create Project Structure

1. Create project directory in `projects/` named `YYYY-MM-DD-<project-name>` where `<project-name>` is derived from:
   - Jira: the issue key and title (e.g., `2026-01-26-se-123-add-auth`)
   - File: the filename without extension
   - Text prompt: a kebab-case summary of the prompt (e.g., `2026-01-26-add-user-authentication`)

2. Create `brief.md` in the project directory:
   - Jira: populate with issue number, title, and description
   - File: move/copy the file and rename to `brief.md`
   - Text prompt: create `brief.md` with the prompt text as content

3. Create empty `findings.md` in the project directory

4. Create `.claude-active-project` marker file:
   ```bash
   echo "YYYY-MM-DD-<project-name>" > .claude-active-project
   ```

## Step 4: Git and Finalize

1. If Jira issue:
   - run /git:commit with branch name including issue number (e.g., `feature/SE-111-<branch-name>`)
   - Use atlassian MCP server to update issue status to "In Progress"
2. Otherwise:
   - run /git:commit

3. Output: "Project created: `YYYY-MM-DD-<project-name>`"

---
name: project-archive
description: This skill should be used when archiving a completed project. It moves the project directory to the projects/archive folder, clears the active project marker, and commits and submits a PR with the changes.
allowed-tools: ["Read", "Write", "Bash(git*)", "Glob", "Grep", "Task", "TaskCreate", "TaskUpdate", "TaskList"]
argument-hint: "<project-directory>"
---

1. Move $ARGUMENTS to `projects/archive`
2. Clear the active project marker: `rm -f .claude-active-project`
3. Run /git-commit-and-submit-pr

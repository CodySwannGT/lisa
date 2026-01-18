---
description: Moves a project to the projects/archive directory after it's completed
argument-hint: <project-directory>
allowed-tools: Read, Write, Bash(git*), Glob, Grep, Task, TodoWrite
---

1. Move $ARGUMENTS to `projects/archive`
2. run /git:commit-and-submit-pr

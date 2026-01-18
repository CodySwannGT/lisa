---
description: Initialize a comprehensive NestJS backend project with full requirements analysis, planning, and structure setup
argument-hint: <project-brief-file-or-jira-issue-number>
allowed-tools: Read, Write, Bash(git*), Glob, Grep, Task, TodoWrite
---

1. Decide if $ARGUMENTS is a Jira issue number or a path to a file
2. If $ARGUMENTS is a Jira issue number
   1. Use the atlassian MCP server to Read the issue FULLY. If the MCP server is not working, STOP WORKING AND LET THE HUMAN KNOW
   2. Otherwise: $ARGUMENTS is a brief for a project. Read it FULLY (no limit/offset)
3. Create a project directory in projects/ that is appropriately named for the project and prefixed with today's date like `YYYY-MM-DD-<project-name>`
4. If $ARGUMENTS is a Jira issue number
   1. Create a file called `brief.md` in the newly created project directory and populate it with the jira issue number, title and description
   2. Otherwise: Move $ARGUMENTS into the newly created project directory and rename it `brief.md`
5. Create an empty file in the new project directory called `findings.md`
6. If $ARGUMENTS is a Jira issue number
   1. run /git:commit and add the jira issue number to the newly created branch (e.g. feature/SE-111-<branch-name>)
   2. OTHERWISE: run /git:commit
7. If $ARGUMENTS is a Jira issue number Use the atlassian MCP server to update the issue with status "In Progress"

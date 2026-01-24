---
description: Checks for code review comments on a PR and implements them if required.
argument-hint: <github-pr-link>
allowed-tools: Read, Write, Edit, Bash(git*), Glob, Grep, Task, TaskCreate, TaskUpdate, TaskList, TaskGet, Bash(gh*)
---

Use the GitHub CLI to fetch all review comments on $ARGUMENTS:

```bash
gh pr view $ARGUMENTS --json reviews,comments
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments
```

Extract each unresolved review comment as a separate item. Note the comment ID, file path, line number, and comment body.

Create a task for each unresolved comment with `metadata: { "pr": "$ARGUMENTS" }`:
- **subject**: Brief description of the requested change
- **description**: Full comment body, file path, line number, comment ID, and these instructions:
  1. Evaluate if the requested change is valid
  2. If not valid, reply explaining why and mark resolved, skip remaining steps
  3. If valid, make appropriate code updates
  4. Ensure changes follow project coding standards
  5. Run relevant tests to verify changes work
  6. Run `/git:commit` to commit changes
  7. If hooks fail, fix errors and re-run `/git:commit`
- **activeForm**: "Implementing PR feedback for [file]"

Launch up to 6 subagents to work through the task list in parallel.

When all tasks are completed, run `/git:commit-and-submit-pr`.

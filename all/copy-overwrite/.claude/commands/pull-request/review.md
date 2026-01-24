---
description: Checks for code review comments on a PR and implements them if required.
argument-hint: <github-pr-link>
allowed-tools: Read, Write, Edit, Bash(git*), Glob, Grep, Task, TodoWrite, Bash(gh*)
---


Use the GitHub CLI to fetch all review comments on $ARGUMENTS:

```bash
gh pr view $ARGUMENTS --json reviews,comments
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments
```

Extract each unresolved review comment as a separate item. Note the comment ID, file path, line number, and comment body for each.

Create a Task List for considting of a task for each unresolved comment.

Each task should consist of the detailed propsed change to make and the following instructions:

1. Evaluate if the requested change is valid.
2. If it is not valid, leave a reply to the comment explaining why it is not valid and mark it as resolved and skip the rest of the steps
3. If it is valid, make the appropriate code updates
4. Ensure changes follow project coding standards
5. Run any relevant tests to verify the changes work
6. Run `/git:commit` to commit the changes
7. If hooks fail, fix the errors and re-run `/git:commit`
8. Only consider the change complete after a successful commit

Launch up to 6 subagents to work on this task list and handle as many tasks as possible in parallel


When the task list is fully complete,  run /git:commit-and-submit-pr

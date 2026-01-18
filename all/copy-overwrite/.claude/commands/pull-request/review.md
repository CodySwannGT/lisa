---
description: Checks for code review comments on a PR and implements them if required.
argument-hint: <github-pr-link>
allowed-tools: Read, Write, Bash(git*), Glob, Grep, Task, TodoWrite. Bash(gh*)
---

1. Use the github cli to find all the code review comments on $ARGUMENTS
2. Create a task list for each unresolved code review comment
3. Review the code reviews one by one and determine if they are correct and should be implemented
4. The ones that aren't valid or you're not implementing, use the github cli to comment why you're not and resolve the code review comment
5. For the rest, implement the changes and then use the github cli to mark the comment why it's resolved.
6. Once all the code review comments have been resolved, run /git:commit

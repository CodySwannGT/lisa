---
description: Checks for code review comments on a PR and implements them if required.
argument-hint: <github-pr-link>
allowed-tools: Read, Write, Edit, Bash(git*), Glob, Grep, Task, TodoWrite, Bash(gh*)
---

## Step 0: MANDATORY SETUP

Use TodoWrite to create workflow tracking todos:
- Step 1: Fetch PR review comments
- Step 2: Evaluate each comment
- Step 3: Respond to invalid comments
- Step 4: Implement valid changes
- Step 5: Commit and push changes
- Step 6: Resolve implemented comments

⚠️ **CRITICAL**: DO NOT STOP until all 6 todos are marked completed.

## Step 1: Fetch PR Review Comments
Mark "Step 1: Fetch PR review comments" as in_progress.

Use the GitHub CLI to fetch all review comments on $ARGUMENTS:

```bash
gh pr view $ARGUMENTS --json reviews,comments
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments
```

Extract each unresolved review comment as a separate item. Note the comment ID, file path, line number, and comment body for each.

Mark "Step 1: Fetch PR review comments" as completed. Proceed to Step 2.

## Step 2: Evaluate Each Comment
Mark "Step 2: Evaluate each comment" as in_progress.

For each review comment extracted:

1. Read the relevant code file and surrounding context
2. Understand what the reviewer is requesting
3. Categorize the comment as:
   - **VALID** - The suggestion is correct and should be implemented
   - **INVALID** - The suggestion is incorrect, already addressed, or not applicable
   - **CLARIFICATION NEEDED** - The comment is unclear (treat as INVALID with explanation)

Create a mental list tracking: comment ID, category, and reasoning for each.

Mark "Step 2: Evaluate each comment" as completed. Proceed to Step 3.

## Step 3: Respond to Invalid Comments
Mark "Step 3: Respond to invalid comments" as in_progress.

For each comment categorized as INVALID or CLARIFICATION NEEDED:

1. Use the GitHub CLI to reply explaining why it won't be implemented:
   ```bash
   gh api repos/{owner}/{repo}/pulls/{pr_number}/comments/{comment_id}/replies -f body="[Your explanation]"
   ```

2. If the reviewer's concern is already addressed elsewhere, reference where.

3. Immediately resolve the comment thread:
   ```bash
   gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "[thread_id]"}) { thread { isResolved } } }'
   ```

Mark "Step 3: Respond to invalid comments" as completed. Proceed to Step 4.

## Step 4: Implement Valid Changes
Mark "Step 4: Implement valid changes" as in_progress.

For each comment categorized as VALID:

1. Make the requested code changes using Edit or Write tools
2. Ensure changes follow project coding standards
3. Run any relevant tests to verify the changes work

If no VALID comments exist, skip implementation.

Mark "Step 4: Implement valid changes" as completed. Proceed to Step 5.

## Step 5: Commit and Push Changes
Mark "Step 5: Commit and push changes" as in_progress.

If changes were made in Step 4:

Use Task tool with prompt: "run /git:commit-and-submit-pr"

If no changes were made, skip this step.

Mark "Step 5: Commit and push changes" as completed. Proceed to Step 6.

## Step 6: Resolve Implemented Comments
Mark "Step 6: Resolve implemented comments" as in_progress.

For each VALID comment that was implemented:

1. Reply to the comment indicating it was resolved:
   ```bash
   gh api repos/{owner}/{repo}/pulls/{pr_number}/comments/{comment_id}/replies -f body="Resolved"
   ```

2. Mark the review thread as resolved (if supported by the repository settings)

Mark "Step 6: Resolve implemented comments" as completed.

Report summary:
```
📝 PR Review complete:
- Comments reviewed: [X]
- Implemented: [Y]
- Declined (with explanation): [Z]
```

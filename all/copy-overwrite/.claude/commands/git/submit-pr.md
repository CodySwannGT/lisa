---
description: "Push changes and create or update a pull request"
allowed-tools:
  [
    "Bash",
    "mcp__github__create_pull_request",
    "mcp__github__get_pull_request",
    "mcp__github__update_pull_request",
  ]
argument-hint: "[pr-title-or-description-hint]"
---

# Submit Pull Request Workflow

Push current branch and create or update a pull request. Optional hint: $ARGUMENTS

## Workflow

### Check current state

!git status
!git log --oneline -10

### Apply these requirements

1. **Branch Check**: Verify not on `dev`, `staging`, or `main` (cannot create PR from protected branches)
2. **Commit Check**: Ensure all changes are committed before pushing
3. **Push**: Push current branch to remote with `-u` flag
4. **PR Management**:
   - Check for existing PR on this branch
   - If exists: Update description with latest changes
   - If not: Create PR with comprehensive description (not a draft)
5. **Auto-merge**: Enable auto-merge on the PR using `gh pr merge --auto --merge`

### PR Description Format

Include in the PR description:

- **Summary**: Brief overview of changes (1-3 bullet points)
- **Test plan**: How to verify the changes work correctly

### Never

- use `--force` push without explicit user request
- create PR from protected branches (dev, staging, main)
- skip pushing before PR creation

## Execute

Execute the workflow now.

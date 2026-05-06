---
name: git-submit-pr
description: This skill should be used when pushing changes and creating or updating a pull request. It verifies the branch state, pushes to remote, creates or updates a PR with a comprehensive description, and enables auto-merge.
allowed-tools: ["Bash", "mcp__github__create_pull_request", "mcp__github__get_pull_request", "mcp__github__update_pull_request"]
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
3. **Push**: Push current branch to remote with `-u` flag and the following environment variable - GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=5"
4. **PR Management**:
   - Check for existing PR on this branch
   - If exists: Update description with latest changes
   - If not: Create PR with comprehensive description (not a draft)
5. **Auto-merge**: Choose merge strategy by PR type:
   - **Promotion PRs** (env → env, e.g. `dev` → `staging`): use `gh pr merge --auto --merge` (never squash). Squashing flattens the constituent `chore(release): X.Y.Z [skip ci]` commits into one commit titled with the PR title, stripping the `[skip ci]` markers and breaking the release workflow's promotion-detection regex — the destination branch then double-bumps its version. `--merge` keeps each `chore(release)` commit (and its `[skip ci]` marker) intact under a clean merge commit subject the workflow can recognize.
   - **Feature PRs** (anything → `dev`): use `gh pr merge --auto --squash`.

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

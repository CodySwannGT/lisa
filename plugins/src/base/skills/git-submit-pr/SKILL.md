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
   - **Feature PRs** (anything → `dev`): use `gh pr merge --auto --merge`.
6. **Drive to merge**: Opening the PR and enabling auto-merge is not terminal. Continue monitoring until the PR is actually `MERGED`, `CLOSED`, or a required check/review gate fails and must be fixed.
   - **Auto-merge capability fallback**: If `gh pr merge --auto --merge` fails because the repository does not allow auto-merge, keep watching the required checks and review decision. Once checks are green, the review gate is clear, and the PR is mergeable, run `gh pr merge --merge` directly. Never fall back to squash.
   - **BEHIND re-sync**: Poll `gh pr view <pr> --json mergeStateStatus,statusCheckRollup,reviewDecision,mergeable,state`. If `mergeStateStatus == BEHIND` after required checks are green, run `gh pr update-branch <pr>` and continue watching the new head while checks rerun.
   - **Sync conflict path**: If `gh pr update-branch` reports a conflict or cannot update the branch, surface the conflicting files, fetch the base branch locally, merge the base into the PR branch, resolve conflicts, run the relevant checks, and push. If the conflict needs broader design input, escalate through the agent-team fix-task pattern with the file list and current merge state. Do not leave a PR silently stalled in an ambiguous sync state.
   - **Review-gate stall**: If `reviewDecision == CHANGES_REQUESTED`, inspect unresolved review threads and blocking reviews. After the requested changes are addressed and threads are resolved, clear stale bot review blocks by dismissing the obsolete `CHANGES_REQUESTED` review where repository policy permits, or re-request review when dismissal is not allowed. A later `COMMENTED` review does not clear GitHub's prior `CHANGES_REQUESTED` state by itself.
   - **Loop terminal states**: Continue the loop until the PR is `MERGED`, is `CLOSED`, checks fail, the review gate remains blocked by unresolved human feedback, or a sync conflict cannot be resolved locally. On check failures, use the existing PR watch/fix path: inspect logs, fix, commit, push, and resume the loop.
   - **Harness-agnostic commands**: Use plain `gh` and `git` commands for this loop so Claude and Codex agents execute the same behavior from the shared skill.

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

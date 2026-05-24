---
name: git-submit-pr
description: This skill should be used when pushing changes and creating or updating a pull request. It verifies the branch state, pushes to remote, creates or updates a PR with a comprehensive description, and enables auto-merge.
allowed-tools: ["Bash", "mcp__github__create_pull_request", "mcp__github__get_pull_request", "mcp__github__update_pull_request"]
---

# Submit Pull Request Workflow

Push current branch and create or update a pull request. Optional hint: $ARGUMENTS

Recognized optional hints:

- `work_item_ref=<ref>` — source tracker item for native development linkage. Examples: `CodySwannGT/lisa#614`, `https://github.com/CodySwannGT/lisa/issues/614`, `ENG-123`, `PROJ-456`.
- `target_branch=<branch>` or `base=<branch>` — intended PR base branch, used to decide whether a GitHub closing keyword is safe.
- `tracker_provider=<github|linear|jira|none>` — explicit provider when the ref shape is ambiguous.

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
   - Include native development linkage for the source work item when `work_item_ref` can be inferred from `$ARGUMENTS`, the current branch name, an existing PR body, or the issue/ticket context passed by the caller.
5. **Auto-merge**: Choose merge strategy by PR type:
   - **Promotion PRs** (env → env, e.g. `dev` → `staging`): use `gh pr merge --auto --merge` (never squash). Squashing flattens the constituent `chore(release): X.Y.Z [skip ci]` commits into one commit titled with the PR title, stripping the `[skip ci]` markers and breaking the release workflow's promotion-detection regex — the destination branch then double-bumps its version. `--merge` keeps each `chore(release)` commit (and its `[skip ci]` marker) intact under a clean merge commit subject the workflow can recognize.
   - **Feature PRs** (anything → `dev`): use `gh pr merge --auto --merge`.

### Native Development Linkage

Add provider-appropriate linkage to the PR title and/or body without changing the status lifecycle:

- **GitHub Issues**:
  - If `work_item_ref` is a GitHub issue URL, `org/repo#<n>`, or `#<n>`, add a dedicated issue reference line to the PR body.
  - Use a closing keyword such as `Closes #<n>` only when merging this PR to the base branch represents terminal delivery for that issue. This is true when the target branch is the repository default branch or the configured production branch from `.lisa.config.json` `deploy.branches.production`.
  - If the target branch is a non-terminal environment branch such as `dev` or `staging`, use a non-closing reference such as `Refs #<n>` so GitHub links the PR in the issue's Development / linked pull requests surface without prematurely closing the issue.
  - For cross-repo issue refs, use the fully qualified form, for example `Closes CodySwannGT/lisa#614` or `Refs CodySwannGT/lisa#614`.
- **Linear**:
  - Ensure the Linear issue identifier appears in the branch name when the branch is created upstream by `lisa:implement`.
  - Include the identifier in the PR title or body, for example `Linear: ENG-123`, so Linear's GitHub integration can attach the PR.
- **JIRA**:
  - Ensure the JIRA issue key appears in the branch name when the branch is created upstream by `lisa:implement`.
  - Include the key in the PR title or body, for example `JIRA: PROJ-456`, so the GitHub-JIRA integration can attach the PR.
- **No supported provider**: Skip this section without error; do not invent references.

When updating an existing PR, preserve any existing linkage line unless the new `work_item_ref` is more specific. Do not duplicate equivalent references.

### PR Description Format

Include in the PR description:

- **Summary**: Brief overview of changes (1-3 bullet points)
- **Test plan**: How to verify the changes work correctly
- **Issue / Tracker link**: The provider-specific native linkage line when a source work item is available, placed after the summary and before the test plan.

### Never

- use `--force` push without explicit user request
- create PR from protected branches (dev, staging, main)
- skip pushing before PR creation

## Execute

Execute the workflow now.

---
name: lisa-git-submit-pr
description: "pushing changes and creating or…"
allowed-tools: ["Bash", "Skill", "mcp__github__create_pull_request", "mcp__github__get_pull_request", "mcp__github__update_pull_request"]
---

# Submit Pull Request Workflow

Push current branch and create or update a pull request. Optional hint: $ARGUMENTS

Recognized optional hints:

- `work_item_ref=<ref>` — source tracker item for native development linkage. Examples: `CodySwannGT/lisa#614`, `https://github.com/CodySwannGT/lisa/issues/614`, `ENG-123`, `PROJ-456`.
- `target_branch=<branch>` or `base=<branch>` — intended PR base branch, used to decide whether a GitHub closing keyword is safe.
- `tracker_provider=<github|linear|jira|none>` — explicit provider when the ref shape is ambiguous.
- `pr_url=<url>` — live pull request URL, only needed when updating tracker backlinks from an existing PR context.
- `auto_merge=<true|false>` — whether the PR should merge automatically. Default `true` (existing behavior for every current caller). With `auto_merge=false`, skip step 5 entirely (never run `gh pr merge --auto`) and pass `auto_merge=false` through to the `drive-pr-to-merge` delegation in step 6 so the PR is driven to a clean, green, OPEN state and then left awaiting a human.

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
   - After the PR exists, ensure the source work item has a backlink to the PR: invoke `lisa-tracker-sync` with the work item, milestone `pr-ready`, the live `pr_url`, and `tracker_provider` when known. This makes ticket -> PR linkage mandatory, not just a best-effort milestone comment.
   - After the PR exists, re-resolve the live Pull Request node id and, when `github.projects.v2` is enabled, invoke `lisa-github-project-v2` with `operation: ensure-item` and `content_node_id: <pull-request-node-id>` so linked pull requests join the configured shared Project without replacing the PR as the durable review/merge surface.
5. **Auto-merge** (only when `auto_merge=true`, the default — with `auto_merge=false` skip this step entirely): Choose merge strategy by PR type:
   - **Promotion PRs** (env → env, e.g. `dev` → `staging`): use `gh pr merge --auto --merge` (never squash). Squashing flattens the constituent `chore(release): X.Y.Z [skip ci]` commits into one commit titled with the PR title, stripping the `[skip ci]` markers and breaking the release workflow's promotion-detection regex — the destination branch then double-bumps its version. `--merge` keeps each `chore(release)` commit (and its `[skip ci]` marker) intact under a clean merge commit subject the workflow can recognize.
   - **Feature PRs** (anything → `dev`): use `gh pr merge --auto --merge`.
6. **Drive to merge**: Opening the PR and enabling auto-merge is not terminal. Delegate the full mergeability loop to the `drive-pr-to-merge` skill — invoke it with the PR number and `merge_method=merge` (and `verify_commit=<pushed head sha>` for the ancestry check). When the caller passed `auto_merge=false`, also pass `auto_merge=false` so the delegated loop drives the PR to green-and-open (`awaiting-human`) instead of merged — never merging it, even on repos that disallow auto-merge. That skill is the single source of truth for clearing every blocker: auto-merge with direct-merge fallback, `BEHIND` re-sync, conflict resolution, failing-check fixes, human + bot (CodeRabbit) review-comment handling with GraphQL thread resolution, stale `CHANGES_REQUESTED` dismissal, and post-merge ancestry verification. It runs inline and uses plain `gh`/`git` so Claude and Codex behave identically. Do not re-implement the loop here.

### Native Development Linkage

Add provider-appropriate linkage to the PR title and/or body without changing the status lifecycle:

- **GitHub Issues**:
  - If `work_item_ref` is a GitHub issue URL, `org/repo#<n>`, or `#<n>`, add a dedicated issue reference line to the PR body.
  - Use a closing keyword such as `Closes #<n>` only when merging this PR to the base branch represents terminal delivery for that issue. This is true when the target branch is the repository default branch or the configured production branch from `.lisa.config.json` `deploy.branches.production`.
  - If the target branch is a non-terminal environment branch such as `dev` or `staging`, use a non-closing reference such as `Refs #<n>` so GitHub links the PR in the issue's Development / linked pull requests surface without prematurely closing the issue.
  - For cross-repo issue refs, use the fully qualified form, for example `Closes CodySwannGT/lisa#614` or `Refs CodySwannGT/lisa#614`.
- **Linear**:
  - Ensure the Linear issue identifier appears in the branch name when the branch is created upstream by `lisa-implement`.
  - Include the identifier as a **non-closing** attach token in the PR title or body, for example `Linear: ENG-123` or `Refs ENG-123`, so Linear's GitHub integration can attach the PR without completing the Issue.
  - **Do not** emit a Linear magic word (`Closes`/`Fixes`/`Resolves ENG-123`) in the PR title, body, or commit message unless the target branch is the terminal/production branch — the repository default branch or the configured production branch from `.lisa.config.json` `deploy.branches.production` (resolved via `config-resolution`). Unlike GitHub, whose `Closes` auto-close is scoped to the default branch, Linear's integration completes a linked Issue on merge to **any branch**, so a magic word on a non-terminal env merge (for example into `dev` or `staging`) auto-closes the Issue prematurely and front-runs the env-keyed `status:*` label ladder. This is the `leaf-only-lifecycle` "Terminal native closure" invariant (native closure only at the production terminal `done`) — cite it, do not restate.
  - On a non-terminal env branch, use only the non-closing attach form and strip/neutralize any magic word copied from a ticket title or commit message. Branch-name linkage alone can still auto-complete the Issue where a Linear team enables "complete on any linked-PR merge" — behavior we cannot suppress from our side — so the post-merge reconciliation in `lisa-linear-sync` is the mandatory backstop, not an optional cleanup.
- **JIRA**:
  - Ensure the JIRA issue key appears in the branch name when the branch is created upstream by `lisa-implement`.
  - Include the key in the PR title or body, for example `JIRA: PROJ-456`, so the GitHub-JIRA integration can attach the PR.
- **No supported provider**: Skip this section without error; do not invent references.

When updating an existing PR, preserve any existing linkage line unless the new `work_item_ref` is more specific. Do not duplicate equivalent references.

### Work Item Backlink

After creating or updating the PR, always make the reverse link durable on the source work item when `work_item_ref` is available:

1. Resolve the live PR URL with `gh pr view <pr-number> --json url --jq .url`.
2. Invoke `lisa-tracker-sync` with the original work item ref, milestone `pr-ready`, `pr_url=<url>`, and `tracker_provider=<provider>` when known.
3. The vendor sync skill must prefer the provider's native development-link primitive where one is available and verifiable.
4. If native linkage is unavailable, unconfigured, or cannot be verified, the vendor sync skill must create or update a single managed `[lisa-pr-link]` comment on the work item containing the PR URL. The fallback comment is not optional; it is the ticket-side half of the two-way link.
5. When the PR later merges, invoke `lisa-tracker-sync` again with milestone `pr-merged`, the same `pr_url`, and the merge SHA when available, so the managed backlink reflects the final state.

Do not report PR submission as fully synced while the PR body references the ticket but the ticket has neither a verified native PR link nor the managed backlink comment.

### GitHub ProjectV2 Coordination

After PR creation or update, resolve the live Pull Request node id:

```bash
gh pr view <pr-number> --json id,url --jq '{ id, url }'
```

When `github.projects.v2` is enabled, delegate membership to `lisa-github-project-v2`:

```text
operation: ensure-item
content_node_id: <pull-request-node-id>
```

Branch on the shared utility outcome exactly as GitHub Issue writers do:

- `outcome: disabled` — no Project configured; continue normally.
- `outcome: added` or `outcome: reused` — PR membership is now present; continue normally.
- `outcome: warning` with `required: false` — preserve the exact Project error, keep the underlying PR creation/update as the durable success, and continue the normal auto-merge/watch flow.
- `outcome: blocked` with `required: true` — surface the exact Project failure and treat the submit flow as blocked even if the PR already exists, so operators can fix Project access/config before reporting full success.

Never inline separate `gh api graphql` ProjectV2 mutations here. All Pull Request membership coordination goes through `lisa-github-project-v2` so linked-PR flows and Issue writers stay in parity.

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

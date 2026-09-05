---
name: lisa-git-submit-pr
description: "pushing changes and creating or…"
allowed-tools: ["Bash", "Skill", "mcp__github__create_pull_request", "mcp__github__get_pull_request", "mcp__github__update_pull_request"]
---

# Submit Pull Request Workflow

Push current branch and create or update a pull request. Optional hint: $ARGUMENTS

Recognized optional hints:

- `work_item_ref=<ref>` — source tracker item for native development linkage. Examples: `CodySwannGT/lisa#614`, `https://github.com/CodySwannGT/lisa/issues/614`, `ENG-123`, `PROJ-456`.
- `target_branch=<branch>` or `base=<branch>` — intended PR base branch.
- `tracker_provider=<github|linear|jira|none>` — explicit provider when the ref shape is ambiguous.
- `pr_url=<url>` — live pull request URL, only needed when updating tracker backlinks from an existing PR context.
- `auto_merge=<true|false>` — whether the PR should merge automatically. Default `true` (existing behavior for every current caller). This skill **never arms the latch itself** in either mode; it passes the value through to the `drive-pr-to-merge` delegation in step 6, which owns the arm decision. With `auto_merge=false` the PR is driven to a clean, green, OPEN state and then left awaiting a human.

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
5. **Do not arm auto-merge here.** Never run `gh pr merge --auto` in this skill, in either `auto_merge` mode. Arming is delegated to `drive-pr-to-merge` (step 6), which is the only place that first checks whether the review context did any work.

   **Why this step is a prohibition rather than a command.** It used to arm the latch unconditionally when `auto_merge=true`. At submit time no review exists yet — that is what "submit" means — so the latch went on before anything could have read the code, and GitHub then merged the PR the moment CI went green. `drive-pr-to-merge` carries a careful exception for merging past a review check that reported success without reviewing anything: five conditions verified against a live poll, and a mandatory `MERGED — NOT REVIEWED` line in the report. **That exception could never fire**, because the merge had already been authorised here (#3439). The merge happened on the latch, not on the reasoning.

   Removing the arm from this step does not lose auto-merge: step 6 always delegates to `drive-pr-to-merge`, which arms as soon as the review context proves work, and adjudicates in the open when it does not. What is lost is the ability to authorise a merge before anything could have objected.

   The merge strategy is still decided here and passed through, because it is a property of the PR rather than of the review:
   - **Promotion PRs** (env → env, e.g. `dev` → `staging`): `merge_method=merge` (never squash). Squashing flattens the constituent `chore(release): X.Y.Z [skip ci]` commits into one commit titled with the PR title, stripping the `[skip ci]` markers and breaking the release workflow's promotion-detection regex — the destination branch then double-bumps its version. `--merge` keeps each `chore(release)` commit (and its `[skip ci]` marker) intact under a clean merge commit subject the workflow can recognize.
   - **Feature PRs** (anything → `dev`): `merge_method=merge`.
6. **Drive to merge**: Opening the PR is not terminal. Delegate the full mergeability loop to the `drive-pr-to-merge` skill — invoke it with the PR number and `merge_method=merge` (and `verify_commit=<pushed head sha>` for the ancestry check). When the caller passed `auto_merge=false`, also pass `auto_merge=false` so the delegated loop drives the PR to green-and-open (`awaiting-human`) instead of merged — never merging it, even on repos that disallow auto-merge. That skill is the single source of truth for clearing every blocker: the arm gate and auto-merge with direct-merge fallback, `BEHIND` re-sync, conflict resolution, failing-check fixes, human + bot (CodeRabbit) review-comment handling with GraphQL thread resolution, stale `CHANGES_REQUESTED` dismissal, and post-merge ancestry verification. It runs inline and uses plain `gh`/`git` so Claude and Codex behave identically. Do not re-implement the loop here.

   This delegation is now load-bearing rather than a convenience: it is the only path that arms auto-merge, so skipping it leaves the PR open rather than quietly merging it. Reporting submission as complete without invoking it is a failed submit, not a partial one — say so instead of implying the PR is on its way to merged.

   **The hold label needs no check here, and adding one would be dead code.** `drive-pr-to-merge` evaluates its hold gate before it arms anything, so a PR created with the label already on it is never armed — by the delegation, not by a second check in this skill. That guarantee used to require one: while step 5 armed the latch at creation, a hold that covered only the loop left the creation-time arm wide open, which is why CodySwannGT/lisa#3558 asked for a check in both places. Step 5 no longer arms, so there is nothing here for a label to gate. If you are adding one because the ticket says to, re-read step 5 first.

### Native Development Linkage

Add provider-appropriate linkage to the PR title and/or body without changing the status lifecycle:

- **GitHub Issues**:
  - If `work_item_ref` is a GitHub issue URL, `org/repo#<n>`, or `#<n>`, add a dedicated issue reference line to the PR body.
  - Always use a non-closing reference such as `Refs #<n>`, so the merge cannot close the issue before the post-merge deploy, remote verification, health check, and terminal `done` label.
  - **This rule is what makes the managed backlink mandatory, and neither rule says so on its own.** `Refs` creates no native development link, so gate 5 has nothing to defer to and the `[lisa-pr-link]` comment becomes the only backlink there is. Anyone following the non-closing rule alone will hit gate 5. Separately, `Refs #<n>` does **not** satisfy gate 4 either: the body needs its own `Work-Item: <ref>` line, and `Closes`/`Fixes` do not satisfy it. One `Refs` line, one `Work-Item:` line, one backlink comment — three different requirements that look like one. `discharge-pr-gates` (below) is what checks the last two together.
  - **A non-closing reference does not populate the issue's Development / linked pull requests surface, and no non-closing form does.** That surface *is* the closing-reference mechanism: a closing keyword populates the PR's `closingIssuesReferences`, while `Refs` yields only a `CrossReferencedEvent`. Measured on this repository — a `Refs`-only PR reports `closingIssuesReferences: 0`; a `Closes` PR reports 1. So the ticket-side backlink cannot be delegated to GitHub: the managed `[lisa-pr-link]` comment written by `node scripts/lisa-work-item.mjs backlink` — the one producer, which `lisa-github-sync` and the other vendor sync skills call rather than reimplement — is the **required** backlink under this rule, not a fallback for when native linkage happens to be absent. Two-way linkage (`lisa-implement` step 7a) depends on that comment, and so does the Work-Item Traceability check wherever the project declares `workItem.verify: "full"` — there, a PR carrying a correct `Refs` line still fails the check without it. Post it either way: under the default `trailer` level the check does not read the tracker, but the two-way linkage a human follows is still worth having, and a project can raise its level at any time.
  - For cross-repo issue refs, use the fully qualified non-closing form, for example `Refs CodySwannGT/lisa#614`.
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
2. Discharge the two gates the push could not check. Gate 4 (the `Work-Item:` line in the PR BODY) and gate 5 (the backlink) are both properties of a pull request, so a push before the PR existed reported them as `UNRESOLVED` rather than checked. One command closes both out at the first moment they *are* checkable:

   ```bash
   node scripts/lisa-work-item.mjs discharge-pr-gates
   ```

   It posts (or refreshes) the managed `[lisa-pr-link]` comment on every item the range names — so gate 5 passes without anyone remembering to — and then evaluates gate 4 against the live body, failing here rather than one CI cycle later. Exit 3 means there is no pull request for this branch yet, which is not a violation; exit 1 is a real unmet requirement and the message names it.

   It writes no PR body. Gate 4 is the author's declaration of what the change is for; a command that inserted the line would be answering its own question.

   The narrower `node scripts/lisa-work-item.mjs backlink --ref <work_item_ref> --pr-url <url>` is what it wraps, and remains the right call when you hold a ref and a URL but no checkout of the PR's branch (a sync skill updating a backlink after the fact). Both are idempotent, refuse loudly for a tracker they cannot write, and never silently no-op. Do not hand-post the comment, and do not describe the posting procedure anywhere: the same file that writes it is the file that checks it, which is what keeps producer and consumer from drifting.
3. Invoke `lisa-tracker-sync` with the original work item ref, milestone `pr-ready`, `pr_url=<url>`, and `tracker_provider=<provider>` when known. That is the progress-note and status side; it is not what satisfies the traceability check.
4. When the PR later merges, invoke `lisa-tracker-sync` again with milestone `pr-merged`, the same `pr_url`, and the merge SHA when available.

**Why step 2 exists — do not "simplify" it away as redundant with the `Refs` line.** Under the non-closing rule above, GitHub never creates a native development link at all: that surface *is* the closing-reference mechanism, so no non-closing form can populate it. A PR carrying a perfectly correct `Refs` line still fails the required Work-Item Traceability check without the comment. The managed comment is the ticket-side half of the link, not a fallback for when native linkage happens to be absent.

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
- **stop after pushing without creating the pull request.** A pushed branch with
  no PR is an INCOMPLETE flow, not a stopping point: the work is in no review, no
  CI run and no report, the work item keeps its in-progress role so intake will
  not re-dispatch it, and the branch drifts from the base until someone notices.
  Nothing else detects this state — the pre-push hook's `no pull request exists
  yet, so gates 4 and 5 could not be checked here` is accurate and reads as an
  informational pass, so the last signal received is green. Measured once the
  check existed to look: 64 such branches in this repository, 15 of them from a
  single day. **This flow terminates with a pull request or it has not
  terminated.** If you cannot create one, say so explicitly rather than ending
  quietly; `node scripts/check-orphaned-branches.mjs` lists branches in this
  state.
- **treat a branch as stranded work before reading its work item.** Untracked,
  unpushed, ahead and stale are all properties of the **copy**; whether the
  **work** survived is only visible in the tracker, and abandonment and
  uniqueness look identical from inside a checkout. Resolve the item first — one
  `gh issue view` settles it — and only then classify the branch. A candidate
  whose item is closed is **superseded**: preserve it, name the merged pull
  request the work actually took, and never commit, push, or open a pull request
  for it. Measured: a branch one commit ahead with no pull request, reading as a
  straightforward "open the PR" recovery, whose item was closed because the
  behaviour had shipped from a sibling item — the PR would have been a duplicate
  for a reviewer to untangle. It could not have landed regardless: the commit
  gate requires a `Work-Item:` trailer naming a **live** item, so working around
  it means retro-fitting attribution to an unrelated open item, which falsifies
  the commit's provenance rather than recovering anything.
  `check-orphaned-branches` reports the three verdicts — `superseded`,
  `unsubmitted`, `unresolved` — and `unresolved` is not a clean result.

## Execute

Execute the workflow now.

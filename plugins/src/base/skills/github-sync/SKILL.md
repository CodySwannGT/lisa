---
name: github-sync
description: "Syncs plan progress to a linked GitHub Issue. Posts plan contents, progress updates, branch links, and PR links at key milestones. Use this skill throughout the plan lifecycle to keep issues in sync. The GitHub counterpart of lisa:jira-sync."
allowed-tools: ["Bash", "Read", "Glob", "Grep"]
---

# GitHub Issue Sync

Sync current plan progress to a GitHub Issue: `$ARGUMENTS`

If no argument is provided, search for an issue ref (`org/repo#<number>` or `https://github.com/<org>/<repo>/issues/<n>` URL) in the active plan file (most recently modified `.md` in `plans/`).

## Workflow

### Step 1: Identify Issue and Context

1. **Parse issue ref** from `$ARGUMENTS` or extract from the active plan file.
2. **Fetch current issue state**:

   ```bash
   gh issue view <number> --repo <org>/<repo> --json number,title,state,labels,milestone,assignees,comments,url
   ```

3. **Determine current milestone** by checking:
   - Does a plan file exist? → Plan created
   - Is there a working branch? → Implementation started
   - Are tasks in progress? → Active implementation
   - Is there an open PR? → PR ready for review
   - Is the PR merged? → Complete

### Step 2: Gather Update Content

| Milestone | Content to post |
|-----------|-----------------|
| **Plan created** | Plan summary, branch name, link to PR (if draft exists) |
| **Implementation in progress** | Task completion summary (X of Y tasks done), any blockers |
| **PR ready** | PR link, summary of changes, test results |
| **PR merged** | Final summary, suggest moving issue to `status:done` |

### Step 3: Post Update

1. **Idempotency check** — read the issue's recent comments. If the most recent comment with the prefix `[claude-sync] <milestone>` matches the current milestone AND the body content is unchanged, skip the post (no duplicate).
2. **Add the comment**:

   ```bash
   gh issue comment <number> --repo <org>/<repo> --body-file /tmp/sync-comment.md
   ```

   The body must start with `[claude-sync] <milestone>` so the next sync run can dedupe.

3. **Report** to the user what was synced.

### Step 4: Suggest Status Transition

Based on the milestone, suggest (but do NOT automatically perform) a label transition:

| Milestone | Suggested label |
|-----------|-----------------|
| Plan created | `status:in-progress` |
| PR ready | `status:code-review` |
| PR merged | `status:done` |

The actual `status:in-progress` flip is owned by `lisa:github-build-intake` (claim) and `lisa:github-agent`. The `status:code-review` flip is owned by `lisa:github-evidence`. The `status:done` flip is typically owned by merge automation or PM. This skill never relabels.

## Important Notes

- **Never auto-transition labels** — always suggest and let the user / pipeline confirm.
- **Idempotent updates** — the `[claude-sync] <milestone>` prefix on the most-recent comment is the dedupe key.
- **Comment format** — use GitHub-flavored markdown (`##` headings, fenced code blocks). The same template is used for the JIRA path (rendered as wiki markup there); keep the markdown source canonical.

## Execution

Sync the issue now.

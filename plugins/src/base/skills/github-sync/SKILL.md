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

### Step 5: Parent Status Rollup (`--rollup`)

When invoked with `--rollup`, this skill **derives a parent/container issue's `status:*` label from the roll-up of its child sub-issues** instead of posting a milestone update on a leaf. This implements the GitHub sub-issue-completion arm of the **Parent status rollup (the state machine)** section of the `leaf-only-lifecycle` rule — cite that rule, do not restate the policy. It is the sync-side complement to the write-time labeling (`lisa:github-write-issue`), the validate-time S15 gate (`lisa:github-validate-issue`), and the claim-time gate (`lisa:github-build-intake`); all four cite the same rule so the classification never drifts.

**Resolve the child set the same way `lisa:github-read-issue` does** — native sub-issues via GraphQL, each with its `status:*` label and open/closed state:

```bash
gh api graphql -f query='
  query($owner:String!,$repo:String!,$number:Int!){
    repository(owner:$owner,name:$repo){
      issue(number:$number){
        number title state
        subIssues(first:100){ nodes { number state labels(first:20){ nodes { name } } } }
      }
    }
  }' -F owner=<org> -F repo=<repo> -F number=<parent-number>
```

If the `subIssues` field is unavailable (older GHES), fall back to body parentage exactly as `lisa:github-read-issue` does. If the issue has **no** children it is a leaf, not a parent — rollup is N/A; behave as a normal milestone sync.

**Evaluate the required children in priority order and take the first match** (canonical roles from `config-resolution`; the GitHub label map is `status:blocked`, `status:in-progress`, `status:code-review`, `status:done`):

| If among the required child leaves… | Derived parent role | GitHub label |
|---|---|---|
| any child carries `status:blocked` (or is otherwise blocked) | `blocked` | `status:blocked` |
| else any child carries `status:in-progress` **or** `status:code-review` | `claimed` | `status:in-progress` |
| else **all** required children are terminal (closed / `status:done`) | `done` | the configured terminal `done` label |
| else (children exist, none started) | — | unchanged — parent keeps its non-ready container label |

- **Blocked dominates** — a single blocked child surfaces `status:blocked` on the parent even while siblings progress, so a human sees the parent needs attention.
- **"Required" children only** — a child labelled won't-do / optional does not hold the parent open; only leaves that must ship count toward the all-terminal check.
- **Recursive** — a parent reaches `done` only when its children are all terminal; an Epic reaches `done` only when its Stories have themselves rolled up to `done`. Evaluate bottom-up.
- **Never set the parent to `status:ready`** — `ready` is leaf-only (the human "claim this" signal). Rollup only moves the parent between non-ready container labels.

**Single-environment collapse (this repo).** `.lisa.config.json` `deploy.branches` declares only `production: main`, so the terminal `done` resolves to the single label `status:done` — there is no `status:on-dev` / `status:on-stg` and **no dev → staging → prod promotion chain**. Resolve the terminal via the env-keyed `done` logic in `config-resolution`, but in the single-environment case it collapses to the one `status:done` value; the rollup never attempts to resolve a dev or staging `done`. Projects that DO have multiple environments keep the env-keyed map and roll the parent up to whichever `done` matches the environment its leaves shipped to.

**Apply the derived label** (only when it differs from the parent's current `status:*`): remove the parent's existing `status:*` label and add the derived one, keeping exactly one `status:*` label so the build-queue invariant holds. Post an idempotent `[claude-sync] rollup` comment naming the derived state and the child tally (e.g. `3/4 leaves terminal, 1 blocked → status:blocked`); skip the comment if an identical one is already the most recent rollup comment.

```bash
gh issue edit <parent-number> --repo <org>/<repo> \
  --remove-label "<current status:*>" --add-label "<derived status:*>"
```

**Safe default.** If rollup cannot be applied automatically (e.g. ambiguous required-set, GraphQL hierarchy unavailable, or a derived terminal that the env logic cannot resolve), this skill does **not** guess — it posts the derived suggestion as a comment and leaves the parent's label untouched. No unsafe transition is ever made.

## Important Notes

- **Never auto-transition labels** — always suggest and let the user / pipeline confirm. The one exception is the explicit `--rollup` parent derivation (Step 5), which moves a *parent's* `status:*` label as the `leaf-only-lifecycle` rule mandates — never a leaf's, and never to `status:ready`.
- **Idempotent updates** — the `[claude-sync] <milestone>` prefix on the most-recent comment is the dedupe key; the rollup path uses `[claude-sync] rollup`.
- **Comment format** — use GitHub-flavored markdown (`##` headings, fenced code blocks). The same template is used for the JIRA path (rendered as wiki markup there); keep the markdown source canonical.
- **Rollup cites the rule by slug** — parent state derivation follows the `leaf-only-lifecycle` rule's state machine; this skill does not restate the policy.

## Execution

Sync the issue now.

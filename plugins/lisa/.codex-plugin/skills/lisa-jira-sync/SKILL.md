---
name: lisa-jira-sync
description: "Syncs plan progress to a linked…"
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep"]
---

# JIRA Ticket Sync

All Atlassian operations in this skill go through `lisa-atlassian-access`. Do not call MCP tools or `acli` directly.

Sync current plan progress to JIRA ticket: $ARGUMENTS

If no argument provided, search for a ticket URL in the active plan file (most recently modified `.md` in `plans/`).

Optional arguments include `pr_url=<url>` for the live pull request and `merge_sha=<sha>` once merged.

## Workflow

### Step 1: Identify Ticket and Context

1. **Parse ticket ID** from `$ARGUMENTS` or extract from the active plan file
2. **Fetch current ticket state** by invoking `lisa-atlassian-access` via the Skill tool with `operation: read-ticket key: <TICKET-ID>`
3. **Determine current milestone** by checking:
   - Does a plan file exist? → Plan created
   - Is there a working branch? → Implementation started
   - Are tasks in progress? → Active implementation
   - Is there an open PR? → PR ready for review
   - Is the PR merged? → Complete

### Step 2: Gather Update Content

Based on the current milestone:

| Milestone | Content to Post |
|-----------|-----------------|
| **Plan created** | Plan summary, branch name, link to PR (if draft exists) |
| **Implementation in progress** | Task completion summary (X of Y tasks done), any blockers |
| **PR ready** | PR link, summary of changes, test results |
| **PR merged** | Final summary, suggest moving ticket to "Done" |

### Step 3: Post Update

Before adding a comment, check for an existing milestone comment to avoid duplicates (idempotency):

1. **Fetch existing comments** by invoking `lisa-atlassian-access` with `operation: search-issues jql: "..."` or by reading the ticket's comments. Look for a comment whose body contains a stable milestone marker (e.g., the heading `## Plan Created`, `## Implementation in Progress`, `## PR Ready`, or `## PR Merged`) that matches the current milestone.
2. **If a matching comment already exists**, skip posting and proceed to field updates — idempotent re-runs must not create duplicates.
3. **If no matching comment exists**, add a new comment by invoking `lisa-atlassian-access` with `operation: comment key: <TICKET-ID> body: "..."`.
4. **Update ticket fields** if applicable:
   - Add branch name to a custom field or comment
   - Add PR link to a custom field or comment
5. **Report** what was synced to the user

### Step 3b: Ensure PR Backlink

When `$ARGUMENTS` includes `pr_url=<url>` for `PR ready` or `PR merged`, ensure the JIRA ticket has a durable ticket -> PR link:

1. Prefer the JIRA development-link surface when the site's GitHub/JIRA integration or remote-link API is available through `lisa-atlassian-access`; verify by re-reading the ticket's remote links / development metadata.
2. If native linkage is unavailable, unconfigured, cross-system, or cannot be verified, create or update a single managed JIRA comment containing the PR URL. The comment must start with `[lisa-pr-link]` and include the milestone (`pr-ready` or `pr-merged`) and merge SHA when available.
3. Keep the fallback idempotent: read existing comments, find the `[lisa-pr-link]` comment for the same PR URL, and update/skip it instead of appending duplicates. If the current access layer cannot update comments in place, skip when an identical managed comment already exists and otherwise add exactly one replacement comment with the stable marker.

The PR body/branch issue key is the PR -> ticket side. This step is the required ticket -> PR side.

### Step 4: Suggest Status Transition

Based on the milestone, suggest (but don't automatically perform) a status transition:

| Milestone | Suggested Status |
|-----------|-----------------|
| Plan created | "In Progress" |
| PR ready | configured `jira.workflow.review` status, or no transition when unconfigured |
| PR merged | "Done" |

Every suggested or performed transition is bound by the **Tracker status vocabulary** section of the `config-resolution` rule: only statuses named in the configured workflow map, never statuses discovered from the tracker's live workflow (transition lists, board columns, other tickets) — and this binds the lead performing tracker writes exactly as it binds a subagent. A milestone with no configured status gets a comment, not a transition.

### Step 5: Parent Status Rollup (`--rollup`)

When invoked with `--rollup`, this skill **derives a parent/container ticket's status from the roll-up of its children** (Stories under an Epic; Sub-tasks under a Story/Task) instead of posting a milestone update on a leaf. This implements the JIRA child/subtask-status arm of the **Parent status rollup (the state machine)** section of the `leaf-only-lifecycle` rule — cite that rule, do not restate the policy.

**Resolve the child set the same way `lisa-jira-read-ticket` does** — the native Epic → Story → Sub-task hierarchy (Epic link / parent field for Stories, the subtask relationship for Sub-tasks), each with its current status. Fetch via `lisa-atlassian-access` (`operation: read-ticket` / `search-issues` with the parent's `"Epic Link" = <KEY>` or `parent = <KEY>` JQL). If the ticket has **no** children it is a leaf — rollup is N/A; behave as a normal milestone sync.

**Evaluate the required children over the env ladder `in-progress < dev < staging < production` (the ordered keys of the JIRA env-keyed `done` map, e.g. `On Dev < On Stg < Done`) and take the first match** (canonical roles from `config-resolution`; the JIRA status map defaults to `Blocked`, `In Progress`, `Code Review`, env-keyed `done`):

| If among the required child leaves… | Derived parent role | JIRA status |
|---|---|---|
| any child is **blocked** | `blocked` | `Blocked` |
| else **every** required child has shipped to some env (each at a `done`-map value, e.g. `On Dev`/`On Stg`/`Done`) | `done[min-env]` | the **least-advanced** env status among them (all `On Stg` → `On Stg`; mixed `On Dev`+`On Stg` → `On Dev`; all production → `Done`) |
| else any child has **started** (`In Progress` / `Code Review`, or shipped to an env while a sibling has not) | `claimed` | `In Progress` |
| else (children exist, none started) | — | unchanged — parent keeps its non-ready container status |

- **Blocked dominates** — a single blocked child surfaces `Blocked` on the parent even while siblings progress.
- **Least-advanced env wins** — the parent reaches an env only when every required child has reached at least that env; it never sits ahead of its laggard child. Apply native terminal resolution (the `leaf-only-lifecycle` Terminal native closure) only when the resolved env is the production `Done`, never at `On Dev`/`On Stg`.
- **"Required" children only** — won't-do / optional children do not hold the parent open.
- **Recursive** — an Epic reaches an env only when its Stories have themselves rolled up to at least that env; a Story reaches it only when its Sub-tasks have. Evaluate bottom-up.
- **Never set the parent to the build-ready status** — `ready` is leaf-only. Rollup only moves the parent between non-ready container statuses.
- **`review` is optional for JIRA** (`config-resolution`) — a project that omits `Code Review` keeps the parent in `In Progress` until it shifts to an env; skip the intermediate review hop rather than forcing a non-existent status (a `leaf-only-lifecycle` "vendor support varies" note).

**Single-environment collapse (this repo).** The env rungs resolve via the env-keyed `done` logic in `config-resolution`. In this repo `deploy.branches` declares only `production: main`, so `done` collapses to a single status, the only env rung is production, and the lifecycle is `Ready → In Progress → Code Review → Done` with **no** dev/staging promotion hops; the rollup never resolves a dev or staging `done`. Multi-environment projects keep the env-keyed map and roll a parent up to intermediate env statuses (`On Dev`/`On Stg`).

**Apply the derived status** (only when it differs from the parent's current status) via `lisa-atlassian-access` `operation: transition`, and post an idempotent rollup comment naming the derived state and the child tally. **Safe default:** if the derived terminal cannot be resolved (ambiguous required-set or unresolvable env `done`), do not guess — post the derived suggestion as a comment and leave the parent's status untouched.

## Important Notes

- **Never auto-transition ticket status** — always suggest and let the user confirm. The one exception is the explicit `--rollup` parent derivation (Step 5), which transitions a *parent's* status per the `leaf-only-lifecycle` rule — never a leaf's, and never to the build-ready status.
- **Idempotent updates** — running sync multiple times at the same milestone should not create duplicate comments
- **Comment format** — use JIRA markdown with clear headers and bullet points
- **Rollup cites the rule by slug** — parent state derivation follows the `leaf-only-lifecycle` rule's state machine; this skill does not restate the policy.

## Execution

Sync the ticket now.

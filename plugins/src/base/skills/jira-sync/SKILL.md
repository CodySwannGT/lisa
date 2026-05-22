---
name: jira-sync
description: "Syncs plan progress to a linked JIRA ticket. Posts plan contents, progress updates, branch links, and PR links at key milestones. Use this skill throughout the plan lifecycle to keep tickets in sync."
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep"]
---

# JIRA Ticket Sync

All Atlassian operations in this skill go through `lisa:atlassian-access`. Do not call MCP tools or `acli` directly.

Sync current plan progress to JIRA ticket: $ARGUMENTS

If no argument provided, search for a ticket URL in the active plan file (most recently modified `.md` in `plans/`).

## Workflow

### Step 1: Identify Ticket and Context

1. **Parse ticket ID** from `$ARGUMENTS` or extract from the active plan file
2. **Fetch current ticket state** by invoking `lisa:atlassian-access` via the Skill tool with `operation: read-ticket key: <TICKET-ID>`
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

1. **Fetch existing comments** by invoking `lisa:atlassian-access` with `operation: search-issues jql: "..."` or by reading the ticket's comments. Look for a comment whose body contains a stable milestone marker (e.g., the heading `## Plan Created`, `## Implementation in Progress`, `## PR Ready`, or `## PR Merged`) that matches the current milestone.
2. **If a matching comment already exists**, skip posting and proceed to field updates — idempotent re-runs must not create duplicates.
3. **If no matching comment exists**, add a new comment by invoking `lisa:atlassian-access` with `operation: comment key: <TICKET-ID> body: "..."`.
4. **Update ticket fields** if applicable:
   - Add branch name to a custom field or comment
   - Add PR link to a custom field or comment
5. **Report** what was synced to the user

### Step 4: Suggest Status Transition

Based on the milestone, suggest (but don't automatically perform) a status transition:

| Milestone | Suggested Status |
|-----------|-----------------|
| Plan created | "In Progress" |
| PR ready | "In Review" |
| PR merged | "Done" |

## Important Notes

- **Never auto-transition ticket status** — always suggest and let the user confirm
- **Idempotent updates** — running sync multiple times at the same milestone should not create duplicate comments
- **Comment format** — use JIRA markdown with clear headers and bullet points

## Execution

Sync the ticket now.

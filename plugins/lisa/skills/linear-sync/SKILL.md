---
name: linear-sync
description: "Syncs plan progress to a linked Linear Issue. Posts plan contents, progress updates, branch links, and PR links at key milestones. Use this skill throughout the plan lifecycle to keep Linear Issues in sync. The Linear counterpart of lisa:jira-sync and lisa:github-sync."
allowed-tools: ["Bash", "Skill", "mcp__linear-server__list_teams", "mcp__linear-server__get_issue", "mcp__linear-server__save_comment", "mcp__linear-server__list_issue_labels", "mcp__linear-server__create_issue_label", "mcp__linear-server__save_issue"]
---

# Sync Plan to Linear: $ARGUMENTS

Post milestone updates to the linked Linear Issue at key plan-lifecycle moments. This skill is the destination of the `lisa:tracker-sync` shim when `tracker = "linear"`.

## Configuration

Reads `linear.workspace`, `linear.teamKey` from `.lisa.config.json` (with `.local` override).

## When to invoke

Callers (planning skills, lifecycle skills) invoke this skill at:

| Milestone | What to post |
|-----------|--------------|
| Plan created | Plan contents (sections + ordered tasks) as a comment, suggest transition `Backlog → Todo` (label: `status:ready`) |
| Implementation in progress | Branch URL + first commit, suggest transition `Todo → In Progress` (label: `status:in-progress`) |
| PR ready for review | PR URL + summary, the implementation handoff comment, suggest transition `In Progress → In Review` (label: `status:code-review`) |
| PR merged | Merge SHA + deploy environment (if known), suggest transition `In Review → Done` (label: `status:done`) |

This skill **suggests** transitions but does not auto-transition the native Linear `state` field. It DOES update the `status:*` label set when the caller asks (the build queue is keyed off labels). Native state transitions remain a human / triage decision.

## Input

`$ARGUMENTS` is `[--update-label] <IDENTIFIER> <milestone>` where:

- `--update-label` (optional flag) — when present, triggers Phase 4: updates the `status:*` label set on the Linear Issue to reflect the milestone. Without this flag, only a comment is posted (no label changes).
- `<IDENTIFIER>` is the Linear Issue identifier (e.g. `ENG-123`). If not provided, the skill searches the active plan file for a linked Linear Issue.
- `<milestone>` is one of `plan-created`, `implementation-in-progress`, `pr-ready`, `pr-merged`.

Example with label update: `lisa:linear-sync --update-label ENG-123 pr-ready`

## Phase 1 — Resolve Issue

1. If `$ARGUMENTS` includes an identifier, parse it.
2. Else search for the active plan file (most recent file under `plans/`) and extract the linked Linear Issue identifier from its frontmatter.
3. Fetch the Issue via `mcp__linear-server__get_issue` to confirm it exists.

## Phase 2 — Compose Milestone Comment

Per the milestone, build the comment body. Include:

- A milestone header (e.g. `**Plan created** — <plan-file>`)
- Relevant links (plan file, branch, PR)
- A short summary (first 5 lines of the plan section / commit message / PR description)
- The suggested status transition

Example for `plan-created`:

```markdown
**Plan created** — `plans/feat-X.md`

Sections:
- Phase 1: Schema doc
- Phase 2: Linear destination skills
- ...

Tasks: 7 ordered items.

Next: implementation begins. Suggested status: **Todo** (label: `status:ready`).
```

## Phase 3 — Post Comment

Call `mcp__linear-server__save_comment({issueId: <id>, body: <comment>})`.

## Phase 4 — Update Status Label (when caller requests)

If the caller passes `--update-label`, update the `status:*` label set via `mcp__linear-server__save_issue`:

- `plan-created` → add `status:ready`
- `implementation-in-progress` → remove `status:ready`, add `status:in-progress`
- `pr-ready` → remove `status:in-progress`, add `status:code-review`
- `pr-merged` → remove `status:code-review`, add `status:done`

If the requested label doesn't exist on the team, create it via `mcp__linear-server__create_issue_label`.

Verify exactly one `status:*` label remains after the update — having two simultaneously breaks the build-queue invariant.

Without `--update-label`, this skill posts the comment only and does NOT touch labels.

## Rules

- Never auto-transition the native Linear `state` — only the label, and only when the caller explicitly asks.
- Never post empty or minimal comments — if a milestone has no meaningful content, skip the post.
- Do not delete prior milestone comments. They are the audit trail.
- If `save_comment` fails, retry once. If it fails again, surface the error.

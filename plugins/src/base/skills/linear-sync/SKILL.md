---
name: linear-sync
description: "Syncs plan progress to a linked Linear Issue. Posts plan contents, progress updates, branch links, and PR links at key milestones. Use this skill throughout the plan lifecycle to keep Linear Issues in sync. The Linear counterpart of lisa:jira-sync and lisa:github-sync."
allowed-tools: ["Bash", "Skill", "mcp__linear-server__list_teams", "mcp__linear-server__get_issue", "mcp__linear-server__list_issues", "mcp__linear-server__save_comment", "mcp__linear-server__list_issue_labels", "mcp__linear-server__create_issue_label", "mcp__linear-server__save_issue"]
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

`$ARGUMENTS` is `<IDENTIFIER> <milestone>` where:

- `<IDENTIFIER>` is the Linear Issue identifier (e.g. `ENG-123`). If not provided, the skill searches the active plan file for a linked Linear Issue.
- `<milestone>` is one of `plan-created`, `implementation-in-progress`, `pr-ready`, `pr-merged`.

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

## Phase 5 — Parent Status Rollup (`--rollup`)

When the caller passes `--rollup`, this skill **derives a parent/container's `status:*` label from the roll-up of its children** instead of acting on a leaf. A **Project** (the Epic equivalent) rolls up from its Issues; an **Issue** rolls up from its sub-Issues. This implements the Linear child-issue-status arm of the **Parent status rollup (the state machine)** section of the `leaf-only-lifecycle` rule — cite that rule, do not restate the policy.

**Resolve the child set the same way `lisa:linear-read-issue` does** — `mcp__linear-server__list_issues({project: <id>})` for a Project's Issues, or `mcp__linear-server__get_issue` per child for an Issue's sub-Issues (via `parentId`). Capture each child's `status:*` label. If the item has **no** children it is a leaf — rollup is N/A; behave as a normal milestone sync.

**Evaluate the required children in priority order and take the first match** (canonical roles from `config-resolution`; Linear label map is `status:blocked`, `status:in-progress`, `status:code-review`, `status:done`):

| If among the required child leaves… | Derived parent role | Linear label |
|---|---|---|
| any child carries `status:blocked` | `blocked` | `status:blocked` |
| else any child carries `status:in-progress` **or** `status:code-review` | `claimed` | `status:in-progress` |
| else **all** required children carry `status:done` | `done` | the configured terminal `done` label |
| else (children exist, none started) | — | unchanged — parent keeps its non-ready container label |

- **Blocked dominates** — one blocked child surfaces `status:blocked` on the parent even while siblings progress.
- **"Required" children only** — won't-do / optional (e.g. `Canceled`) children do not hold the parent open.
- **Recursive** — a Project reaches `status:done` only when its Issues have themselves rolled up to `status:done`. Evaluate bottom-up.
- **Never set the parent to `status:ready`** — `ready` is leaf-only. Rollup only moves the parent between non-ready container labels.

**Single-environment collapse (this repo).** The terminal `done` resolves via the env-keyed `done` logic in `config-resolution`. In this repo `deploy.branches` declares only `production: main`, so `done` collapses to the single `status:done` label and the lifecycle is `status:ready → status:in-progress → status:code-review → status:done` with **no** dev/staging promotion hops; the rollup never resolves a dev or staging `done`. Multi-environment projects keep the env-keyed map.

**Apply the derived label** via `mcp__linear-server__save_issue` (Project or Issue), removing the parent's existing `status:*` and adding the derived one so exactly one `status:*` label remains. Post an idempotent rollup comment naming the derived state and the child tally. The native Linear `state` is **not** auto-transitioned — only the `status:*` label, mirroring the `--update-label` rule. **Safe default:** if the derived terminal cannot be resolved (ambiguous required-set or unresolvable env `done`), do not guess — post the derived suggestion as a comment and leave the parent's label untouched.

## Rules

- Never auto-transition the native Linear `state` — only the label, and only when the caller explicitly asks (`--update-label`, or `--rollup` for parent derivation per the `leaf-only-lifecycle` rule).
- Rollup derives a *parent's* `status:*` label from its children and never sets a parent to `status:ready`. It cites the `leaf-only-lifecycle` rule by slug rather than restating the state machine.
- Never post empty or minimal comments — if a milestone has no meaningful content, skip the post.
- Do not delete prior milestone comments. They are the audit trail.
- If `save_comment` fails, retry once. If it fails again, surface the error.

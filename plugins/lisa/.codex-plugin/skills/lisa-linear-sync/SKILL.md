---
name: lisa-linear-sync
description: "Syncs plan progress to a linked…"
allowed-tools: ["Bash", "Skill"]
---

# Sync Plan to Linear: $ARGUMENTS

Post milestone updates to the linked Linear Issue at key plan-lifecycle moments. This skill is the destination of the `lisa-tracker-sync` shim when `tracker = "linear"`.

## Configuration

Reads `linear.workspace`, `linear.teamKey` from `.lisa.config.json` (with `.local` override).

## When to invoke

Callers (planning skills, lifecycle skills) invoke this skill at:

| Milestone | What to post |
|-----------|--------------|
| Plan created | Plan contents (sections + ordered tasks) as a comment, suggest transition `Backlog → Todo` (label: `status:ready`) |
| Implementation in progress | Branch URL + first commit, suggest transition `Todo → In Progress` (label: `status:in-progress`) |
| PR ready for review | PR URL + summary, the implementation handoff comment, suggest transition `In Progress → In Review` (label: `status:code-review`) |
| PR merged | Merge SHA + deploy environment (if known), suggest transition `In Review → Done` (label: `status:done`), **then run Phase 4b — mandatory when the merge target is a non-terminal env branch** |

This skill **suggests** transitions but does not auto-transition the native Linear `state` field. It DOES update the `status:*` label set when the caller asks (the build queue is keyed off labels). Native state transitions remain a human / triage decision.

## Input

`$ARGUMENTS` is `<IDENTIFIER> <milestone>` where:

- `<IDENTIFIER>` is the Linear Issue identifier (e.g. `ENG-123`). If not provided, the skill searches the active plan file for a linked Linear Issue.
- `<milestone>` is one of `plan-created`, `implementation-in-progress`, `pr-ready`, `pr-merged`.
- Optional tokens include `pr_url=<url>` for the live pull request and `merge_sha=<sha>` once merged.

## Phase 1 — Resolve Issue

1. If `$ARGUMENTS` includes an identifier, parse it.
2. Else search for the active plan file (most recent file under `plans/`) and extract the linked Linear Issue identifier from its frontmatter.
3. Fetch the Issue via `lisa-linear-access operation: get-issue` to confirm it exists.

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

Call `lisa-linear-access operation: save-comment({issueId: <id>, body: <comment>})`.

## Phase 3b — Ensure PR Backlink

When `$ARGUMENTS` includes `pr_url=<url>` for `pr-ready` or `pr-merged`, ensure the Linear Issue has a durable ticket -> PR link:

1. Prefer Linear's native GitHub attachment / pull request link when the integration has attached the PR through the branch name, PR title, or PR body issue identifier. Verify by re-reading the Issue and its attachments / relations where the Linear access layer exposes them.
2. If native linkage is unavailable, unconfigured, cross-system, or cannot be verified, create or update a single managed Linear comment containing the PR URL. The comment must start with `[lisa-pr-link]` and include the milestone (`pr-ready` or `pr-merged`) and merge SHA when available.
3. Keep the fallback idempotent: read existing comments where the access layer exposes them, find the `[lisa-pr-link]` comment for the same PR URL, and update/skip it instead of appending duplicates. If comment update is unavailable, skip when an identical managed comment already exists and otherwise add exactly one replacement comment with the stable marker.

The PR branch/title/body identifier is the PR -> Linear side. This phase is the required Linear -> PR side.

## Phase 4 — Update Status Label (when caller requests)

If the caller passes `--update-label`, update the `status:*` label set via `lisa-linear-access operation: save-issue`:

- `plan-created` → add `status:ready`
- `implementation-in-progress` → remove `status:ready`, add `status:in-progress`
- `pr-ready` → remove `status:in-progress`, add `status:code-review`
- `pr-merged` → remove `status:code-review`, add `status:done`

If the requested label doesn't exist on the team, create it via `lisa-linear-access operation: create-issue-label`.

Verify exactly one `status:*` label remains after the update — having two simultaneously breaks the build-queue invariant.

Without `--update-label`, this skill posts the comment only and does NOT touch labels.

## Phase 4b — Reconcile Native Auto-Close (Linear-specific)

Linear's GitHub integration completes a linked Issue on merge to **any branch** — unlike GitHub's default-branch-scoped `Closes` auto-close — so a magic word (`Closes`/`Fixes`/`Resolves ENG-123`) or branch-name linkage can natively move the Issue to a Done/Completed workflow `state` at a **non-terminal** env merge, front-running the env-keyed `status:*` label ladder. `git-submit-pr` prevents the magic-word case; this phase is the required post-merge repair for the residual (branch-linkage) case we cannot suppress server-side — branch linkage completes the Issue even when the PR body carries only the non-closing `Linear: <ID>` form. This phase is a **mandatory** numbered step of every `pr-merged` sync, not an optional backstop; run it whenever the resolved env is **intermediate** (below the production terminal `done`):

1. Resolve the merged PR's base branch to its env via `.lisa.config.json` `deploy.branches` (`config-resolution`). If it maps to the production/terminal `done`, this phase is a **no-op** — native completion is correct there.
2. **Uniform / single-environment no-op.** When the project's env-keyed `done` map is uniform — every environment resolves to the same `status:done`, as in this repo (`production: main` only) and TunnlAI/frontend — dev-merge == terminal, so native completion is correct. Do nothing. Only a **non-uniform** env→`done` map (distinct `status:on-dev`/`status:on-stg`/`status:done` rungs) can desync.
3. Otherwise (non-uniform map, resolved env intermediate): re-read the Issue's native workflow `state`. If Linear natively moved it into a Done/Completed category while the derived `status:*` label is a lower env, **re-open** the native `state` back to the active/in-progress category (via `lisa-linear-access operation: save-issue`) so it mirrors the true env stage, and post a short `[lisa-linear-sync]` reconciliation comment. This applies the `leaf-only-lifecycle` "Terminal native closure" rule — native closure fires **only** at the production terminal `done` — as a *repair* of Linear front-running it. Cite the rule by slug; do not restate it.
4. **Safe default.** If the true terminal cannot be resolved (ambiguous env or unresolvable `done` map), do not change the native `state` — post a `[lisa-linear-sync]` reconciliation-suggestion comment and leave it untouched, mirroring the Phase 5 safe default.

## Phase 5 — Parent Status Rollup (`--rollup`)

When the caller passes `--rollup`, this skill **derives a parent/container's `status:*` label from the roll-up of its children** instead of acting on a leaf. A **Project** (the Epic equivalent) rolls up from its Issues; an **Issue** rolls up from its sub-Issues. This implements the Linear child-issue-status arm of the **Parent status rollup (the state machine)** section of the `leaf-only-lifecycle` rule — cite that rule, do not restate the policy.

**Resolve the child set the same way `lisa-linear-read-issue` does** — `lisa-linear-access operation: list-issues({project: <id>})` for a Project's Issues, or `lisa-linear-access operation: get-issue` per child for an Issue's sub-Issues (via `parentId`). Capture each child's `status:*` label. If the item has **no** children it is a leaf — rollup is N/A; behave as a normal milestone sync.

**Evaluate the required children over the env ladder `in-progress < dev < staging < production` (the ordered keys of the Linear env-keyed `done` map, e.g. `status:on-dev < status:on-stg < status:done`) and take the first match** (canonical roles from `config-resolution`; Linear label map is `status:blocked`, `status:in-progress`, `status:code-review`, env-keyed `done`):

| If among the required child leaves… | Derived parent role | Linear label |
|---|---|---|
| any child carries `status:blocked` | `blocked` | `status:blocked` |
| else **every** required child has shipped to some env (each at a `done`-map label, e.g. `status:on-dev`/`status:on-stg`/`status:done`) | `done[min-env]` | the **least-advanced** env label among them (all `status:on-stg` → `status:on-stg`; mixed dev+staging → `status:on-dev`; all production → `status:done`) |
| else any child has **started** (`status:in-progress` / `status:code-review`, or shipped to an env while a sibling has not) | `claimed` | `status:in-progress` |
| else (children exist, none started) | — | unchanged — parent keeps its non-ready container label |

- **Blocked dominates** — one blocked child surfaces `status:blocked` on the parent even while siblings progress.
- **Least-advanced env wins** — the parent reaches an env only when every required child has reached at least that env; it never sits ahead of its laggard child. Native completion (moving the workflow `state` to Done) fires only when the resolved env is the production `status:done`, never at `status:on-dev`/`status:on-stg`.
- **"Required" children only** — won't-do / optional (e.g. `Canceled`) children do not hold the parent open.
- **Recursive** — a Project reaches an env only when its Issues have themselves rolled up to at least that env. Evaluate bottom-up.
- **Never set the parent to `status:ready`** — `ready` is leaf-only. Rollup only moves the parent between non-ready container labels.

**Single-environment collapse (this repo).** The env rungs resolve via the env-keyed `done` logic in `config-resolution`. In this repo `deploy.branches` declares only `production: main`, so `done` collapses to the single `status:done` label, the only env rung is production, and the lifecycle is `status:ready → status:in-progress → status:code-review → status:done` with **no** dev/staging promotion hops; the rollup never resolves a dev or staging `done`. Multi-environment projects keep the env-keyed map and roll a parent up to intermediate env labels (`status:on-dev`/`status:on-stg`).

**Apply the derived label** via `lisa-linear-access operation: save-issue` (Project or Issue), removing the parent's existing `status:*` and adding the derived one so exactly one `status:*` label remains. Post an idempotent rollup comment naming the derived state and the child tally. The native Linear `state` is **not** auto-transitioned — only the `status:*` label, mirroring the `--update-label` rule. **Safe default:** if the derived terminal cannot be resolved (ambiguous required-set or unresolvable env `done`), do not guess — post the derived suggestion as a comment and leave the parent's label untouched.

## Rules

- Never auto-transition the native Linear `state` — only the label, and only when the caller explicitly asks (`--update-label`, or `--rollup` for parent derivation per the `leaf-only-lifecycle` rule).
- Rollup derives a *parent's* `status:*` label from its children and never sets a parent to `status:ready`. It cites the `leaf-only-lifecycle` rule by slug rather than restating the state machine.
- Never post empty or minimal comments — if a milestone has no meaningful content, skip the post.
- Do not delete prior milestone comments. They are the audit trail.
- If `save_comment` fails, retry once. If it fails again, surface the error.
- Pull request backlinks are mandatory when `pr_url=<url>` is present: native first, managed-comment fallback, never silently dropped.

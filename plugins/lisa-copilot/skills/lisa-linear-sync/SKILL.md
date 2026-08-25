---
name: lisa-linear-sync
description: "Syncs plan progress to a linked Linear Issue. Posts plan contents, progress updates, branch links, and PR links at key milestones. Use this skill throughout the plan lifecycle to keep Linear Issues in sync. The Linear counterpart of lisa-jira-sync and lisa-github-sync."
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
| Plan created | Plan contents (sections + ordered tasks) as a comment, suggest transition `Backlog → Ready` (state: `Ready`) |
| Implementation in progress | Branch URL + first commit, suggest transition `Ready → In Progress` (state: `In Progress`) |
| PR ready for review | PR URL + summary, the implementation handoff comment, suggest transition `In Progress → In Review` (state: `In Review`) |
| PR merged | Merge SHA + deploy environment (if known), suggest transition `In Review → Done` (state: `Done`), **then run Phase 4b — mandatory when the merge target is a non-terminal env branch** |

This skill **suggests** transitions and applies them to the native Linear `state` field when the caller asks — the build queue is keyed off states, so the state IS the lane. Without `--update-state` it only suggests; an unasked-for transition remains a human / triage decision.

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

Next: implementation begins. Suggested state: **Ready**.
```

## Phase 3 — Post Comment

Call `lisa-linear-access operation: save-comment({issueId: <id>, body: <comment>})`.

## Phase 3b — Ensure PR Backlink

When `$ARGUMENTS` includes `pr_url=<url>` for `pr-ready` or `pr-merged`, ensure the Linear Issue has a durable ticket -> PR link:

1. Prefer Linear's native GitHub attachment / pull request link when the integration has attached the PR through the branch name, PR title, or PR body issue identifier. Verify by re-reading the Issue and its attachments / relations where the Linear access layer exposes them.
2. Establish the managed backlink comment by running the command that owns it — never by hand, and never by describing the procedure here:

   ```bash
   node scripts/lisa-work-item.mjs backlink --ref <work-item> --pr-url <url>
   ```

   It creates the `[lisa-pr-link]` comment or updates the one already present, instead of appending duplicates, so it is safe to run on every milestone. This is **unconditional** — run it whether or not native linkage exists or cannot be verified, because the required Work-Item Traceability check reads this comment and nothing else guarantees one. The comment carries the marker and the PR URL only; the milestone (`pr-ready` / `pr-merged`) and merge SHA belong in the milestone progress note, so that a rerun at a new milestone still converges on one backlink comment.

The PR branch/title/body identifier is the PR -> Linear side. This phase is the required Linear -> PR side.

## Phase 4 — Update Workflow State (when caller requests)

If the caller passes `--update-state`, set the Issue's `stateId` via `lisa-linear-access operation: save-issue`:

- `plan-created` → set state `Ready`
- `implementation-in-progress` → set state `In Progress`
- `pr-ready` → set state `In Review`
- `pr-merged` → set state `Done`

If the requested STATE doesn't exist on the team, that is a setup defect — report it and point at `/lisa:setup:linear`. Never create a workflow state here: a state carries a `type` and a board position, and guessing either puts the Issue somewhere no human sanctioned.

No single-lane verification is needed: an Issue holds exactly one workflow state by construction, so the two-lanes-at-once corruption the old label-driven lane could produce is unrepresentable. (It was not hypothetical — 16 issues carried two `status:*` labels at the time of the migration.)

Without `--update-state`, this skill posts the comment only and does NOT touch the Issue's state.

## Phase 4b — Reconcile Native Auto-Close (Linear-specific)

Linear's per-team **git automations** complete a linked Issue on merge to **any branch** — unlike GitHub's default-branch-scoped `Closes` auto-close — so a magic word (`Closes`/`Fixes`/`Resolves ENG-123`) or branch-name linkage can move the Issue to a `completed` state at a **non-terminal** env merge, front-running the env-keyed ladder.

**Since the build lane moved to native states, this phase is a BACKSTOP, not the primary defence.** The lifecycle now writes the same field the automation writes, so the disagreement it repairs can only arise when something outside Lisa moves the Issue. The primary fix is upstream and structural: `/lisa:setup:linear` detects the team's `merge → Done` git automation and offers to delete it, because with this model that automation is a redundant second writer as well as a wrong one. Keep this phase — a workspace can always re-add the automation, and a magic word in a hand-written PR body still fires — but a recurrence here is a **setup defect to report**, not routine repair to absorb silently.

Run it whenever the resolved env is **intermediate** (below the production terminal `done`):

1. Resolve the merged PR's base branch to its env via `.lisa.config.json` `deploy.branches` (`config-resolution`). If it maps to the production/terminal `done`, this phase is a **no-op** — native completion is correct there.
2. **Uniform / single-environment no-op.** When the project's env-keyed `done` map is uniform — every environment resolves to the same `Done`, as in this repo (`production: main` only) — dev-merge == terminal, so native completion is correct. Do nothing. Only a **non-uniform** env→`done` map (distinct `On Dev`/`On Stg`/`Done` rungs) can desync.
3. Otherwise (non-uniform map, resolved env intermediate): re-read the Issue's `state`. If it sits in a `completed`-typed state while the derived role is a lower env rung, **re-open** the native state by moving it back to the correct env rung (via `lisa-linear-access operation: save-issue`) and post a short `[lisa-linear-sync]` reconciliation comment **naming the likely cause** — a live `merge → Done` git automation, or a magic word in the PR body. This applies the `leaf-only-lifecycle` "Terminal native closure" rule — closure fires **only** at the production terminal `done`. Cite the rule by slug; do not restate it.
4. **Safe default.** If the true terminal cannot be resolved (ambiguous env or unresolvable `done` map), do not change the `state` — post a `[lisa-linear-sync]` reconciliation-suggestion comment and leave it untouched, mirroring the Phase 5 safe default.

## Phase 5 — Parent Status Rollup (`--rollup`)

When the caller passes `--rollup`, this skill **derives a parent/container's workflow state from the roll-up of its children** instead of acting on a leaf. A **Project** (the Epic equivalent) rolls up from its Issues; an **Issue** rolls up from its sub-Issues. This implements the Linear child-issue-status arm of the **Parent status rollup (the state machine)** section of the `leaf-only-lifecycle` rule — cite that rule, do not restate the policy.

**Resolve the child set the same way `lisa-linear-read-issue` does** — `lisa-linear-access operation: list-issues({project: <id>})` for a Project's Issues, or `lisa-linear-access operation: get-issue` per child for an Issue's sub-Issues (via `parentId`). Capture each child's workflow state. If the item has **no** children it is a leaf — rollup is N/A; behave as a normal milestone sync.

**Evaluate the required children over the env ladder `in-progress < dev < staging < production` (the ordered keys of the Linear env-keyed `done` map, e.g. `On Dev < On Stg < Done`) and take the first match** (canonical roles from `config-resolution`; the Linear state map is `Blocked`, `In Progress`, `In Review`, env-keyed `done`):

| If among the required child leaves… | Derived parent role | Linear state |
|---|---|---|
| any child carries `Blocked` | `blocked` | `Blocked` |
| else **every** required child has shipped to some env (each at a `done`-map state, e.g. `On Dev`/`On Stg`/`Done`) | `done[min-env]` | the **least-advanced** env state among them (all `On Stg` → `On Stg`; mixed dev+staging → `On Dev`; all production → `Done`) |
| else any child has **started** (`In Progress` / `In Review`, or shipped to an env while a sibling has not) | `claimed` | `In Progress` |
| else (children exist, none started) | — | unchanged — parent keeps its non-ready container state |

- **Blocked dominates** — one blocked child surfaces `Blocked` on the parent even while siblings progress. It never says *which* child or *which kind* of hold; run `scripts/rollup-blocker-classification.mjs` over the resolved child graph and carry its per-class report — blocking leaf, path, and who must act — into the rollup note. A non-zero exit means it classified nothing; that is a failure to report, never an all-clear. See `leaf-only-lifecycle` → **Classifying a hold**.
- **Least-advanced env wins** — the parent reaches an env only when every required child has reached at least that env; it never sits ahead of its laggard child. Native completion (moving the workflow `state` to Done) fires only when the resolved env is the production `Done`, never at `On Dev`/`On Stg`.
- **"Required" children only** — won't-do / optional (e.g. `Canceled`) children do not hold the parent open.
- **Recursive** — a Project reaches an env only when its Issues have themselves rolled up to at least that env. Evaluate bottom-up.
- **Never roll a parent into the `ready` state** — `ready` is leaf-only. Rollup only moves the parent between non-ready container states.

**Single-environment collapse (this repo).** The env rungs resolve via the env-keyed `done` logic in `config-resolution`. In this repo `deploy.branches` declares only `production: main`, so `done` collapses to the single `Done` state, the only env rung is production, and the lifecycle is `Ready → In Progress → In Review → Done` with **no** dev/staging promotion hops; the rollup never resolves a dev or staging `done`. Multi-environment projects keep the env-keyed map and roll a parent up to the intermediate env states (`On Dev`/`On Stg`).

**Apply the derived state** via `lisa-linear-access operation: save-issue` (Project or Issue), setting the parent's `stateId` to the derived role. Post an idempotent rollup comment naming the derived state and the child tally. Because the terminal `done` state is itself typed `completed`, a parent rolled to terminal is natively closed by the same write — there is no second closure step. **Safe default:** if the derived terminal cannot be resolved (ambiguous required-set or unresolvable env `done`), do not guess — post the derived suggestion as a comment and leave the parent's state untouched.

## Rules

- Never transition the Issue's workflow `state` unless the caller explicitly asks (`--update-state`, or `--rollup` for parent derivation per the `leaf-only-lifecycle` rule). Without a flag this skill only SUGGESTS a transition in its comment. The state is the lifecycle lane now, so an unrequested write here would move the item in the build queue.
- Rollup derives a *parent's* workflow state from its children and never rolls a parent into the human-owned ready lane (never `$READY`). It cites the `leaf-only-lifecycle` rule by slug rather than restating the state machine.
- Never post empty or minimal comments — if a milestone has no meaningful content, skip the post.
- Do not delete prior milestone comments. They are the audit trail.
- If `save_comment` fails, retry once. If it fails again, surface the error.
- Pull request backlinks are mandatory when `pr_url=<url>` is present: native first, managed-comment fallback, never silently dropped.

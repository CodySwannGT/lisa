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

| Milestone | What to post | Suggested role |
|-----------|--------------|----------------|
| Plan created | Plan contents (sections + ordered tasks) as a comment | `ready` |
| Implementation in progress | Branch URL + first commit | `claimed` |
| PR ready for review | PR URL + summary, the implementation handoff comment | `review` — **optional; omitted by most projects, in which case there is no transition to suggest** |
| PR merged | Merge SHA + deploy environment (if known) | env-keyed `done`, **then run Phase 4b — mandatory when the merge target is a non-terminal env branch** |

**Roles, never literal state names.** Resolve each through the shared resolver; the state names above are whatever the project configured, and a role the project did not configure has no suggestion at all:

```bash
resolve() {
  node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-lifecycle-role.mjs" \
    --role "$1" --vendor linear --intent read 2>/dev/null
}
```

**This skill SUGGESTS transitions. It never writes the lane.** That matches `lisa-jira-sync` ("suggest, but don't automatically perform") and `lisa-github-sync` ("this skill never relabels"), and it is what this skill's own dispatcher already advertises: `lisa-tracker-sync`'s description reads *"Suggests (never auto-transitions) the next status."* Lane writes belong to the build-intake / agent owner, which is already true on the other two trackers.

`--rollup` is the one exception and is documented in Phase 4b — parent derivation is its entire purpose and is separately gated.

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

## Phase 4 — Suggest the Next State (never write it)

Name the suggested next state in the milestone comment and stop. **This skill does not set `stateId`.** The lane write belongs to `lisa-linear-build-intake` / `lisa-linear-agent`, exactly as the `status:*` write belongs to `lisa-github-build-intake` on GitHub.

Resolve the suggestion by role, and **say nothing when the role is unset**:

| Milestone | Role to resolve | When the role is unset |
|---|---|---|
| `plan-created` | `ready` | required — report a setup defect |
| `implementation-in-progress` | `claimed` | required — report a setup defect |
| `pr-ready` | `review` | **optional — suggest no transition; the Issue stays in `claimed`** |
| `pr-merged` | `done` for the PR's target env (via `deploy.branches`) | required — report a setup defect |

If a resolved state doesn't exist on the team, that is a setup defect — report it and point at `/lisa:setup:linear`. Never create a workflow state here: a state carries a `type` and a board position, and guessing either puts the Issue somewhere no human sanctioned. Equally, never *find* one: resolving a role by scanning the team for a state whose name or `type` looks right picks by board position, not intent, and the states that surface that way are the human-only lanes a project deliberately left out of its config.

> **Removed: `--update-state`.** This flag previously let a caller make Phase 4 write the state. It was the only lane-write path in any sync skill, and combined with a defaulted `review` role it moved Issues into review states that projects had never configured. Callers that relied on it should let the build-intake owner make the transition; `--rollup` is unaffected.

No single-lane verification is needed: an Issue holds exactly one workflow state by construction, so the two-lanes-at-once corruption the old label-driven lane could produce is unrepresentable. (It was not hypothetical — 16 issues carried two `status:*` labels at the time of the migration.)

## Phase 4b — Reconcile Native Auto-Close (Linear-specific)

Linear's per-team **git automations** complete a linked Issue on merge to **any branch** — unlike GitHub's default-branch-scoped `Closes` auto-close — so a magic word (`Closes`/`Fixes`/`Resolves ENG-123`) or branch-name linkage can move the Issue to a `completed` state at a **non-terminal** env merge, front-running the env-keyed ladder.

**Since the build lane moved to native states, this phase is a BACKSTOP, not the primary defence.** The lifecycle now writes the same field the automation writes, so the disagreement it repairs can only arise when something outside Lisa moves the Issue. The primary fix is upstream and structural: `/lisa:setup:linear` detects the team's `merge → Done` git automation and offers to delete it, because with this model that automation is a redundant second writer as well as a wrong one. Keep this phase — a workspace can always re-add the automation, and a magic word in a hand-written PR body still fires — but a recurrence here is a **setup defect to report**, not routine repair to absorb silently.

Run it whenever the resolved env is **intermediate** (below the production terminal `done`):

1. Resolve the merged PR's base branch to its env via `.lisa.config.json` `deploy.branches` (`config-resolution`). If it maps to the production/terminal `done`, this phase is a **no-op** — native completion is correct there.
2. **Uniform / single-environment no-op.** When the project's env-keyed `done` map is uniform — every environment resolves to the same `Done`, as in this repo (`production: main` only) — dev-merge == terminal, so native completion is correct. Do nothing. Only a **non-uniform** env→`done` map (distinct `On Dev`/`On Stg`/`Done` rungs) can desync.
3. Otherwise (non-uniform map, resolved env intermediate): re-read the Issue's `state`. If it sits in a `completed`-typed state while the derived role is a lower env rung, **re-open** the native state by moving it back to the correct env rung (via `lisa-linear-access operation: save-issue lifecycle_role: done env: <resolved-rung>` — the backstop names the role and the rung like every other lifecycle write; it never re-derives a state ID itself) and post a short `[lisa-linear-sync]` reconciliation comment **naming the likely cause** — a live `merge → Done` git automation, or a magic word in the PR body. This applies the `leaf-only-lifecycle` "Terminal native closure" rule — closure fires **only** at the production terminal `done`. Cite the rule by slug; do not restate it.
4. **Safe default.** If the true terminal cannot be resolved (ambiguous env or unresolvable `done` map), do not change the `state` — post a `[lisa-linear-sync]` reconciliation-suggestion comment and leave it untouched, mirroring the Phase 5 safe default.

## Phase 5 — Parent Status Rollup (`--rollup`)

When the caller passes `--rollup`, this skill **derives a parent/container's workflow state from the roll-up of its children** instead of acting on a leaf. A **Project** (the Epic equivalent) rolls up from its Issues; an **Issue** rolls up from its sub-Issues. This implements the Linear child-issue-status arm of the **Parent status rollup (the state machine)** section of the `leaf-only-lifecycle` rule — cite that rule, do not restate the policy.

**Resolve the child set the same way `lisa-linear-read-issue` does** — `lisa-linear-access operation: list-issues({project: <id>})` for a Project's Issues, or `lisa-linear-access operation: get-issue` per child for an Issue's sub-Issues (via `parentId`). Capture each child's workflow state. If the item has **no** children it is a leaf — rollup is N/A; behave as a normal milestone sync.

**Evaluate the required children over the env ladder `in-progress < dev < staging < production` (the ordered keys of the Linear env-keyed `done` map) and take the first match** (canonical roles from `config-resolution`; the Linear state map is the configured `blocked`, `claimed`, optional `review`, and env-keyed `done` — resolve each by role, and treat an unset `review` as simply having no such rung):

| If among the required child leaves… | Derived parent role | Linear state |
|---|---|---|
| any child carries `Blocked` | `blocked` | `Blocked` |
| else **every** required child has shipped to some env (each at a `done`-map state, e.g. `On Dev`/`On Stg`/`Done`) | `done[min-env]` | the **least-advanced** env state among them (all `On Stg` → `On Stg`; mixed dev+staging → `On Dev`; all production → `Done`) |
| else any child has **started** (at the `claimed` state, at the `review` state where the project configures one, or shipped to an env while a sibling has not) | `claimed` | the configured `claimed` state |
| else (children exist, none started) | — | unchanged — parent keeps its non-ready container state |

- **Blocked dominates** — one blocked child surfaces `Blocked` on the parent even while siblings progress. It never says *which* child or *which kind* of hold; resolve and run the shared classifier exactly as `lisa-tracker-sync` specifies, then carry its per-class report — blocking leaf, path, and who must act — into the rollup note. A missing classifier or non-zero exit is a strict **no-write** result: do not save parent state and do not post/update a rollup comment; report the failure, never an all-clear. See `leaf-only-lifecycle` → **Classifying a hold**.
- **Least-advanced env wins** — the parent reaches an env only when every required child has reached at least that env; it never sits ahead of its laggard child. Native completion (moving the workflow `state` to Done) fires only when the resolved env is the production `Done`, never at `On Dev`/`On Stg`.
- **"Required" children only** — won't-do / optional (e.g. `Canceled`) children do not hold the parent open.
- **Recursive** — a Project reaches an env only when its Issues have themselves rolled up to at least that env. Evaluate bottom-up.
- **Never roll a parent into the `ready` state** — `ready` is leaf-only. Rollup only moves the parent between non-ready container states.

**Single-environment collapse (this repo).** The env rungs resolve via the env-keyed `done` logic in `config-resolution`. In this repo `deploy.branches` declares only `production: main`, so `done` collapses to the single `Done` state, the only env rung is production, and the lifecycle is `ready → claimed → done` with **no** dev/staging promotion hops and no configured `review` rung; the rollup never resolves a dev or staging `done`. Multi-environment projects keep the env-keyed map and roll a parent up to the intermediate env states.

**Apply the derived state** via `lisa-linear-access operation: save-issue lifecycle_role: <derived role> [env: <key>]` (Project or Issue), naming the derived role — the access layer resolves the configured state for that role and dispatches it. This skill never computes a `stateId` of its own; a role the project never bound is refused there rather than approximated here. Post an idempotent rollup comment naming the derived state and the child tally. Because the terminal `done` state is itself typed `completed`, a parent rolled to terminal is natively closed by the same write — there is no second closure step. **Safe default:** if the derived terminal cannot be resolved (ambiguous required-set or unresolvable env `done`), do not guess — post the derived suggestion as a comment and leave the parent's state untouched.

## Rules

- Never transition a leaf Issue's workflow `state` from this skill except for the narrowly defined Phase 4b backstop that reopens a leaf auto-closed at an intermediate environment. `--rollup` remains the only other write path (parent derivation, per the `leaf-only-lifecycle` rule); every normal milestone SUGGESTS a transition in its comment and nothing more. The state is the lifecycle lane, so an unscoped write here would move the item in the build queue.
- Never resolve a role by searching the team's states. Only a name the project configured may be written; a `type`- or position-derived match may inform a read and must never supply a write target (`config-resolution`, R2).
- Rollup derives a *parent's* workflow state from its children and never rolls a parent into the human-owned ready lane (never `$READY`). It cites the `leaf-only-lifecycle` rule by slug rather than restating the state machine.
- Never post empty or minimal comments — if a milestone has no meaningful content, skip the post.
- Do not delete prior milestone comments. They are the audit trail.
- If `save_comment` fails, retry once. If it fails again, surface the error.
- Pull request backlinks are mandatory when `pr_url=<url>` is present: native first, managed-comment fallback, never silently dropped.

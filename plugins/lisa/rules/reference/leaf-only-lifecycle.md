# Leaf-Only Build-Ready Invariant, Parent Status Rollup & Terminal Native Closure

This is the single vendor-neutral source of truth for three coupled lifecycle rules. Every `*-to-tracker`, `*-write-*`, `*-validate-*`, and `*-build-intake` skill cites this rule rather than restating it, so per-vendor logic does not drift.

1. **Leaf-only invariant** — only an independently implementable **leaf work unit** may carry the build-ready role. A parent/container with child work is never directly build-ready.
2. **Parent status rollup** — a parent/container's lifecycle state is *derived* from its children, never set independently.
3. **Terminal native closure** — when a leaf work unit reaches the configured terminal `done` role, Lisa also closes / resolves / completes it using the provider's native mechanism where one exists. Intermediate done-like environment states stay open.

The first two are the same idea seen from opposite ends: a parent never enters the build queue as work; it only ever *reflects* the state of the leaves underneath it. The third keeps the provider's native open/closed signal aligned with Lisa's terminal lifecycle state so finished work does not linger as open.

## Why this exists

Build intake processes whatever carries the build-ready role (the `ready` role — see `config-resolution`). A parent container (an Epic, a Story, a Linear Project, any issue with child work) is not a unit of implementation; it organizes work. If a parent is marked build-ready, an agent may try to implement the container itself unless intake gates it first — the wrong permission and lifecycle boundary. This surfaced in real PRD intake: a PRD decomposed into an Epic, Stories, and Sub-tasks, and *every* item received the build-ready label, so a subsequent build pass would have tried to "implement" the Epic.

The fix is not vendor-specific. It belongs here, in a cross-vendor rule, and every writer / validator / intake path enforces it.

## Container vs. leaf taxonomy

A **leaf work unit** is an individually implementable item with **no open child work**. Structurally, that is *any work item with no open children except an Epic*: the by-design leaf types **Bug, Task, Sub-task, Improvement**, plus a **childless Story or Spike** (a Story is a directly shippable increment and a Spike is itself the investigation unit — neither needs sub-items to be implementable). These are what an agent claims and implements. A leaf work unit is also single-repo (the `repo-scope-split` rule).

A **container** organizes other work and is never directly implemented:

| Class | Examples by type | May carry build-ready? |
|---|---|---|
| **Leaf work unit** | Bug, Task, Sub-task, Improvement, or a childless Story / Spike — anything with no open children **except an Epic** | **Yes** |
| **Container** | An **Epic**, or *any* item (of any type) that has open child work | **No** — state rolls up from children |

The classification is **structural, not nominal**: an item is a container if it has open child work, regardless of its declared type. A "Task" that has acquired sub-tasks is a container for rollup purposes. The single nominal exception is the **Epic**, which is a pure rollup container by design and is treated as a container even when childless; for every other type the presence of children is decisive. See the childless-parent exception below for the converse case.

### How each vendor encodes hierarchy

The invariant is vendor-neutral; the mechanics of "has child work" differ. A skill resolves child membership using the native hierarchy first, falling back to text/metadata links where the vendor has no native parent/child:

- **GitHub Issues** — native **sub-issues** (parent ↔ child issue graph), plus task-list checkboxes and `Blocked by #<n>` / parent references in the body. Epic and Story are modeled as parent issues; their Sub-tasks are sub-issues.
- **JIRA** — native **Epic → Story → Sub-task** hierarchy: Epic link / parent field for Stories under an Epic, and the subtask relationship for Sub-tasks under a Story/Task. Issue links (`blocks` / `is blocked by`) express cross-item dependencies but are not parentage.
- **Linear** — **Project** (the Epic equivalent) groups **Issues** via `projectId`; an Issue groups **sub-issues** via `parentId`. Project state and Issue state are native. Relations (`save_issue_relation`) express dependencies, not parentage. (Initiatives are not used — see `config-resolution`.)

Where a vendor lacks native hierarchy for a given pair, a text link or metadata marker establishes the relationship (per PRD #522 non-goals: vendors need not expose identical native hierarchy features).

## Leaf-only invariant (the rule)

**Build-ready means a directly implementable leaf work unit.** Therefore:

- **At decomposition / write time** — when a PRD decomposes into a hierarchy, only the leaf work units receive the `ready` role (status/label). Parent containers (Epic, Story, Project, and any parent issue that has child work) are created in their normal non-ready state and never receive the build-ready role directly. The leaves are what downstream build intake will claim.
- **At validate time** — the `*-validate-*` gate FAILs any container carrying the build-ready role. This is the symmetric write-side guard: a stale or hand-applied build-ready role on a parent is a lifecycle error. Conversely, the parent-declared gate (S7) does **not** FAIL a build-ready leaf that has no parent: a flat Task/Improvement or a childless Story/Spike may stand alone, so a missing parent on such a leaf is `N/A`. Stranding a parentless build-ready leaf would directly violate the "must not be stranded" guarantee below. (A Sub-task is the one exception — it always requires a parent.)
- **At claim time** — build intake scans for the `ready` role but dispatches **only leaf work units**. A container that still carries a stale build-ready role (e.g. applied before this rule existed) is **not dispatched**: intake either moves it into the vendor's parent/container progress state or safely blocks it with a clear lifecycle-repair message. Intake never silently implements a container.

The permission boundary is the maintainer-applied build-ready role, not authorship — do not add author-based guards (PRD #522 non-goal). This rule narrows *what* may carry that role, not *who* may apply it.

## Childless-parent exception

A childless item is, structurally, a leaf — and may be build-ready **unless its issue type is Epic**.

- A **Task, Bug, Story, Spike,** or **Improvement** with no children → leaf → may be build-ready. Many real tickets are flat Tasks with no sub-tasks; just as common, a **Story** is implemented directly as a single shippable increment and a **Spike** *is* the investigation work unit. None of these need to be decomposed to be claimable, and this rule must not strand them. (A childless Story/Spike promoted to a leaf this way is single-repo like any other leaf — see `repo-scope-split`.)
- An **Epic** with no children → still **not** build-ready. An Epic is a pure rollup container by design: its body is a high-level summary, never a directly implementable unit, so a childless Epic carrying the build-ready role is an incomplete decomposition or a mis-applied role — not work. The correct repair is to decompose it (add leaf children) or reclassify it to a leaf type — not to claim it.

So the exception is narrow only at the top: childlessness promotes every type **except Epic** to a build-ready leaf. A childless Epic is never directly implementable; everything else, when childless, is.

## Parent status rollup (the state machine)

A parent/container never sets its own lifecycle state; it **derives** it from the roll-up of its children's states. Rollup is evaluated whenever a child transitions (or when intake observes the child set). Using the canonical build-lifecycle roles from `config-resolution` (`ready`, `claimed`, `review`, `blocked`, `done`):

Evaluate over the **env ladder** `in-progress < dev < staging < production` — the ordered keys of the project's env-keyed `done` map, with `claimed`/`review` as the rung below the first env (a single-environment project has only the `production` rung). Take the **first** match:

| If among the required leaves… | …the parent rolls up to | Role |
|---|---|---|
| any leaf is **blocked** | blocked / attention-needed | `blocked` |
| else **every** required leaf has shipped to some env (each is at a `done`-map value) | the **least-advanced** env among them on the ladder | env-keyed `done[min-env]` (terminal `done` when that env is production) |
| else any leaf has **started** (claimed / in review, or shipped to some env while a sibling has not) | active / in-progress | `claimed` (or `review` where supported — see below) |
| else (leaves exist but none started) | unchanged (parent stays in its non-ready container state) | — |

The middle two rungs are the same idea seen at two resolutions: a parent reaches an env only once **all** its required leaves have reached **at least** that env. So all leaves at `On Stg` → parent `On Stg`; a mix of `On Dev` and `On Stg` → parent `On Dev` (the set as a whole has only fully reached dev); any leaf still `claimed`/`review` (not yet shipped anywhere) holds the parent at `claimed`. In a single-environment project the only env rung is production, so this collapses to the familiar "all leaves `done` → parent `done`, else `claimed`."

Notes:

- **Blocked dominates.** A single blocked leaf surfaces blocked/attention on the parent even if other leaves are progressing, so a human sees the parent needs attention.
- **"Required" leaves.** Optional or won't-do children do not hold a parent open; only the leaves that must ship for the parent to be complete are counted toward the env-rollup check.
- **Least-advanced env wins.** The parent reflects the env the whole required set has collectively reached — never an env ahead of its laggard leaf. Native closure (below) fires only when the resolved env is the production/terminal value, never at an intermediate env (`On Dev`/`On Stg`).
- **Rollup is recursive.** An Epic rolls up from its Stories, each of which rolls up from its own leaves. Evaluate bottom-up: a Story reaches an env only when its leaves have all reached at least that env; an Epic reaches it only when its Stories have.
- **Vendor support varies.** Apply the rollup state the vendor can express. Where a vendor has no native intermediate state, use the nearest configured role or a metadata/comment signal rather than forcing a non-existent status (PRD #522 non-goal: vendors need not expose identical states).
- **The parent never carries `ready`.** `ready` is a *human* "this is buildable, claim it" signal and only ever lives on leaves. Rollup moves a parent between non-ready container states (in-progress / per-env / blocked / terminal); it never sets the parent to `ready`. A container found carrying `ready` is a leaf-only-invariant violation — recompute its rolled state from its children and apply that (see `repair-intake`).

### The rollup env states are the configured "done" map — multi-env capable

The env rungs are whatever the project configures for `done` — which is **env-keyed** (`config-resolution` "Env-keyed `done`"): a `done` map keyed by environment (`dev`, `staging`, `production`), each leaf's env resolved from its merged PR's base branch. This rule does **not** hardcode a `dev → staging → prod` promotion chain as required — that is a project-specific deploy topology; the ladder is simply the ordered keys of the project's `done` map. A downstream project with dev/staging/prod environments rolls a parent up to the least-advanced env value its required leaves have collectively reached (an intermediate-env parent state, e.g. `On Stg`), and only to the production `done` value once every required leaf is at production. The rule stays generic and multi-env capable.

Intermediate-env rollup and terminal native closure are distinct: a parent **rolls up to** an intermediate env (`On Dev`/`On Stg`) as its required leaves reach it, but native closure (next section) fires **only** at the production/terminal `done` value. A parent sitting at `On Stg` is correctly rolled up *and* still open.

**Single-environment collapse (this repo).** Lisa's own deploy has only `main`/`production` (no dev/staging), so `done` is a single value, not a map. For GitHub, the build lifecycle collapses to one chain: `ready → claimed (in-progress) → done`. The rollup terminal state is simply `done`. This is the *collapsed* case of the generic rule, not a different rule — projects with more environments keep the env-keyed map.

## Terminal native closure

The configured terminal `done` role is not just another label or status. Once a **leaf work unit** reaches the true terminal `done` value, Lisa must also finalize the item through the tracker's native completion mechanism when the tracker supports one:

| Tracker | Terminal native action |
|---|---|
| GitHub Issues | `gh issue close <number> --reason completed` after applying the terminal `done` label |
| Linear | move the Issue's native workflow `state` to the team's configured Done / Completed state after applying the terminal `done` label |
| JIRA | transition to the configured terminal Done / Resolved / Closed status and verify the resulting issue is in `statusCategory = Done` with a resolution when the workflow requires one |
| Provider without a close / archive concept | no-op; the terminal lifecycle role is sufficient |

This action is **terminal-only**:

- Intermediate env-keyed states such as `status:on-dev`, `status:on-stg`, `On Dev`, or `On Stg` remain open / unresolved / active. They are deployment waypoints, not terminal completion.
- A single-environment project whose `done` resolves to one value treats that value as terminal. In this repo, `production: main` means `status:done` / `Done` is terminal.
- A multi-environment project treats only the production / final environment's `done` value as terminal unless the project explicitly configures `done` as a single string. Do not close native work items at lower environments.
- The native finalization must be idempotent. If the item is already closed / completed / resolved, report that and continue.
- If a provider exposes no native close / archive operation, or a project has not configured the native Done state, record a capability-aware no-op or setup error according to the vendor skill. Do not invent a state name.

## Citation

Skills that enforce this invariant or perform rollup cite this rule by slug (the `leaf-only-lifecycle` rule) instead of restating it:

- **Decomposition / write** (`*-to-tracker`, `*-write-*`) — apply the `ready` role to leaves only; never to containers.
- **Validate** (`*-validate-*`) — FAIL a container carrying the build-ready role; FAIL a childless **Epic** marked build-ready (a childless Story/Spike is a valid leaf and passes).
- **Build intake** (`*-build-intake`, `tracker-build-intake`) — dispatch leaves only; move or safe-block containers with stale build-ready roles according to vendor lifecycle semantics.
- **Rollup** — derive parent state from children per the state machine above. `repair-intake`
  also uses this rule to close out parent/container rollups that were left open after every
  required child became terminal.
- **Terminal native closure** (`*-build-intake`, `repair-intake`, terminal helpers) — after a leaf
  or all-terminal rollup parent reaches the true terminal `done` role, finalize it through the
  provider's native close / complete / resolve mechanism where available; never do this for
  intermediate env states.

This is the inverse-direction companion to `repo-scope-split` (which governs a leaf's *repo* scope); together they define what a build-ready leaf work unit is: directly implementable, single-repo, childless-or-leaf-typed.

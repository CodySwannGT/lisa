# Leaf-Only Build-Ready Invariant, Parent Status Rollup & Terminal Native Closure

> Demoted from the always-on eager tier by CodySwannGT/lisa#3992. The
> section below is the former eager head, preserved verbatim; the full
> contract follows it. Reachable on demand via `rules/eager/00-rule-index.md`.

## Leaf-Only Build-Ready Invariant (load-bearing)

**Build-ready means a directly implementable leaf work unit.** Containers never carry build-ready.

A leaf is structurally defined: **no open children** AND not an Epic — the by-design leaf types (Bug, Task, Sub-task, Improvement) plus a childless Story or Spike. A container is an **Epic**, or any item of any type that has acquired open child work.

## Invariant

- **At decomposition/write time** — only leaves receive the `ready` role. Parent containers are created in their non-ready state.
- **At validate time** — `*-validate-*` FAILs any container carrying the build-ready role. The parent-declared gate (S7) does **not** FAIL a build-ready leaf with no parent (flat Task/Improvement or childless Story/Spike); a Sub-task is the one exception and always needs a parent.
- **At claim time** — build-intake claims leaves only. A container with a stale build-ready role is rolled up or safe-blocked, NEVER implemented.

## Childless-parent exception

A childless item is structurally a leaf — and may be build-ready **unless its type is Epic**:

- **Task, Bug, Story, Spike, or Improvement with no children** → leaf → may be build-ready. A Story ships directly as one increment and a Spike *is* the investigation unit; neither needs sub-items to be implementable, so a childless one must not be stranded.
- **Epic with no children** → still NOT build-ready. An Epic is a pure rollup container by design — its body is a high-level summary, never directly implementable — so a childless build-ready Epic is an incomplete decomposition or a mis-applied role. Repair: decompose into leaves, or reclassify to a leaf type.

## Parent state rollup (priority order, first match wins)

Evaluate over the env ladder `in-progress < dev < staging < production` (the ordered keys of the project's env-keyed `done` map; single-env projects have only the production rung):

1. Any leaf is **blocked** → parent rolls up to **blocked / attention-needed**.
2. Else **every** required leaf has shipped to some env → parent rolls up to the **least-advanced** env among them (all `On Stg` → `On Stg`; mixed `On Dev`+`On Stg` → `On Dev`; all production → terminal `done`).
3. Else any leaf has **started** (claimed/in review, or shipped while a sibling has not) → parent is **in-progress** (`claimed`).
4. Else (leaves exist but none started) → parent unchanged.

**Blocked dominates — but it must say which leaf and which kind.** A parent that rolls up to `blocked` names the blocking leaf (with the path to it) and the **class** of the hold, derived by `rollup-blocker-classification` from recorded signals only:

| Class | Recorded signal on the leaf | Who must act |
|---|---|---|
| `spec-defect` | the `spec_defect` marker (human-applied only) | a person rewrites the acceptance criteria — nothing external will ever clear it |
| `human-input` | the `human_needed` marker | a person supplies the input (access, credential, product decision) |
| `hard-blocker` | an open `is blocked by` link | nobody — it clears when that work closes |
| `unknown` | none of the above | a person says which kind it is, and records it |

Never infer a class from prose, and never auto-apply `spec_defect`: judging a criterion unbuildable is a human call, and `unknown` is the honest answer. A rollup that examined nothing — unreadable tracker, no children, no readable child — **fails**; it never reports not-blocked.

**Blocked dominates.** A parent reaches an env only once all required leaves have reached at least that env. Intermediate-env rollup (`On Dev`/`On Stg`) happens, but native closure fires only at production `done`. Optional/won't-do children do not hold a parent open. Rollup is recursive — bottom-up. The parent never carries `ready`; a container found in `ready` is reconciled by rolling it up from its children.

## Terminal native closure

When a leaf reaches the true terminal `done` (the production / final-env value), also finalize via the tracker's native completion mechanism:

- **GitHub** — `gh issue close <n> --reason completed` after the terminal label.
- **Linear** — move workflow `state` to the team's Done.
- **JIRA** — transition to terminal Done/Resolved/Closed; verify `statusCategory = Done`.

Intermediate env-keyed states (`status:on-dev`, `On Stg`, etc.) remain open. Idempotent — if already closed, report and continue.

### Exactly one lifecycle role survives closure

The terminal transition retires **every** other lifecycle role the item carries, not only the one it was last known to hold. Resolve the complete configured set — `ready`, `claimed`, `review` where bound, `blocked`, and every env-keyed `done` value — and remove each one that is present, except the terminal role being applied. Type, component, priority, and provenance labels are untouched.

Retiring only the claimed role assumes the item travelled the happy path, and items skip stages: one reaches completion straight from `ready` having never been claimed, another is unblocked and closed still carrying `blocked`. Measured on a live tracker: 34 closed issues carried an active lifecycle role, six of them carrying `ready` and the terminal role at once.

**This is not cosmetic.** A queue scan filters on the synthesized role, not the native closed state, so a closed item still reading `ready` is handed back out — one already-shipped fix was independently rebuilt end to end before a push-time gate caught it.

Three constraints on how it is done:

- **Remove only roles the item actually carries.** Naming an absent label is a 404, which fails a clean closure and makes a repeat run fail where the first one succeeded.
- **Verify by re-reading.** Confirm the final closed state and the unique terminal role from a **fresh read of the item**, never from the write's own response. A write that reports success is not evidence of the state it intended to produce — asserting otherwise is the same defect as the drift being repaired, one layer up.
- **Never re-complete an abandoned item.** Applying a terminal `done` role to an item someone already closed as not-planned rewrites their decision that the work would not be done, and afterwards the two are indistinguishable. Refuse and say so. This does not restrict the duplicate closeout below, which is a flow deliberately closing an open item as not-planned rather than overwriting a closure that already exists.

Trackers with a native lifecycle field (JIRA, Linear) get exclusivity for free: the field that closes the item is the field a queue scan filters on, so the two cannot disagree. GitHub Issues has no lifecycle beyond open/closed, so Lisa synthesizes one in labels and inherits a reconciliation duty the others do not have. That asymmetry is tracked separately in `CodySwannGT/lisa#3479`; this section is the obligation, not the redesign.

Duplicate closeout is a narrow terminal exception: build intake may close a claimed item without a PR only when `ticket-triage` returns `DUPLICATE_ALREADY_FIXED` with a canonical item reference and empirical base-branch proof. Close it through provider duplicate semantics, not as completed build work. `BLOCKED`, ambiguous, duplicate-of-open, and other human-owned dispositions are not auto-closed.

---

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

A parent/container never sets its own lifecycle state; it **derives** it from the roll-up of its children's states. Rollup is evaluated whenever a child transitions — the **forward** arm runs in each `*-build-intake` done step the moment a leaf reaches `done`, walking the leaf's ancestor chain (see Citation → Rollup) — or when intake observes the child set, with `repair-intake` as the **recovery** net for parents left un-rolled. Using the canonical build-lifecycle roles from `config-resolution` (`ready`, `claimed`, `review`, `blocked`, `done`):

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
- **Blocked must name its leaf and its class.** "Blocked" alone is a single bit, and it is lossy in the one dimension that decides what the operator does next. Two holds that render identically are not the same problem: one waits on an external event and may clear with nobody touching it; the other waits on a person rewriting an acceptance criterion and will never clear on its own. Rendered the same, the second class accumulates silently — measured on one Epic at two occurrences, 32 identical hold comments and six weeks, while the initiative was two-thirds complete both times (#3045). See **Classifying a hold** below.
- **"Required" leaves.** Optional or won't-do children do not hold a parent open; only the leaves that must ship for the parent to be complete are counted toward the env-rollup check.
- **Least-advanced env wins.** The parent reflects the env the whole required set has collectively reached — never an env ahead of its laggard leaf. Native closure (below) fires only when the resolved env is the production/terminal value, never at an intermediate env (`On Dev`/`On Stg`).
- **Rollup is recursive.** An Epic rolls up from its Stories, each of which rolls up from its own leaves. Evaluate bottom-up: a Story reaches an env only when its leaves have all reached at least that env; an Epic reaches it only when its Stories have.
- **Vendor support varies.** Apply the rollup state the vendor can express. Where a vendor has no native intermediate state, use the nearest configured role or a metadata/comment signal rather than forcing a non-existent status (PRD #522 non-goal: vendors need not expose identical states).
- **The parent never carries `ready`.** `ready` is a *human* "this is buildable, claim it" signal and only ever lives on leaves. Rollup moves a parent between non-ready container states (in-progress / per-env / blocked / terminal); it never sets the parent to `ready`. A container found carrying `ready` is a leaf-only-invariant violation — recompute its rolled state from its children and apply that (see `repair-intake`).

### Classifying a hold

`rollup-blocker-classification` (`scripts/rollup-blocker-classification.mjs` under the active Lisa plugin root) is the single installed implementation. It takes the child graph the vendor reader already produced and returns, per held leaf, a class and the actor who must clear it:

| Class | Recorded signal on the leaf | Who must act | Clears on its own? |
|---|---|---|---|
| `spec-defect` | the `spec_defect` marker (`config-resolution` → Build markers) | a person rewrites the acceptance criteria | never |
| `human-input` | the `human_needed` marker | a person supplies the input — access, a credential, a product decision | no |
| `hard-blocker` | at least one **open** `is blocked by` link | nobody | yes, when that work closes |
| `unknown` | none of the above | a person says which kind it is, then records it | no |

Four properties are load-bearing:

1. **Recorded signals only.** A class comes from a marker or a link somebody wrote, never from reading the item's prose. There is no heuristic to drift.
2. **It never reclassifies.** Deciding an acceptance criterion is unbuildable is a human product call. The tool makes the distinction *recordable and visible*; it does not make it. `unknown` is the honest answer, and it names the person who must resolve it rather than guessing.
3. **A transparent parent is not the blocker.** A held item whose own children include a held one is reported *through*: the rollup names the leaf at the bottom of the chain and the path to it (`#1495 -> #1515 -> #1547`), which is what turns a five-level descent into one read.
4. **It fails rather than reporting all-clear.** An unreadable tracker, a container with no children, and children none of which could be read each return a refusal, not `not-blocked`. A rollup that examined nothing and reported clean would be the same defect one level up.

The report is **composed per class**: a class with nothing in it produces no text, so the summary and the per-item lines cannot disagree (the `#3101` shape). It also carries a fingerprint of `container + held refs + classes`, so a cycle whose verdict is unchanged has nothing new to post and stays quiet — the 32 identical hold comments were one verdict restated on a schedule.

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
- Duplicate closeout is a narrow terminal exception: build intake may close a claimed item without a PR only when `ticket-triage` returns `DUPLICATE_ALREADY_FIXED` with a canonical item reference and empirical proof that the canonical fix is present on the relevant base branch. That closeout uses the provider's duplicate semantics (`Duplicate` resolution, duplicate/canceled state, or GitHub not-planned close with a duplicate link/comment), not the normal "completed build" reason. `BLOCKED`, ambiguous, duplicate-of-open, and other human-owned dispositions are not auto-closed.
- The native finalization must be idempotent. If the item is already closed / completed / resolved, report that and continue.
- If a provider exposes no native close / archive operation, or a project has not configured the native Done state, record a capability-aware no-op or setup error according to the vendor skill. Do not invent a state name.

## Citation

Skills that enforce this invariant or perform rollup cite this rule by slug (the `leaf-only-lifecycle` rule) instead of restating it:

- **Decomposition / write** (`*-to-tracker`, `*-write-*`) — apply the `ready` role to leaves only; never to containers.
- **Validate** (`*-validate-*`) — FAIL a container carrying the build-ready role; FAIL a childless **Epic** marked build-ready (a childless Story/Spike is a valid leaf and passes).
- **Build intake** (`*-build-intake`, `tracker-build-intake`) — dispatch leaves only; move or safe-block containers with stale build-ready roles according to vendor lifecycle semantics.
- **Rollup** — derive parent state from children per the state machine above. The **forward**
  rollup fires the moment a leaf transitions to `done`: each `*-build-intake` done step (`3d.1`)
  walks the leaf's ancestor chain and invokes `*-sync --rollup`, so a parent advances/closes as
  soon as its last required child ships rather than waiting on a cron. `*-sync --rollup` is the
  single rollup implementation; `repair-intake` calls the same path as the **recovery** net,
  closing out parent/container rollups that were left open after every required child became
  terminal — e.g. children closed outside the Lisa flow (external automation), or completed while
  no forward `*-build-intake` cycle ran.
- **Terminal native closure** (`*-build-intake`, `repair-intake`, terminal helpers) — after a leaf
  or all-terminal rollup parent reaches the true terminal `done` role, finalize it through the
  provider's native close / complete / resolve mechanism where available; never do this for
  intermediate env states.

This is the inverse-direction companion to `repo-scope-split` (which governs a leaf's *repo* scope); together they define what a build-ready leaf work unit is: directly implementable, single-repo, childless-or-leaf-typed.

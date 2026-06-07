# Leaf-Only Build-Ready Invariant (load-bearing)

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

**Blocked dominates.** A parent reaches an env only once all required leaves have reached at least that env. Intermediate-env rollup (`On Dev`/`On Stg`) happens, but native closure fires only at production `done`. Optional/won't-do children do not hold a parent open. Rollup is recursive — bottom-up. The parent never carries `ready`; a container found in `ready` is reconciled by rolling it up from its children.

## Terminal native closure

When a leaf reaches the true terminal `done` (the production / final-env value), also finalize via the tracker's native completion mechanism:

- **GitHub** — `gh issue close <n> --reason completed` after the terminal label.
- **Linear** — move workflow `state` to the team's Done.
- **JIRA** — transition to terminal Done/Resolved/Closed; verify `statusCategory = Done`.

Intermediate env-keyed states (`status:on-dev`, `On Stg`, etc.) remain open. Idempotent — if already closed, report and continue.

Full vendor mechanics + the state machine in prose: [reference/leaf-only-lifecycle.md](../reference/leaf-only-lifecycle.md).

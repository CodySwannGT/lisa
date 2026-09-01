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

Full vendor mechanics + the state machine in prose: [reference/leaf-only-lifecycle.md](../reference/leaf-only-lifecycle.md).

---
name: lisa-task-decomposition
description: "Methodology for breaking work into ordered tasks. Cross-repo source PRDs and coordination containers stay cross-repo; each buildable leaf task gets a single-repo scope, acceptance criteria, verification type, dependencies, and skills required."
---

# Task Decomposition

Break work into ordered, well-scoped tasks that can be independently implemented and verified.

## Decomposition Process

### 1. Identify Units of Work

- Break the work into the smallest units that are independently valuable
- Each unit should produce a verifiable outcome (a passing test, a working endpoint, observable behavior)
- Avoid tasks that are too large to complete in a single session
- Avoid tasks that are too small to be meaningful (e.g., "add an import statement")

### 1.5. Preserve Cross-Repo Containers, Split Leaf Work by Repository

Start from the right shape:

- A source PRD may span multiple repositories.
- Coordination containers may also span multiple repositories.
- Buildable leaf work units must be implementable inside exactly one repository.

That last point is a hard invariant — downstream validators (`jira-validate-ticket`, `github-validate-issue`, `linear-validate-issue`) gate writes on it, so a cross-repo leaf will fail to be created.

Apply this rule by layer:

| Layer | Repo scope |
|-------|------------|
| **PRD / source initiative** | MAY span repos — it describes the full initiative |
| **Epic, Story, Spike** | MAY span repos — these are coordination containers |
| **Task, Bug, Sub-task, Improvement** | MUST name exactly one repo — these are buildable leaf work units |

If a candidate work unit naturally touches multiple repos (e.g., "add field to backend API and consume it in mobile app"), do not write it as one ticket. Instead:

1. Split it into one work unit per repo (e.g., `[backend-api] Add field to /users endpoint`, `[mobile-app] Display new field on profile screen`).
2. Group the per-repo units under a single parent Story (or Epic, if the parent Story already exists). The parent stays cross-repo; the children do not.
3. Encode the order via `Dependencies` in step 4 — typically the producing repo (backend) blocks the consuming repo (frontend/mobile).
4. Tag each work unit with `[repo-name]` as a summary prefix so the repo is visible in tracker lists at a glance.

Reject any work unit whose acceptance criteria reference behavior in a different repo from the one it's scoped to. If you find yourself writing "and the frontend should also...", that's a signal to split.

This is the **decomposition-time** strategy (greenfield — you are creating the tickets now, so a cross-repo PRD can stay whole, its Epic/Story/Spike containers can stay cross-repo, and a parent Story + per-repo children is the natural shape). It is distinct from the **work-time** strategy in the `repo-scope-split` rule, which applies when an agent picks up an *already-existing leaf ticket* to implement and discovers it spans repos: there it narrows the original in place and spins off sibling work units rather than introducing a new parent. Use the phase-appropriate one; do not mix them.

### 2. Define Acceptance Criteria

For each task, define what "done" looks like:

- Be specific and measurable -- avoid vague criteria like "works correctly"
- Include both positive cases (what should work) and negative cases (what should be rejected)
- Reference exact behavior: error messages, status codes, output format, performance thresholds
- If a task modifies existing behavior, state both the before and after

### 3. Assign Verification Type

Each task must have a verification method. Choose the most appropriate:

| Verification Type | When to Use |
|-------------------|-------------|
| **Unit test** | Pure logic, data transformations, utility functions |
| **Integration test** | Cross-module interactions, database operations, API contracts |
| **E2E test** | User-facing workflows, multi-service interactions |
| **Manual verification** | UI/UX behavior, visual correctness, one-time infrastructure changes |
| **Build verification** | Compilation, type checking, linting, bundle size |
| **Deploy verification** | Service health checks, smoke tests, monitoring dashboards |

### 4. Map Dependencies

- Identify which tasks must complete before others can start
- Order tasks so that each builds on a stable foundation
- Prefer independent tasks that can run in parallel where possible
- Flag external dependencies (other teams, services, permissions, data) that may block progress

### 4.5. Classify Any New Material Dependency

Step 4 maps dependencies *between tasks*. This step covers third-party
dependencies a task proposes to **add**.

A dependency is **material** if its failure, disappearance, or bad update would
break something a user can see, or would cost real time to replace. If a work
unit proposes adding one, the work unit must, before it is buildable:

1. **Name its trust class** — exactly one of: mature ecosystem primitive,
   fast-moving standard implementation, build/development tool, runtime-critical
   service client, thin wrapper suitable for in-house ownership, or
   temporary/experimental dependency. See the `dependency-trust-classes` rule
   for what each class means and why it is trusted.
2. **State the class's required evidence** — the detection evidence that class
   demands, and whether product/human ratification is required before the work
   starts. Runtime-critical service clients and expiry extensions on temporary
   dependencies always require ratification; a work unit that needs it and does
   not say so is not ready.
3. **Include updating `.lisa/DEPENDENCY_DECISIONS.md`** in its acceptance
   criteria, so the record entry lands in the same change as the dependency.

If nobody can pick a class, that is the finding — resolve it before accepting
the work unit, not after the package is installed.

### 4.6. Inherit the Confidence-Rebuild Kit When Ownership Moves In-House

Step 4.5 covers dependencies a task proposes to **add**. This step covers
dependencies a task proposes to **remove, replace, or internalize** — vendor,
fork-and-maintain, or reimplement ourselves.

When ownership moves in-house, the risk stops being "do we trust upstream" and
becomes "did we prove we rebuilt the capability." A work unit that moves a
material dependency in-house **inherits all seven acceptance criteria** of the
`dependency-internalization-kit` rule, each written as an acceptance criterion
of the work unit:

1. **Real corpus** — did we test it on real inputs, not toy examples?
2. **Conformance fixtures** — does the new code do what the dependency did?
3. **Negative fixtures** — does it still reject what it should reject?
4. **Coverage as a gap detector** — what behavior is still untested?
5. **Provenance and license review** — where did this code come from, and are we
   allowed to use it?
6. **Migration and update plan** — how do existing call sites move, and how does
   the new code stay current?
7. **Rollback or replacement criteria** — what would make us go back, and to
   what?

The only way out is an **explicit non-material justification** written into the
work unit — one reviewable sentence saying why this dependency's failure or
disappearance breaks nothing a user can see and costs no real time to replace.
Silence is not a justification.

**Do not over-apply the kit.** A routine version bump of a trusted dependency
**within its existing trust class** does not move ownership, so it does not
inherit the kit — its bar is that trust class's own detection evidence and
cadence. The same is true of swapping one third-party dependency for another,
which moves trust to a different upstream rather than in-house. Add the kit only
when ownership moves in-house; the exception is a bump taken *as* a fork or
declined *in favor of* owning the code, which is an internalization regardless of
how the ticket is titled.

### 5. Determine Execution Order

- Place foundational tasks first (types, schemas, interfaces, shared utilities)
- Follow with implementation tasks (business logic, handlers, services)
- Then integration tasks (wiring, configuration, API routes)
- Finish with verification tasks (test suites, documentation, cleanup)

### 6. Assign Required Skills

Map each task to the skills needed to complete it. This enables delegation to specialized agents or helps identify what expertise is required.

## Output Format

```
## Task Breakdown

### Task 1: [[repo-name] imperative description]
- **Repository:** [single repo name, or N/A for Epic/Story/Spike]
- **Acceptance criteria:**
  - [specific, measurable criterion]
  - [specific, measurable criterion]
- **Verification:** [type] -- [how to verify]
- **Dependencies:** [none | task IDs that must complete first]
- **Skills:** [list of skills needed]

### Task 2: [[repo-name] imperative description]
- **Repository:** [single repo name, or N/A for Epic/Story/Spike]
- **Acceptance criteria:**
  - [specific, measurable criterion]
- **Verification:** [type] -- [how to verify]
- **Dependencies:** [Task 1]
- **Skills:** [list of skills needed]

### Execution Order
1. [Task 1, Task 3] (parallel -- no dependencies)
2. [Task 2] (depends on Task 1)
3. [Task 4] (depends on Task 2, Task 3)

### External Dependencies
- [dependency] -- [who owns it] -- [current status]
```

## Rules

- Every task must have at least one acceptance criterion that can be empirically verified
- Do not create tasks that cannot be verified -- if you cannot define how to prove it is done, the task is not well-scoped
- Every Task / Bug / Sub-task / Improvement is scoped to exactly one repo -- if the work spans repos, split into per-repo work units under a shared parent Story (see step 1.5)
- Any task proposing a new material dependency names its trust class, states that class's required evidence and whether human ratification is needed, and updates `.lisa/DEPENDENCY_DECISIONS.md` in the same change (see step 4.5) -- a proposed material dependency with no named class is not ready to build
- Any task removing, replacing, or internalizing a material dependency carries all seven confidence-rebuild kit criteria -- corpus, conformance, negative fixtures, coverage-as-gap-detector, provenance/license, migration/update plan, and rollback criteria (see step 4.6) -- unless it explicitly justifies why the dependency is non-material; a within-trust-class version bump does not carry the kit
- Keep tasks ordered so that no task references work that has not been completed by a prior task
- Flag any task that requires access, permissions, or external input not yet available
- Prefer more small tasks over fewer large tasks -- smaller tasks are easier to verify and less risky to fail
- Do not create placeholder or "TODO" tasks -- every task should describe concrete work

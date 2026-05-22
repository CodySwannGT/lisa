---
name: task-decomposition
description: "Methodology for breaking work into ordered tasks. Each task gets a single-repo scope, acceptance criteria, verification type, dependencies, and skills required."
---

# Task Decomposition

Break work into ordered, well-scoped tasks that can be independently implemented and verified.

## Decomposition Process

### 1. Identify Units of Work

- Break the work into the smallest units that are independently valuable
- Each unit should produce a verifiable outcome (a passing test, a working endpoint, observable behavior)
- Avoid tasks that are too large to complete in a single session
- Avoid tasks that are too small to be meaningful (e.g., "add an import statement")

### 1.5. Scope Each Unit to a Single Repository

Work units must be implementable inside a single repository. This is a hard invariant — downstream validators (`jira-validate-ticket`, `github-validate-issue`, `linear-validate-issue`) gate writes on it, so a cross-repo task will fail to be created.

Apply this rule by issue type:

| Issue type | Repo scope |
|------------|-----------|
| **Epic, Story, Spike** | MAY span repos — these are coordination containers |
| **Task, Bug, Sub-task, Improvement** | MUST name exactly one repo — these are work units |

If a candidate work unit naturally touches multiple repos (e.g., "add field to backend API and consume it in mobile app"), do not write it as one ticket. Instead:

1. Split it into one work unit per repo (e.g., `[backend-api] Add field to /users endpoint`, `[mobile-app] Display new field on profile screen`).
2. Group the per-repo units under a single parent Story (or Epic, if the parent Story already exists). The parent stays cross-repo; the children do not.
3. Encode the order via `Dependencies` in step 4 — typically the producing repo (backend) blocks the consuming repo (frontend/mobile).
4. Tag each work unit with `[repo-name]` as a summary prefix so the repo is visible in tracker lists at a glance.

Reject any work unit whose acceptance criteria reference behavior in a different repo from the one it's scoped to. If you find yourself writing "and the frontend should also...", that's a signal to split.

This is the **decomposition-time** strategy (greenfield — you are creating the tickets now, so a parent Story + per-repo children is the natural shape). It is distinct from the **work-time** strategy in the `repo-scope-split` rule, which applies when an agent picks up an *already-existing* ticket to implement and discovers it spans repos: there it narrows the original in place and spins off sibling work units rather than introducing a new parent. Use the phase-appropriate one; do not mix them.

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
- Keep tasks ordered so that no task references work that has not been completed by a prior task
- Flag any task that requires access, permissions, or external input not yet available
- Prefer more small tasks over fewer large tasks -- smaller tasks are easier to verify and less risky to fail
- Do not create placeholder or "TODO" tasks -- every task should describe concrete work

---
name: task-decomposition
description: "Methodology for breaking work into ordered tasks. Each task gets acceptance criteria, verification type, dependencies, and skills required."
---

# Task Decomposition

Break work into ordered, well-scoped tasks that can be independently implemented and verified.

## Decomposition Process

### 1. Identify Units of Work

- Break the work into the smallest units that are independently valuable
- Each unit should produce a verifiable outcome (a passing test, a working endpoint, observable behavior)
- Avoid tasks that are too large to complete in a single session
- Avoid tasks that are too small to be meaningful (e.g., "add an import statement")

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

```text
## Task Breakdown

### Task 1: [imperative description]
- **Acceptance criteria:**
  - [specific, measurable criterion]
  - [specific, measurable criterion]
- **Verification:** [type] -- [how to verify]
- **Dependencies:** [none | task IDs that must complete first]
- **Skills:** [list of skills needed]

### Task 2: [imperative description]
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
- Keep tasks ordered so that no task references work that has not been completed by a prior task
- Flag any task that requires access, permissions, or external input not yet available
- Prefer more small tasks over fewer large tasks -- smaller tasks are easier to verify and less risky to fail
- Do not create placeholder or "TODO" tasks -- every task should describe concrete work

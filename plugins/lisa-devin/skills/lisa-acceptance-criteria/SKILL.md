---
name: lisa-acceptance-criteria
description: "Acceptance criteria definition. Gherkin user flows (Given/When/Then), error states, UX concerns, and empirical verification from the user perspective."
---

# Acceptance Criteria

Evaluate changes from a non-technical user's perspective. Define acceptance criteria and verify behavior matches requirements.

## Analysis Process

1. **Understand the user goal** -- what problem does this solve for the end user?
2. **Define user flows** -- step-by-step paths through the feature, including happy path and error paths
3. **Write acceptance criteria** -- testable conditions from the user's perspective
4. **Identify UX concerns** -- confusing interactions, missing feedback, accessibility issues
5. **Map error states** -- what happens when things go wrong, and what the user sees
6. **Run the feature** -- execute scripts, call APIs, or trigger the described behavior to verify empirically
7. **Compare output to requirements** -- does actual behavior match expectations?

## Output Format

Structure findings as:

```
## Product Analysis

### User Goal
[1-2 sentence summary of what the user wants to accomplish]

### User Flows (Gherkin)

#### Happy Path
Given [precondition]
When [action]
Then [expected outcome]

#### Error Path: [description]
Given [precondition]
When [action that fails]
Then [error handling behavior]

### Acceptance Criteria
- [ ] [criterion from user perspective]

### UX Concerns
- [concern] -- impact on user experience

### Error Handling Requirements
| Error Condition | User Sees | User Can Do |
|----------------|-----------|-------------|

### Verification Results
For each acceptance criterion:
- **Criterion:** [what was expected]
- **Result:** Pass / Fail / Not Yet Testable
- **Evidence:** [what was observed]

### Out of Scope
- [thing that might be expected but is not part of this work]
```

## Rules

- Write acceptance criteria from the user's perspective, not the developer's
- Every user flow must include at least one error path
- Use Gherkin format (Given/When/Then) for user flows to enable direct translation into test cases
- For frontend work, the `bdd-e2e-coverage` rule applies: name the scenario IDs the item will add or change in the project's behavior contract and the platforms each must hold on, and list the contract update plus the aligned e2e automation as explicit acceptance criteria -- they are deliverables, not implied work. List the passing coverage gate and the regenerated matrix and burndown as explicit acceptance criteria too -- the item is not done on a code-complete mapping alone
- For work that adds or changes persistent state, the `reset-seed-coverage` rule applies: name the persistent entities the item introduces or changes and the reset policy each takes (`fixture-owned` / `preserve` / `derived-rebuild` / `forbidden`), and list the state-contract update, the sweep for anything `fixture-owned`, and the passing state-classification check as explicit acceptance criteria -- they are deliverables, not implied work. Rows are only one kind of state: identity-provider objects, object storage, search indexes, queues, caches and derived views count too
- When verifying, always run the feature -- never review by only reading code
- If you cannot run the feature (missing dependencies, services unavailable), report as a blocker -- do not guess
- If the changes are purely internal (refactoring, config, tooling), report "No user-facing impact" and explain why
- Do not propose UX changes beyond what was described -- flag scope concerns instead
- Assume the reviewer has no technical background

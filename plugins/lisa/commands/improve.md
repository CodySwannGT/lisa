---
description: "Improve existing code. Measures baseline, implements improvements via TDD, measures again, and reviews."
argument-hint: "<target-description>"
---

Apply the `intent-routing` rule (loaded via the lisa plugin) and execute the **Implement** flow with the **Improve** work type.

**Orchestration: agent team.** Improve runs a multi-specialist sequence with parallel review. After echoing the flow and orchestration mode, your FIRST tool call MUST be `TeamCreate`. Do not call `TaskCreate`, `Agent`, or implementation tools before the team exists.

For specific improvement types, you can also use:
- `/lisa:plan:add-test-coverage` -- increase test coverage
- `/lisa:plan:fix-linter-error` -- fix lint rule violations
- `/lisa:plan:lower-code-complexity` -- reduce cognitive complexity
- `/lisa:plan:reduce-max-lines` -- reduce file length
- `/lisa:plan:reduce-max-lines-per-function` -- reduce function length
- `/lisa:plan:improve-tests` -- improve test quality

$ARGUMENTS

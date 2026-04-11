---
name: tdd-implementation
description: "Test-Driven Development implementation workflow. RED: write failing test, GREEN: minimum code to pass, REFACTOR: clean up. Includes task metadata requirements, verification, and atomic commit practices."
---

# TDD Implementation

Implement code changes using the Test-Driven Development (RED/GREEN/REFACTOR) cycle. This skill defines the complete workflow from task metadata validation through atomic commit.

## Task Metadata

Each task you work on must have the following in its metadata:

```json
{
  "plan": "<plan-name>",
  "type": "spike|bug|task|epic|story",
  "acceptance_criteria": ["..."],
  "relevant_documentation": "",
  "testing_requirements": ["..."],
  "skills": ["..."],
  "learnings": ["..."],
  "verification": {
    "type": "ui-recording|api-test|cli-test|database-check|manual-check|documentation",
    "command": "the proof command — must run the actual system (NOT test/typecheck/lint, those are quality gates)",
    "expected": "what success looks like — observable system behavior"
  }
}
```

All fields are mandatory — empty arrays are ok. If any are missing, ask the agent team to fill them in and wait to get a response.

## Workflow

1. **Verify task metadata** — All fields are mandatory. If any are missing, ask the agent team to fill them in and wait to get a response.
2. **Load skills** — Load the skills in the `skills` property of the task metadata.
3. **Read before writing** — Read existing code before modifying it. Understand acceptance criteria, verification, and relevant research.
4. **Follow existing patterns** — Match the style, naming, and structure of surrounding code.
5. **One task at a time** — Complete the current task before moving on.
6. **RED** — Write a failing test that captures the expected behavior from the task description. Focus on testing behavior, not implementation details.
7. **GREEN** — Write the minimum production code to make the test pass.
8. **REFACTOR** — Clean up while keeping tests green.
9. **Verify empirically** — Run the task's proof command and confirm expected output.
10. **Update documentation** — Add/Remove/Modify all relevant JSDoc preambles, explaining "why", not "what".
11. **Update the learnings** — Add what you learned during implementation to the `learnings` array in the task's `metadata.learnings`. These should be things that are relevant for other implementers to know.
12. **Commit atomically** — Once verified, run the `/git-commit` skill.

## TDD Cycle

**Always write failing tests before implementation code.** This is mandatory, not optional.

```text
TDD Cycle:
1. RED: Write a failing test that defines expected behavior
2. GREEN: Write the minimum code to make the test pass
3. REFACTOR: Clean up while keeping tests green
```

### RED Phase

- Write a test that captures the expected behavior from the task description
- Focus on testing behavior, not implementation details
- The test must fail before you write any production code
- If the imported module doesn't exist, Jest reports 0 tests found (not N failed) — this is expected RED behavior

### GREEN Phase

- Write the minimum production code to make the test pass
- Do not optimize, do not add features beyond what the test requires
- The goal is the simplest code that makes the test green

### REFACTOR Phase

- Clean up code while keeping all tests green
- Remove duplication, improve naming, simplify structure
- Run tests after every refactor step to confirm nothing breaks

## When Stuck

- Re-read the task description and acceptance criteria
- Check relevant research for reusable code references
- Search the codebase for similar implementations
- Ask the team lead if the task is ambiguous — do not guess

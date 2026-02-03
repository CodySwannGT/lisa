# Plan Mode Rules

These rules are enforced whenever Claude is in plan mode. They are loaded at session start via `.claude/rules/` and reinforced on every prompt via the `enforce-plan-rules.sh` `UserPromptSubmit` hook.

## Required Behaviors

When making a plan:

- Always determine which skills should be used during execution of the plan and include them in the plan
- Always make sure you understand the correct versions of third party libraries
- Always save the plan with a name befitting the actual plan contents
- Always look for code that can be reused for implementation
- The plan MUST include written instructions to create a task list using TaskCreate for each task (following the Task Creation Specification below). The list should contain items related to the plan and specify that subagents should handle as many in parallel as possible. The following should always be included in the task list
  - update/add/remove tests, containing the tests that need to get updated, added or removed
  - update/add/remove documentation (jsdocs, markdown files, etc), containing the documentation that need to get updated, added or removed
  - archive the plan (to be completed after all other tasks have been completed). This task should explcitly say to:
    - create a folder named <plan-name> in ./plans/completed
    - rename this plan to a name befitting the actual plan contents
    - move it into ./plans/completed/<plan-name>
    - read the session ids from ./plans/completed/<plan-name>
    - For each session id, move the ~/.claude/tasks/<session-id> directory to ./plans/completed/<plan-name>/tasks
- If you're on a protected branch (dev, staging, main), create a new branch named based on the nature of the project and include in the plan pull requests should go to the protected branch you bracnehd from. 
- If you're on a non-protected branch with an open pull request, submit pushes to the open pull request
- If you're on a non-protected branch with no existing PR, clarify which protected branch to open the pull request to. 
- If referencing a ticket (jira, linear, etc), always include the ticket url in your plan
- If referencing a ticket (jira, linear, etc), always update the ticket with the branch you're working off of
- If referencing a ticket (jira, linear, etc), always add a comment to the ticket with the finalized plan
- The `## Sessions` section in plan files is auto-maintained by the `track-plan-sessions.sh` hook — do not manually edit it

## Task Creation Specification

When plans include TaskCreate instructions, each task must use this format:

### Parameters

- **subject**: Imperative form (e.g., "Add logout button to header")
- **activeForm**: Present continuous form (e.g., "Adding logout button to header")

### Description Template

Every task description must be a markdown document with these sections:

**Type:** Bug | Task | Epic | Story

**Description:** Clear description based on type (Bug: symptoms/root cause; Story: Gherkin Given/When/Then; Task: clear goal; Epic: goal with sub-tasks)

**Acceptance Criteria:** Checkbox list of completion criteria

**Relevant Research:** Code references, patterns, architecture constraints extracted from research

**Skills to Invoke:** `/coding-philosophy` is always required, plus other applicable skills

**Implementation Details:** Files to modify, functions to implement, edge cases

**Testing Requirements:** Unit tests (with `describe/it` structure), Integration tests, E2E tests (or "N/A")

**Verification:** Every task MUST have empirical verification (see `verfication.md` for types). Include: verification type, proof command, and expected output.

**Learnings:** On task completion, use `TaskUpdate` to save discoveries: `metadata: { learnings: ["Learning 1", ...] }`

### Metadata

```json
{
  "plan": "<plan-name>",
  "type": "bug|task|epic|story",
  "skills": ["/coding-philosophy", ...],
  "verification": {
    "type": "test|ui-recording|test-coverage|api-test|manual-check|documentation",
    "command": "the proof command",
    "expected": "what success looks like"
  }
}
```

### Task Sizing

Each task must be small enough to have a **single, specific verification**. Ask: "Can I prove this is done with ONE command?" Split tasks that require multiple verifications.


# Plan Document Format

For governance rules (required tasks, branch/PR rules, git workflow), see `plan-governance.md`.

## Task Creation Specification

### Parameters

- **subject**: Imperative form (e.g., "Add logout button to header")
- **activeForm**: Present continuous form (e.g., "Adding logout button to header")

### Description Template

Every task description must be a markdown document with these sections:

**Type:** Bug | Task | Epic | Story

**Description:** Clear description based on type:
- Bug: symptoms and root cause
- Story: Gherkin Given/When/Then
- Task: clear goal
- Epic: goal with sub-tasks

### Type-Specific Requirements

#### Bug
- **Replication step** (mandatory): Reproduce the bug empirically before any fix
- **Root cause analysis**: Identify why the bug occurs
- **Regression test**: Write a test that fails without the fix and passes with it
- **Verification**: Run the replication step again to confirm the fix

#### Story/Feature
- **UX review**: Product-reviewer agent validates from user perspective
- **Feature flag consideration**: Should this be behind a flag?
- **Documentation**: User-facing docs if applicable

#### Task
- **Standard implementation** with empirical verification

#### Epic
- **Decompose into sub-tasks** (Stories/Tasks/Bugs)
- **Each sub-task gets its own type-specific requirements**

### Additional Description Sections

**Acceptance Criteria:** Checkbox list of completion criteria

**Relevant Research:** Code references, patterns, architecture constraints

**Skills to Invoke:** List applicable skills (coding-philosophy is auto-loaded as a rule)

**Implementation Details:** Files to modify, functions to implement, edge cases

**Testing Requirements:** Unit tests (with `describe/it` structure), integration tests, E2E tests (or "N/A")

**Verification:** Every task MUST have empirical verification (see `verfication.md` for types). Include: verification type, proof command, and expected output.

**Learnings:** On completion, use `TaskUpdate` to save discoveries: `metadata: { learnings: ["Learning 1", ...] }`

### Metadata

Every task MUST include this JSON metadata block. Do NOT omit `skills` (use `[]` if none) or `verification`.

```json
{
  "plan": "<plan-name>",
  "type": "bug|task|epic|story",
  "skills": ["..."],
  "verification": {
    "type": "test|ui-recording|test-coverage|api-test|manual-check|documentation",
    "command": "the proof command",
    "expected": "what success looks like"
  }
}
```

### Task Sizing

Each task must be small enough to have a **single, specific verification**. Ask: "Can I prove this is done with ONE command?" Split tasks that require multiple verifications.

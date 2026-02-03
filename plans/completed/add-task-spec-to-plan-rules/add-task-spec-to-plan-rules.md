# Add Task Creation Specification to Plan Mode Rules

## Summary

Update `.claude/rules/plan.md` to include the full task creation specification so that during plan mode, Claude has complete guidance for writing TaskCreate instructions in plan files. Plan-flow tasks use `metadata.plan` (not `metadata.project`). The existing project flow is untouched.

## Branch

Create: `feat/add-task-spec-to-plan-rules` from `main`
PR targets: `main`

## Background

The full task creation spec currently lives only in `.claude/skills/project-plan/SKILL.md` (lines 68-179). It only takes effect when the `/project-plan` skill is invoked. During plan mode, `.claude/rules/plan.md` is reinforced on every prompt via the `enforce-plan-rules.sh` hook, but it only says "create a task list using TaskCreate" without specifying the format. This means plans written in plan mode lack guidance on subject format, description template, metadata structure, and verification requirements.

## Files to Modify

| File | Change |
|------|--------|
| `.claude/rules/plan.md` | Add Task Creation Specification section |
| `all/copy-overwrite/.claude/rules/plan.md` | Mirror same change (Lisa template) |

## Implementation

### 1. Update the existing TaskCreate bullet point (line 13)

Change:
```
- The plan MUST including written instructions to create a task list using TaskCreate for each task.
```
To:
```
- The plan MUST include written instructions to create a task list using TaskCreate for each task (following the Task Creation Specification below).
```

### 2. Add new section after "## Required Behaviors"

Insert a new `## Task Creation Specification` section between the end of Required Behaviors (line 28) and the end of the file. Content:

```markdown
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

```

### 3. Mirror to template

Apply the identical change to `all/copy-overwrite/.claude/rules/plan.md`.

## Verification

```bash
# Both files contain the new section
grep -c "Task Creation Specification" .claude/rules/plan.md
# Expected: 1

grep -c "Task Creation Specification" all/copy-overwrite/.claude/rules/plan.md
# Expected: 1

# Plan-flow uses metadata.plan (not metadata.project)
grep '"plan"' .claude/rules/plan.md
# Expected: found

# Files are identical
diff .claude/rules/plan.md all/copy-overwrite/.claude/rules/plan.md
# Expected: no output

# Lint passes
bun run lint

# Tests pass
bun run test
```

## Skills to Use During Execution

- `/git-commit` — commit changes
- `/git-submit-pr` — create PR to main

## Task List

Create tasks using TaskCreate:

1. **Update `.claude/rules/plan.md`** — Add the Task Creation Specification section and update the existing TaskCreate bullet point reference. Apply identical change to `all/copy-overwrite/.claude/rules/plan.md`.
2. **Verify changes** — Run the verification commands above. Confirm both files are identical with `diff`. Run `bun run lint` and `bun run test`.
3. **Update documentation** — Update JSDoc/preamble if applicable. Check if `HUMAN.md` or `docs/task-management-system.md` reference the plan.md task creation spec and update if so.
4. **Archive the plan** — After all tasks complete:
   - Create folder `add-task-spec-to-plan-rules` in `./plans/completed`
   - Rename this plan to a name befitting the actual plan contents
   - Move it into `./plans/completed/add-task-spec-to-plan-rules`
   - Read the session IDs from the plan file
   - For each session ID, move `~/.claude/tasks/<session-id>` to `./plans/completed/add-task-spec-to-plan-rules/tasks`

Tasks 1-3 can run in parallel via subagents. Task 4 runs last (blocked by all others).

## Sessions
| 1b2bc847-4ff3-4b8d-a50a-6303bb80c4c0 | 2026-02-03T13:03:31Z | plan |

# Plan Mode Rules

These rules are enforced whenever Claude is in plan mode. Loaded at session start via `.claude/rules/` and reinforced on every prompt via the `enforce-plan-rules.sh` `UserPromptSubmit` hook.

## Required Behaviors

When making a plan:

- Determine which skills are needed and include them in the plan
- Verify correct versions of third-party libraries
- Look for reusable code
- If a decision is left unresolved by the human, use the recommended option
- The plan MUST include TaskCreate instructions for each task (following the Task Creation Specification below). Specify that subagents should handle as many tasks in parallel as possible.

### Required Tasks

The following tasks are always required unless the plan includes only trivial changes:

- Product/UX review using `product-reviewer` agent (validate feature works from a non-technical perspective)
- CodeRabbit code review
- Local code review via `/plan:local-code-review`
- Technical review using `tech-reviewer` agent (beginner-friendly; correctness, security, performance)
- Implement valid review suggestions (run after all reviews complete)
- Simplify code using code simplifier agent (run after review implementation)
- Update/add/remove tests as needed (run after review implementation)
- Update/add/remove documentation -- JSDoc, markdown files, etc. (run after review implementation)
- Verify all verification metadata in existing tasks (run after review implementation)
- Collect learnings using `learner` agent (run after all reviews and simplification)

The following task is always required regardless of plan size:

- Archive the plan (run after all other tasks). This task must explicitly say to:
  - Create a folder named `<plan-name>` in `./plans/completed`
  - Rename the plan to reflect its actual contents
  - Move it into `./plans/completed/<plan-name>`
  - Read session IDs from `./plans/completed/<plan-name>`
  - Move each `~/.claude/tasks/<session-id>` directory to `./plans/completed/<plan-name>/tasks`
  - Update any "in_progress" task to "completed"
  - Commit and push changes to the PR

### Branch and PR Rules

- On a protected branch (dev, staging, main): create a new branch and target the PR to the protected branch you branched from
- On a non-protected branch with an open PR: push to the existing PR
- On a non-protected branch with no PR: clarify which protected branch to target
- Open a draft pull request
- Include the branch name and PR link in the plan

### Ticket Integration

When referencing a ticket (JIRA, Linear, etc.):

- Include the ticket URL in the plan
- Update the ticket with the working branch
- Add a comment on the ticket with the finalized plan

NOTE: Do NOT include a separate task for linting, type-checking, or formatting. These are handled automatically by PostToolUse hooks (lint-on-edit.sh, format-on-edit.sh) and lint-staged pre-commit hooks (ESLint, Prettier, ast-grep).

IMPORTANT: The `## Sessions` section in plan files is auto-maintained by `track-plan-sessions.sh` -- do not manually edit it.

## Git Workflow

Every plan follows this workflow to keep PRs clean:

1. **First task:** Verify/create branch and open a draft PR (`gh pr create --draft`). No implementation before the draft PR exists.
2. **During implementation:** Commits only, no pushes. Pre-commit hooks validate lint, format, and typecheck.
3. **After archive task:** One final `git push`, then mark PR ready (`gh pr ready`), then enable auto-merge (`gh pr merge --auto --merge`).

## Implementation Team Guidance

When plans spawn an Agent Team for implementation, recommend these specialized agents:

| Agent | Use For | Why |
|-------|---------|-----|
| `implementer` | Code implementation | Pre-loaded with project conventions, empirical verification |
| `tech-reviewer` | Technical review | Beginner-friendly findings; covers correctness, security, performance |
| `product-reviewer` | Product/UX review | Validates from non-technical perspective; runs feature empirically |
| `learner` | Post-implementation learning | Processes task learnings through `skill-evaluator` to create skills, add rules, or discard |
| `test-coverage-agent` | Writing tests | Specialized for comprehensive, meaningful test coverage |
| `code-simplifier` (plugin) | Code simplification | Simplifies and refines for clarity and maintainability |
| `coderabbit` (plugin) | CodeRabbit review | Automated AI code review |

The **team lead** handles git operations (commits, pushes, PR management) -- teammates focus on their specialized work.

## Task Creation Specification

### Parameters

- **subject**: Imperative form (e.g., "Add logout button to header")
- **activeForm**: Present continuous form (e.g., "Adding logout button to header")

### Description Template

Every task description must be a markdown document with these sections:

**Type:** Bug | Task | Epic | Story

**Description:** Clear description based on type (Bug: symptoms/root cause; Story: Gherkin Given/When/Then; Task: clear goal; Epic: goal with sub-tasks)

### Type-Specific Requirements

When the plan type is determined, apply the corresponding requirements:

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

**Acceptance Criteria:** Checkbox list of completion criteria

**Relevant Research:** Code references, patterns, architecture constraints

**Skills to Invoke:** List applicable skills (coding-philosophy is auto-loaded as a rule)

**Implementation Details:** Files to modify, functions to implement, edge cases

**Testing Requirements:** Unit tests (with `describe/it` structure), integration tests, E2E tests (or "N/A")

**Verification:** Every task MUST have empirical verification (see `verfication.md` for types). Include: verification type, proof command, and expected output.

**Learnings:** On completion, use `TaskUpdate` to save discoveries: `metadata: { learnings: ["Learning 1", ...] }`

### Metadata

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

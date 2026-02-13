---
name: plan-implement
description: "Implements an existing plan file by reading its tasks and executing them. Spawns an Agent Team with specialized agents for parallel implementation."
---

# Implement Plan

Implement the requirements in $ARGUMENTS.

If no argument provided, search for plan files in the `plans/` directory and present them to the user for selection.

Critical: you must create an agent team to implement the plan. Do not try to skip this!

## Step 1: Parse Plan

1. **Read the plan file** specified in `$ARGUMENTS`
2. **Extract all tasks** with their dependencies, descriptions, verification requirements, and metadata
3. **Parse task metadata** -- extract the JSON metadata code fence from each task (see @.claude/rules/plan.md Metadata section for the required schema)
4. **Build a dependency graph** to determine which tasks can run in parallel

## Task Metadata Rules

Each task in the plan file contains a JSON metadata code fence (schema defined in @.claude/rules/plan.md Metadata section).

- Every TaskCreate call MUST include the full `metadata` object from the plan's JSON code fence
- If a task is missing `skills` or `verification`, flag it as an error and ask the user before proceeding
- Run `verification.command` before marking any task complete

## Step 2: Setup

1. Read `@.claude/rules/plan-governance.md` for governance rules (branch/PR, git workflow, required tasks)
2. Read `@.claude/rules/plan.md` for task document format
3. **Verify branch exists** -- create if needed following branch/PR rules from plan-governance.md
4. **Verify draft PR exists** -- create with `gh pr create --draft` if needed. No implementation before the draft PR exists
5. **Determine implementer count** based on the task dependency graph:
   - 1-2 independent tasks → 1 implementer
   - 3-5 independent tasks → 2 implementers
   - 6+ independent tasks → 3 implementers (cap)

## Step 3: Create Agent Team

Spawn an Agent Team with:

- **Implementers** (named `implementer-1`, `implementer-2`, etc.) -- agent type: `implementer`, mode: `bypassPermissions`
- Create all tasks via TaskCreate with proper `blockedBy` relationships matching the plan's dependency graph
- Assign the first batch of independent tasks to implementers

Use the specialized agents per `@.claude/rules/plan-governance.md` (Implementation Team Guidance):

| Agent | Use For | Phase |
|-------|---------|-------|
| `implementer` | Code implementation with TDD (red-green-refactor) | Phase 2 |
| `quality-specialist` | Technical review (correctness, security, performance) | Phase 3 |
| `product-specialist` | Product/UX review (validates from non-technical perspective) | Phase 3 |
| `test-specialist` | Writing comprehensive tests | Phase 4 |
| `code-simplifier` | Code simplification and refinement | Phase 4 |
| `coderabbit` | Automated AI code review | Phase 3 |
| `learner` | Post-implementation learning | Phase 5 |

The **team lead** handles git operations (commits, pushes, PR management) -- teammates focus on their specialized work.

## Compaction Resilience

Context compaction can cause the team lead to lose in-memory state (task assignments, owner fields). Follow these rules:

1. **Dual owner storage** -- on every TaskUpdate that sets `owner`, also store it in `metadata.owner`:
   ```
   TaskUpdate({ taskId: "1", owner: "implementer-1", metadata: { owner: "implementer-1" } })
   ```
2. **Re-read after compaction** -- immediately call TaskList to reload all task state
3. **Restore missing owners** -- if any task has `metadata.owner` but no `owner` field, restore it via TaskUpdate
4. **Never rely on memory** -- always call TaskList before assigning new work

## Step 4: Phase 2 - Implementation

1. Implementers work on assigned tasks following TDD (red-green-refactor cycle)
2. Team lead monitors completion via messages from implementers
3. After each task completes: team lead runs `git add <specific files>` + `git commit` with conventional commit message
4. Team lead assigns next tasks as dependencies resolve
5. Continue until all implementation tasks are complete

## Step 5: Phase 3 - Reviews (parallel)

Spawn review agents simultaneously:

- **quality-specialist** -- agent type: `quality-specialist`, mode: `bypassPermissions`
- **product-specialist** -- agent type: `product-specialist`, mode: `bypassPermissions`
- Invoke `/plan-local-code-review` skill (team lead runs directly)
- **coderabbit** -- agent type: `coderabbit:code-reviewer`, mode: `bypassPermissions`

Wait for all reviews to complete.

## Step 6: Phase 4 - Post-Review (sequential)

1. **Fix review findings** -- re-spawn an implementer to address valid review suggestions
2. **Simplify code** -- spawn `code-simplifier` agent (agent type: `code-simplifier:code-simplifier`, mode: `bypassPermissions`)
3. **Update tests** -- spawn `test-specialist` to update tests for post-review changes
4. **Verify all tasks** -- team lead runs ALL proof commands from all tasks to confirm everything still works

## Step 7: Phase 5 - Learning & Archive

1. **Collect learnings** -- spawn `learner` agent (agent type: `learner`, mode: `bypassPermissions`) to process task learnings
2. **Archive the plan** -- follow the Archive Procedure in @.claude/rules/plan-governance.md
3. **Finalize PR**:
   ```bash
   git add . && git commit -m "chore: archive <plan-name> plan"
   GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=5" git push
   gh pr ready
   gh pr merge --auto --merge
   ```

## Step 8: Shutdown Team

Send `shutdown_request` to all teammates and clean up the team.

---
name: plan-implement
description: "Implements an existing plan file by reading its tasks and executing them. Spawns an Agent Team with specialized agents for parallel implementation."
---

# Implement Plan

Create an agent team to implement the requirements in $ARGUMENTS.

If no argument provided, search for plan files in the `plans/` directory and present them to the user for selection.

## Step 1: Parse Plan

1. **Read the selected plan file**
2. **Extract all tasks** with their dependencies, descriptions, verification requirements, and metadata
3. **Build a dependency graph** to determine which tasks can run in parallel

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

Create an agent team with:

- **Implementers** (named `implementer-1`, `implementer-2`, etc.) -- agent type: `implementer`, mode: `bypassPermissions`
- Create all tasks via TaskCreate with proper `blockedBy` relationships matching the plan's dependency graph
- Assign the first batch of independent tasks to implementers

Recommend these additional specialized agents per `@.claude/rules/plan-governance.md` (Implementation Team Guidance):

| Agent | Use For | Phase |
|-------|---------|-------|
| `implementer` | Code implementation with TDD (red-green-refactor) | Phase 2 |
| `tech-reviewer` | Technical review (correctness, security, performance) | Phase 3 |
| `product-reviewer` | Product/UX review (validates from non-technical perspective) | Phase 3 |
| `test-coverage-agent` | Writing comprehensive tests | Phase 4 |
| `code-simplifier` | Code simplification and refinement | Phase 4 |
| `coderabbit` | Automated AI code review | Phase 3 |
| `learner` | Post-implementation learning | Phase 5 |

The **team lead** handles git operations (commits, pushes, PR management) -- teammates focus on their specialized work.

## Step 4: Phase 2 - Implementation

1. Implementers work on assigned tasks following TDD (red-green-refactor cycle)
2. Team lead monitors completion via messages from implementers
3. After each task completes: team lead runs `git add <specific files>` + `git commit` with conventional commit message
4. Team lead assigns next tasks as dependencies resolve
5. Continue until all implementation tasks are complete

## Step 5: Phase 3 - Reviews (parallel)

Spawn review agents simultaneously:

- **tech-reviewer** -- agent type: `tech-reviewer`, mode: `bypassPermissions`
- **product-reviewer** -- agent type: `product-reviewer`, mode: `bypassPermissions`
- Invoke `/plan-local-code-review` skill (team lead runs directly)
- Invoke `coderabbit:review` skill if plugin available

Wait for all reviews to complete.

## Step 6: Phase 4 - Post-Review (sequential)

1. **Fix review findings** -- re-spawn an implementer to address valid review suggestions
2. **Simplify code** -- invoke `code-simplifier` plugin for simplification pass
3. **Update tests** -- spawn `test-coverage-agent` to update tests for post-review changes
4. **Verify all tasks** -- team lead runs ALL proof commands from all tasks to confirm everything still works

## Step 7: Phase 5 - Learning & Archive

1. **Collect learnings** -- spawn `learner` agent (agent type: `learner`, mode: `bypassPermissions`) to process task learnings
2. **Archive the plan** -- after learner completes, team lead archives:
   - Create folder `<plan-name>` in `./plans/completed`
   - Rename the plan to reflect its actual contents
   - Move into `./plans/completed/<plan-name>`
   - Read session IDs from `./plans/completed/<plan-name>`
   - Move each `~/.claude/tasks/<session-id>` directory to `./plans/completed/<plan-name>/tasks`
   - Update any "in_progress" tasks to "completed"
3. **Finalize PR** -- `git push`, `gh pr ready`, `gh pr merge --auto --merge`

## Step 8: Shutdown Team

Send `shutdown_request` to all teammates and clean up the team.

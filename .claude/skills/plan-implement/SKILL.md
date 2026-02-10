---
name: plan-implement
description: "Implements an existing plan file by reading its tasks and executing them. Spawns an Agent Team with specialized agents for parallel implementation."
---

# Implement Plan

Implement the requirements in $ARGUMENTS.

If no argument provided, search for plan files in the `plans/` directory and present them to the user for selection.

## Workflow

1. **Read the plan file** specified in `$ARGUMENTS`
2. **Parse all tasks** from the plan, including their dependencies, descriptions, and verification requirements
3. **Parse task metadata** -- extract the JSON metadata code fence from each task (see @.claude/rules/plan.md Metadata section for the required schema)
4. **Create tasks** using TaskCreate for each task in the plan, passing the full parsed metadata
5. **Set up dependencies** between tasks using TaskUpdate (addBlockedBy/addBlocks)
6. **Spawn an Agent Team** with specialized agents to execute tasks in parallel where dependencies allow
7. **Execute tasks** following the plan's specified order and dependency graph
8. **Verify each task** using its `verification.command` before marking complete
9. **Archive the plan** following the Archive Procedure in @.claude/rules/plan.md

## Agent Team Composition

Use the specialized agents listed in $ARGUMENTS and the Implementation Team Guidance table in @.claude/rules/plan.md. The **team lead** handles git operations (commits, pushes, PR management) -- teammates focus on their specialized work.

## Task Metadata Rules

Each task in the plan file contains a JSON metadata code fence (schema defined in @.claude/rules/plan.md Metadata section).

- Every TaskCreate call MUST include the full `metadata` object from the plan's JSON code fence
- If a task is missing `skills` or `verification`, flag it as an error and ask the user before proceeding
- Run `verification.command` before marking any task complete

## Compaction Resilience

Context compaction can cause the team lead to lose in-memory state (task assignments, owner fields). Follow these rules:

1. **Dual owner storage** -- on every TaskUpdate that sets `owner`, also store it in `metadata.owner`:
   ```
   TaskUpdate({ taskId: "1", owner: "implementer-1", metadata: { owner: "implementer-1" } })
   ```
2. **Re-read after compaction** -- immediately call TaskList to reload all task state
3. **Restore missing owners** -- if any task has `metadata.owner` but no `owner` field, restore it via TaskUpdate
4. **Never rely on memory** -- always call TaskList before assigning new work

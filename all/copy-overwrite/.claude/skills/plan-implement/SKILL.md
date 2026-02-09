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
3. **Create tasks** using TaskCreate for each task in the plan
4. **Set up dependencies** between tasks using TaskUpdate (addBlockedBy/addBlocks)
5. **Spawn an Agent Team** with specialized agents to execute tasks in parallel where dependencies allow
6. **Execute tasks** following the plan's specified order and dependency graph
7. **Verify each task** using its verification metadata before marking complete
8. **Commit changes** after implementation using conventional commit format

## Agent Team Composition

Use the specialized agents listed in the `plan.md` rule (Implementation Team Guidance section). The **team lead** handles git operations (commits, pushes, PR management) -- teammates focus on their specialized work.

## Execution

Read the plan and begin implementation now.

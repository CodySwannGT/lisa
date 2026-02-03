# Plan Mode Rules

These rules are enforced whenever Claude is in plan mode. They are loaded at session start via `.claude/rules/` and reinforced on every prompt via the `enforce-plan-rules.sh` `UserPromptSubmit` hook.

## Required Behaviors

When making a plan:

- Always determine which skills should be used during execution of the plan and include them in the plan
- Always make sure you understand the correct versions of third party libraries
- Always create a task list of items related to the plan and specify that subagents should handle as many in parallel as possible
- Always save the plan with a name befitting the actual plan contents
- Always look for code that can be reused for implementation
- Always include a task to update/add/remove documentation
- The `## Sessions` section in plan files is auto-maintained by the `track-plan-sessions.sh` hook — do not manually edit it

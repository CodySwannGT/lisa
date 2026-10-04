# Roster Decision: CodySwannGT/lisa#4332

Native parent session: 01a104d8-3782-78f0-ab19-caa6e34ebab8.
Worktree: /Users/cody/.codex/worktrees/4ee1/lisa.

## Actual native catalog

The delegation surface is `collaboration.spawn_agent`. Its actual schema exposes `task_name`, `message`, `fork_turns`, and optional `model` and `reasoning_effort` parameters. There is no `agent_type` or named specialist selector and no separate specialist catalog. Optional overrides are not used. The supporting operations are `followup_task`, `send_message`, `wait_agent`, `list_agents`, and `interrupt_agent`.

INCLUDE - generic native delegate - The sole available delegation type is used with separate bounded role prompts because no specific specialist selector exists.

## Role assignments using the included type

- input_resolver: completed resolve/claim/bind transaction, immutable handoff retained.
- research: read-only Explore equivalent, owns source/history/docs/spec/environment research before implementation.
- builder: owns scoped tests and shared Rails template changes, RED/GREEN evidence, no delivery operations.
- independent_verifier: independently checks every acceptance atom, current source hashes, emitted Ruby behavior, controls and create-only preservation without implementing the fix.
- learning_review: skeptical bounded review after implementation, assigned by followup_task to the completed native research delegate; no memory or promotion writes, empty candidates are valid.
- lead: owns synchronization, worktree-local dependencies, plan and source ownership, required quality/artifact checks and staged local handoff.

These are explicit task roles, not fabricated native agent types. Research and verification remain separate from the builder. No roster/research/build work occurred during input resolution. This stage stops at the local verified handoff, before commit, submit, merge or closure.

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
3. **Parse task metadata** — extract the JSON metadata code fence from each task (see Task Metadata Requirements below)
4. **Create tasks** using TaskCreate for each task in the plan, passing the full parsed metadata
5. **Set up dependencies** between tasks using TaskUpdate (addBlockedBy/addBlocks)
6. **Spawn an Agent Team** with specialized agents to execute tasks in parallel where dependencies allow
7. **Execute tasks** following the plan's specified order and dependency graph
8. **Verify each task** using its verification metadata before marking complete
9. **Archive the plan** following the Archive Instructions below
10. **Final push and PR** — `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=5" git push`, `gh pr ready`, `gh pr merge --auto --merge`

## Agent Team Composition

Use the specialized agents listed in $ARGUMENTS and the @.claude/rules/plan.md rule (Implementation Team Guidance section). The **team lead** handles git operations (commits, pushes, PR management) — teammates focus on their specialized work.

## Task Metadata Requirements

Each task in the plan file contains a JSON metadata code fence. The team lead MUST parse these blocks and pass ALL fields to TaskCreate.

**Required metadata fields:**

```json
{
  "plan": "<plan-name>",
  "type": "bug|task|epic|story",
  "skills": ["skill-1", "skill-2"],
  "verification": {
    "type": "test|ui-recording|test-coverage|api-test|manual-check|documentation",
    "command": "the proof command",
    "expected": "what success looks like"
  }
}
```

**Rules:**
- Every TaskCreate call MUST include the full `metadata` object from the plan's JSON code fence
- If a task in the plan is missing `skills` or `verification`, flag it as an error and ask the user before proceeding
- The `verification.command` is used to empirically verify task completion — run it before marking any task complete

## Compaction Resilience

Context compaction can cause the team lead to lose in-memory state (task assignments, owner fields). Follow these rules to stay resilient:

1. **Dual owner storage** — on every TaskUpdate that sets `owner`, also store it in `metadata.owner`:
   ```
   TaskUpdate({ taskId: "1", owner: "implementer-1", metadata: { owner: "implementer-1" } })
   ```
2. **Re-read after compaction** — after any context compaction event, immediately call TaskList to reload all task state
3. **Restore missing owners** — if any task has `metadata.owner` but no `owner` field, restore it via TaskUpdate
4. **Never rely on memory** — always call TaskList before assigning new work; do not assume you remember who owns what

## Archive Instructions

After all tasks (except archive) are complete, archive the plan. This step MUST use `mv` via Bash — never use Write, Edit, or copy tools to move the plan file, as these overwrite the `## Sessions` table that `track-plan-sessions.sh` maintains.

1. **Create destination folder:**
   ```bash
   mkdir -p ./plans/completed/<plan-name>
   ```

2. **Verify Sessions table** — read the plan file and confirm the `## Sessions` table has entries. If empty, proceed to the fallback in step 5.

3. **Move the plan file** (preserves Sessions data):
   ```bash
   mv plans/<plan-file>.md ./plans/completed/<plan-name>/<renamed-plan>.md
   ```

4. **Verify source is gone:**
   ```bash
   ! ls plans/<plan-file>.md 2>/dev/null && echo "Source removed"
   ```

5. **Move task directories** — parse session IDs from the `## Sessions` table in the moved plan file, then move each session's task directory:
   ```bash
   mv ~/.claude/tasks/<session-id> ./plans/completed/<plan-name>/tasks/
   ```
   **Fallback:** if the Sessions table is empty, search for task directories with matching plan metadata:
   ```bash
   grep -rl '"plan": "<plan-name>"' ~/.claude/tasks/*/
   ```
   Move the parent directories of any matches.

6. **Update remaining tasks** — set any `in_progress` tasks to `completed` via TaskUpdate.

7. **Final git operations:**
   ```bash
   git add . && git commit -m "chore: archive <plan-name> plan"
   GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=5" git push
   gh pr ready
   gh pr merge --auto --merge
   ```

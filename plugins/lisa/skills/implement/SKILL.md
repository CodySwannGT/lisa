---
name: implement
description: This skill should be used for any non-trivial request — features, bugs, stories, epics, spikes, or multi-step tasks. It accepts a ticket URL (Jira, Linear, GitHub), a file path containing a spec, or a plain-text prompt. It assembles an agent team, breaks the work into structured tasks, and manages the full lifecycle from research through implementation, code review, deploy, and empirical verification.
---

# Implement: $ARGUMENTS

## Orchestration: agent team

If you are NOT already operating inside an agent team (no prior `TeamCreate` in this session, not spawned via `Agent` with `team_name`), your FIRST tool call MUST be `TeamCreate`. Do not call `TaskCreate`, `Agent`, or implementation tools before the team exists.

If you ARE already inside an agent team (e.g., a teammate invoked this skill via the Skill tool, or `lisa:intake` is running this skill per Ready ticket), do NOT call `TeamCreate` — the harness rejects double-creates. Continue within the existing team. The team lead created the team; teammates inherit it.

When you do create the team, spawn every agent with `mode: "plan"` so they must submit their plan for team lead approval before making any file changes. Every team must include the Explore agent.

## Resolve the input

$ARGUMENTS is either a url to a ticket containing the request, a pointer to a file containing the request, or the request in text format.

If it's a ticket, use the appropriate vendor adapter to read and fully understand the request:
- JIRA ticket → `lisa:jira-read-ticket` (preferred) or the Jira CLI
- Linear ticket → the Linear CLI (no `lisa:linear-*` adapter built yet)
- GitHub ticket → the Github CLI

Capture comments and metadata, not just the description.

If it's a file, read the entire file without offset or limit.

Is this a simple request? Just execute it as usual and ignore the rest of this skill.

## Select the agent roster

Review all available agent types listed in the Task tool's `subagent_type` options. This includes built-in agents (like `Explore`, `general-purpose`), custom agents (from `.claude/agents/`), and plugin agents (from `.claude/settings.json` `enabledPlugins`). For each agent, explain in one sentence why it IS or IS NOT relevant to this task. Then select all agents that are relevant. You MUST justify excluding an agent — inclusion is the default.

When deciding the agents to use, consider:
* Before any task is implemented, the agent team must explore the codebase for relevant research (documentation, code, git history, etc) and update each task's `metadata.relevant_documentation` with the findings.
* Each task must be reviewed by the team to make sure their verification passes.
* Each task must have their learnings reviewed by the learner subagent.

Using the general-purpose agent in Team Lead session, Determine the name of this plan

Using the general-purpose agent in Team Lead session, Determine what branch to use:
1. Are we already on a feature branch with an open pull request? Use that and set the target branch to the existing target of the pull request
2. Are we on a feature branch without an open pull request? Use the branch, but ask the human what branch to target for the PR
3. Are we on an environment branch (dev, staging, main, prod, production)? Check out a feature branch named for this plan and set the target branch of the PR to the environment branch

Using the general-purpose agent in Team Lead session, Determine which flow applies:
1. Research -- needs a PRD (no specification exists)
2. Plan -- needs decomposition (specification exists but no work items)
3. Implement -- has a well-defined work item
4. Verify -- has code ready to ship

If Implement, determine the work type:
1. Build (feature, story, task)
2. Fix (bug -- mandatory Reproduce sub-flow before investigation)
3. Improve (refactoring, optimization, coverage improvement)
4. Investigate Only (spike -- no code changes, just findings)

Run the readiness gate check for the selected flow as defined in the `intent-routing` rule (loaded via the lisa plugin). If the gate fails, stop and report what is missing.

IF it is a Fix (bug), execute the Reproduce sub-flow FIRST:
1. Write a failing test that demonstrates the bug (preferred)
2. If a failing test is not possible, write a minimal reproduction script
3. Verify the reproduction is reliable (consistent failure)
4. The reproduction MUST succeed before any investigation or fix attempt begins
5. Examples of reproduction methods:
   1. Write a simple API client and call the offending API
   2. Start the server on localhost and use the Playwright CLI or Chrome DevTools

Using the general-purpose agent in Team Lead session, determine how you will know that the task is fully complete
1. Examples
   1. Direct deploy the changes to dev and then Write a simple API client and call the offending API
   2. Start the server on localhost and then Use the Playwright CLI or Chrome DevTools

Using the general-purpose agent in Team Lead session, create tasks needed to complete the request.

Every task MUST include this JSON metadata block. Do NOT omit `skills` (use `[]` if none), `learnings` (use `[]` if none) or `verification`.

```json
{
  "plan": "<plan-name>",
  "type": "spike|bug|task|epic|story",
  "acceptance_criteria": ["..."],
  "relevant_documentation": "",
  "testing_requirements": ["..."],
  "skills": ["..."],
  "learnings": ["..."],
  "verification": {
    "type": "ui-recording|api-test|cli-test|database-check|manual-check|documentation",
    "command": "the proof command — must run the actual system (NOT test/typecheck/lint, those are quality gates)",
    "expected": "what success looks like — observable system behavior"
  }
}
```

Before any task is implemented, the agent team must explore the codebase for relevant research (documentation, code, git history, etc) and update each task's `metadata.relevant_documentation` with the findings.

Each task must be reviewed by the team to make sure their verification passes.
Each task must have their learnings reviewed by the learner subagent.

Before shutting down the team, execute the Verify flow:

1. Run quality gates: lint, typecheck, tests — all must pass. These are prerequisites, NOT verification.
2. `verification-specialist`: verify locally by running the actual system and observing results (empirical proof that the change works). This is the real verification step.
3. Write e2e test encoding the verification
4. Commit ALL outstanding changes in logical batches on the branch (minus sensitive data/information) — not just changes made by the agent team. This includes pre-existing uncommitted changes that were on the branch before the plan started. Do NOT filter commits to only "task-related" files. If it shows up in git status, it gets committed (unless it contains secrets).
5. Push the changes - if any pre-push hook blocks you, create a task for the agent team to fix the error/problem whether it was pre-existing or not
6. Open a pull request with auto-merge on
7. PR Watch Loop: Monitor the PR. Create a task for the agent team to resolve any code review comments by either implementing the suggestions or commenting why they should not be implemented and close the comment. Fix any failing checks and repush. Continue until all checks pass.
8. Merge the PR
9. Monitor the deploy action that triggers automatically from the successful merge
10. If deploy fails, create a task for the agent team to fix the failure, open a new PR and then go back to step 7
11. Remote verification: `verification-specialist` verifies in target environment (same checks as local verification, but on remote)
12. `ops-specialist`: post-deploy health check, monitor for errors in first minutes
13. If remote verification fails, create a task for the agent team to find out why it failed, fix it and return to step 4 (repeat until you get all the way through)

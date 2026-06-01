---
name: implement
description: This skill should be used for any non-trivial request — features, bugs, stories, epics, spikes, or multi-step tasks. It accepts a ticket URL (Jira, Linear, GitHub), a file path containing a spec, or a plain-text prompt. It assembles an agent team, breaks the work into structured tasks, and manages the full lifecycle from research through implementation, code review, deploy, and empirical verification.
---

# Implement: $ARGUMENTS

## Orchestration: agent team

Implement is a **team-first** flow. Bug, Build, Improve, and Investigate-Only all compose multiple specialists (Reproduce → debug → fix → review → verify). Single-agent mode is not permitted based on task complexity — the only exception is when no team creation or subagent delegation tool is available in the current runtime (see no-team fallback in the paragraph below).

If you are NOT already operating inside an agent team (no prior successful team-creation or subagent-delegation tool call in this session, not spawned into a team context), the very first thing you do is establish team orchestration.

Use the team tool for the current runtime:

- Claude: use `TeamCreate`. If `TeamCreate` has not been loaded yet, first use `ToolSearch` with `query: "select:TeamCreate"` to load its schema.
- Codex: do not call `TeamCreate`; Codex does not expose that Claude tool. Use `tool_search` with a query like `multi-agent tools` to load `multi_agent_v1`, then use `multi_agent_v1.spawn_agent` for teammate delegation. Treat the first successful `spawn_agent` call as establishing team orchestration.
- Other runtimes: use the current runtime's tool-discovery mechanism to discover and call the appropriate multi-agent/team tool.

If no team creation or subagent delegation tool is available, explicitly state that team orchestration is unavailable in this runtime, continue as the lead agent, and preserve the workflow's review, verification, and task-tracking obligations locally. Every team must include the Explore agent.

Until the team is established, the first Codex teammate has been spawned, or the no-team fallback has been declared, do NOT call any of: `Agent`, `TaskCreate`, `Skill` (including `lisa:tracker-read`, `lisa:jira-read-ticket`, `lisa:github-read-issue`), MCP tools (Atlassian / Linear / GitHub / Notion), `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`. Reading the ticket, exploring the code, fetching context — every one of those is a task for the team you are about to create, not for the lead session before orchestration exists. Doing them inline is the exact bypass path that produces a 1-agent ad-hoc fix instead of a real team flow.

If you ARE already inside an agent team (e.g., a teammate invoked this skill via the Skill tool, or `lisa:intake` is running this skill per Ready ticket), do NOT create a second team — many harnesses reject double-creates — and do NOT collapse the nested flow into a single inline worker. A nested team-first flow must still bring in the specialists it requires by adding them to the existing team, not by doing the work itself:

- **Claude:** teams are flat and only the lead can add named teammates, so do NOT call `Agent` with a `name` from a teammate (the harness rejects it: *"Teammates cannot spawn other teammates — the team roster is flat"*). Send the team lead a message naming the specialist teammate(s) this flow needs, their task assignments, and completion criteria, then coordinate through the shared task list until they finish. An anonymous subagent (`Agent` with `name` omitted) is permitted only for bounded one-shot work whose result returns directly to you — it is not a substitute for the required lifecycle specialists.
- **Codex:** do NOT call `TeamCreate`. If the lead/root agent is addressable (you were given its id/handle), send it a request to `multi_agent_v1.spawn_agent` the specialist agent(s), including each agent's prompt, ownership, and expected result. If no lead handle exists but `spawn_agent` is available to you, spawn only the bounded specialist agent(s) this flow needs, `wait_agent` for their results, and relay those results upward to the parent/lead.

Treat the first successful lead-spawn request (or, on the Codex fallback, the first specialist spawn) as preserving team orchestration. Never satisfy a team-first lifecycle flow by doing all the work inline.

## Resolve the input (first task assigned to the team)

$ARGUMENTS is either a url to a ticket containing the request, a pointer to a file containing the request, or the request in text format.

The team lead does NOT read the input directly. The first task on the team's plan is "resolve the input" — assigned to a teammate, which then:

- If it's a ticket, calls `lisa:tracker-read` (preferred — vendor-agnostic; dispatches per `.lisa.config.json` `tracker`). **Mismatch guard**: if the ticket format doesn't match the configured tracker (e.g., a GitHub URL when `tracker` is `jira`), `tracker-read` stops and reports the error — never auto-translates vendors:
  - JIRA ticket → `lisa:tracker-read` → `lisa:jira-read-ticket`
  - GitHub Issue → `lisa:tracker-read` → `lisa:github-read-issue`
  - Linear identifier or project URL → `lisa:tracker-read` → `lisa:linear-read-issue`
  - Captures comments and metadata, not just the description.
- If it's a file, reads the entire file without offset or limit.
- If it's a plain-text request, uses the provided text verbatim as the resolved input.
- Returns the resolved input to the team lead, who then proceeds to roster selection.

## Select the agent roster

Review all available agent types listed in the Task tool's `subagent_type` options. This includes built-in agents (like `Explore`, `general-purpose`), custom agents (from `.claude/agents/`), and plugin agents (from `.claude/settings.json` `enabledPlugins`). For each agent, explain in one sentence why it IS or IS NOT relevant to this task. Then select all agents that are relevant. You MUST justify excluding an agent — inclusion is the default.

When deciding the agents to use, consider:
* Before any task is implemented, the agent team must explore the codebase for relevant research (documentation, code, git history, etc) and update each task's `metadata.relevant_documentation` with the findings.
* Each task must be reviewed by the team to make sure their verification passes.
* Each task must have their learnings reviewed by the learner subagent.

Using the general-purpose agent in Team Lead session, Determine the name of this plan

Using the general-purpose agent in Team Lead session, **determine the base branch from the ticket's target environment, then sync the working branch onto the latest of it before any work** — so implementation always builds on current target-environment code:

1. **Resolve the target environment** from the resolved work item — its `## Target Backend Environment` section (the field the `*-write-*` / `*-add-journey` skills record).
2. **Map the environment to a base branch** via `.lisa.config.json` `deploy.branches` (e.g. `staging → staging`, `production → main`) — the forward direction of the same map the env-keyed `done` resolution uses in reverse (see the `config-resolution` rule). If the work item names **no** environment, the base branch is the **remote default branch** (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, or `git remote set-head origin -a` then read `origin/HEAD`). If the named environment is absent from `deploy.branches`, or its branch does not exist on the remote, **stop and report** — never guess a base.
3. **Establish the feature branch off the latest base, conflict-free:**
   - `git fetch origin`.
   - Already on a feature branch with an **open PR** → reuse it. If the PR's base ≠ the resolved base branch, surface the mismatch and re-target only with confirmation — the ticket's environment is the source of truth.
   - Already on a feature branch with **no open PR** → reuse it; its PR base will be the resolved base branch (do not ask the human — the environment determines it).
   - On an **environment / default branch** → check out a feature branch named for this plan (with the work-item ref prefix, per the linkage rules below) **from `origin/<base>`**.
   - **Rebase the feature branch onto `origin/<base>` and resolve any merge conflicts BEFORE starting work.** If the conflicts cannot be resolved cleanly and safely, create a fix task for the agent team (with the conflicting file list and current merge state) and resolve it before implementation begins — never start work on stale or conflicted code.
4. **The PR targets the resolved base branch** — carry it as `target_branch=<base>` into `lisa:git-submit-pr` (Verify flow). `git-submit-pr` already chooses a closing keyword when the base is the production/default branch and a non-closing reference for a non-terminal environment branch.

When the request came from a tracker work item, preserve its native identifier for development linkage:

- Capture `tracker_provider` and `work_item_ref` from the resolved input before creating or reusing a branch. Examples: `github` + `CodySwannGT/lisa#614`, `linear` + `ENG-123`, `jira` + `ENG-123`.
- If a new branch is needed and the provider can link branches by identifier, include the identifier in the branch name before the human-readable slug. Linear and JIRA integrations commonly link from branch names; GitHub issue linkage is PR-body driven, but including the issue number in the branch name is still useful. Keep branch names URL-safe, for example `codex/ENG-123-add-checkout-copy` or `codex/614-add-checkout-copy`.
- Pass the work-item ref and target branch to `lisa:git-submit-pr` when opening or updating the PR, for example `work_item_ref=CodySwannGT/lisa#614 target_branch=<base resolved from the ticket's environment above>` (not hardcoded `main`). The PR workflow owns provider-specific body text and must decide whether to use a closing keyword or a non-closing reference.
- If the provider has no native branch or PR development-linkage surface, continue without linkage and mention that the provider was skipped.

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

Using the general-purpose agent in Team Lead session, determine how you will know that the task is fully complete. Write this as an **effective completion condition** — one an independent verifier could confirm from observed output alone, not from your assertion that it works. A strong condition has:

- **One measurable end state** — a status code, an exit code, a row count, an observable UI state, an empty queue. Not "it looks right" or "the code is correct".
- **A stated proof command that surfaces the evidence** — exactly how the running system is exercised so the result is observable (e.g. `curl … returns 200 with {…}`, "the Playwright run reaches the dashboard", "`SELECT … ` returns the new row"). Quality gates (test/typecheck/lint) do NOT count — they are prerequisites.
- **Constraints that must hold** — anything that must not change on the way there (e.g. "no other endpoint's response changes", "no migration is dropped").

This condition is the contract the Verify flow proves and records in the verification verdict (below); it is what the completion gate checks before the flow may stop.

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
    "command": "the proof command — must run the actual system and surface its result in the transcript (NOT test/typecheck/lint, those are quality gates). Phrase it so an independent verifier sees the evidence, e.g. `curl -s localhost:3000/health` not `check that health works`",
    "expected": "the single measurable end state that proves success — observable system behavior (status code, response body, row count, UI state), not a subjective judgement"
  }
}
```

Before any task is implemented, the agent team must explore the codebase for relevant research (documentation, code, git history, etc) and update each task's `metadata.relevant_documentation` with the findings.

Each task must be reviewed by the team to make sure their verification passes.
Each task must have their learnings reviewed by the learner subagent.

Before shutting down the team, execute the Verify flow:

1. Run quality gates: lint, typecheck, tests — all must pass. These are prerequisites, NOT verification.
2. `verification-specialist`: verify locally by running the actual system and observing results (empirical proof that the change works). This is the real verification step.
2a. **Record the verification verdict** — the independent, machine-readable proof that gates completion. The `verification-specialist` writes `${CLAUDE_PROJECT_DIR:-.}/.lisa/verification-status.json` with one entry per acceptance criterion, each carrying the proof command's observed evidence:

    ```json
    {
      "plan": "<plan-name>",
      "status": "pass | fail | blocked | in_progress",
      "criteria": [
        { "task": "<task id or title>", "criterion": "<the completion condition>", "status": "pass | fail", "evidence": "<the proof command run and the observed result>" }
      ],
      "updated_at": "<ISO8601 UTC>"
    }
    ```

    Set `status: "pass"` only when every criterion is `pass` with real evidence (output from running the system, not a claim). The verdict must be judged by an agent that did NOT implement the change (the `verification-specialist`), never self-certified by the implementer. This is runtime scratch — it is gitignored and MUST NOT be committed (treat it like the secrets exclusion in the commit step).

    On Claude, the `enforce-verification-gate.sh` Stop hook reads this file and **will not let the flow stop** until it shows a terminal, all-`pass` verdict — carrying over the non-bypassable completion gate of the `/goal` primitive, but checked deterministically against real evidence rather than by a transcript-only evaluator model. If you must stop before completion (a readiness gate failed, a blocker was found, a dependency is unresolved), write the verdict with `status: "blocked"` and the reason: that records the outcome and releases the gate instead of leaving it to spin. Other harnesses fall back to this prose obligation.
3. Write e2e test encoding the verification
4. Record Implement usage on the originating work artifact via `lisa:usage-accounting` so the work item (or other implementation-owned artifact) gains a direct `implement` usage entry in the canonical `## Lisa Usage` section. If the parent / child graph is already known, prefer `record_and_rollup` so ancestor totals refresh in the same write; otherwise still write the direct entry, and if runtime usage is unavailable, use `source: unavailable` with nullable token/cost fields instead of skipping the row.
5. Commit ALL outstanding changes in logical batches on the branch (minus sensitive data/information) — not just changes made by the agent team. This includes pre-existing uncommitted changes that were on the branch before the plan started. Do NOT filter commits to only "task-related" files. If it shows up in git status, it gets committed (unless it contains secrets).
6. Push the changes - if any pre-push hook blocks you, create a task for the agent team to fix the error/problem whether it was pre-existing or not
7. Open a pull request with auto-merge on via `lisa:git-submit-pr`, targeting the **base branch resolved from the ticket's environment** (`target_branch=<base>`, per the branch step above), and including the work-item ref when one exists so the PR can be linked natively to the source issue.
8. PR Watch Loop: Monitor the PR using `git-submit-pr`'s drive-to-merge behavior. Create a task for the agent team to resolve any code review comments by either implementing the suggestions or commenting why they should not be implemented and close the comment. Fix any failing checks and repush. If the PR is `BEHIND`, blocked by stale review state, or cannot enable auto-merge, follow the harness-agnostic `git-submit-pr` re-sync, review-gate, and direct-merge fallback loop until the PR is actually merged or a blocking failure is surfaced.
9. Merge the PR
10. Monitor the deploy action that triggers automatically from the successful merge
11. If deploy fails, create a task for the agent team to fix the failure, open a new PR and then go back to step 7
12. Remote verification: `verification-specialist` verifies in target environment (same checks as local verification, but on remote), and refreshes the verdict (step 2a) to reflect the remote result.
13. `ops-specialist`: post-deploy health check, monitor for errors in first minutes
14. If remote verification fails, create a task for the agent team to find out why it failed, fix it and return to step 5. **Bound this loop**: after a small number of full fix→deploy→reverify cycles without reaching a passing remote verdict (treat ~3 as the ceiling unless the work item states otherwise), stop retrying — file a build-ready fix ticket, write the verdict with `status: "blocked"` and the diagnosis, and move the work item to blocked rather than looping indefinitely. The completion gate releases on a `blocked` verdict, so the flow ends with a recorded outcome instead of a silent spin or a self-declared success.

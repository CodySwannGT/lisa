# Intent Routing

MANDATORY: On the **first user message of a session**, classify the request using the Flow Classification Protocol below and state the chosen flow before doing any other work. Do not respond to the substance of the request, do not start work, do not ask questions until you have stated which flow applies. Once a flow is established, treat it as fixed for the remainder of the session — **do not re-classify on subsequent messages**, even if a follow-up looks vague or conversational ("wait, what did you just do?", "now run the tests", "thanks"). Subsequent messages operate within the established flow unless the user explicitly changes scope. Skipping classification leads to unstructured responses that bypass readiness gates.

Each flow has a readiness gate that MUST pass before work begins. If the gate fails, stop and ask for what is missing.

## Flow Classification Protocol

This protocol runs **once per session**, on the first user message. After that, every later message inherits the established flow — do not re-run classification.

1. If the user invoked a slash command (`/lisa:research`, `/lisa:plan`, `/lisa:implement`, `/lisa:verify`, `/lisa:monitor`, `/lisa:intake`, etc.), the flow is already determined -- skip classification.
2. Read the user's request and match it against the flow definitions below.
3. If you cannot confidently classify the request:
   - **Interactive session** (user is present): present a multiple choice using AskUserQuestion with options: Research, Plan, Implement, Verify, No flow.
   - **Headless/non-interactive session** (running with `-p` flag, in a CI pipeline, or as a scheduled agent): do NOT ask the user. Classify to the best of your ability from available context (ticket content, prompt text, current branch state). If you truly cannot classify, default to "No flow" and proceed with the request as-is.
4. Once a flow is selected, **echo it back explicitly** before doing anything else. State the flow, the work type (if applicable), and a one-sentence justification for why this flow was chosen. Example:

   > **Flow: Implement/Fix**
   > This is a bug report with a specific error and reproduction steps, so it routes to the Fix work type within the Implement flow.

   This echo is mandatory. Do not skip it, abbreviate it, or bury it in other output. The user must see the flow classification before any work begins.
5. If you are a subagent: your parent agent has already determined the flow -- do NOT ask the user to choose a flow. Execute your assigned work within the established flow context.

## Orchestration Selection Protocol

Orchestration is owned by the **lifecycle skill** for the chosen flow, not by this rule. Each top-level lifecycle skill (`lisa:research`, `lisa:plan`, `lisa:implement`, `lisa:verify`, `lisa:monitor`, `lisa:intake`) contains its own cascade-safe orchestration preamble — that's where the team is created (or skipped, if already inside one).

What this rule still enforces:

1. **Echo orchestration mode immediately after echoing the flow** (in the same message), so the user sees both before any work begins:

   > **Orchestration: agent team** (or **single agent**)
   > One-sentence justification.

2. **Cascade rule (load-bearing)**: Before calling `TeamCreate`, check whether you are already operating inside an agent team. Signs you are inside a team: a prior `TeamCreate` exists in this session; you were spawned via `Agent` with `team_name`; your context references a team lead. If any of these are true, **do NOT call `TeamCreate`** — the harness rejects double-creates and the work stalls. Continue within the existing team. Invoke flows via the Skill tool; the team lead inherits responsibility for orchestration.

3. **Default mode**: All top-level lifecycle flows (`Research`, `Plan`, `Implement`, `Verify`, `Monitor`, `Intake`) run as agent teams. The `Implement` flow — including every work type (`Build`, `Fix`, `Improve`, `Investigate-Only`) — is **always** a team flow. Bug fixes that "look simple" are not an exception: the Reproduce sub-flow, debug-specialist, bug-fixer, parallel reviewers, and verification-specialist all need to compose. Single-agent mode is reserved for two narrow cases only: `product-walkthrough` invoked standalone (not as part of Research/Plan), and one-off diagnostic Bash/Read sessions that don't invoke any lifecycle skill. When in doubt, use a team.

The mechanical TeamCreate bootstrap directive lives inside each lifecycle skill — see those skills' orchestration preambles for the exact wording: first `ToolSearch{select:TeamCreate}` (load deferred schema), then `TeamCreate`.

## Readiness Gate Protocol

Every flow begins with a gate check. The gate defines what information must be present before the flow can begin.

If the gate fails:
- **Interactive session** (user is present):
  1. Identify exactly what is missing
  2. Before asking the user, attempt to answer the questions yourself from available context (source code, docs, git history, project structure, config files). Only ask the user about information you genuinely cannot determine.
  3. When you do ask the user, provide recommended answers to choose from based on what you found in the codebase. Do not ask open-ended questions when you can offer specific options.
  4. Tell the user what is needed and why
  5. Do NOT proceed until the missing information is provided or resolved
  6. If the missing information can be obtained by running a preceding flow (e.g., Research before Plan), suggest that instead
- **Headless/non-interactive session** (running with `-p` flag, in a CI pipeline, or as a scheduled agent): do NOT block on missing information. Infer what you can from available context (ticket content, prompt text, codebase state, git history). Proceed with best effort using what is available. If critical information is truly unobtainable, fail with a clear error message explaining what was missing.

## Main Flows

### Research

When: "I need a PRD", "What should we build?", product discovery, requirements gathering, feature exploration, understanding a problem space, open-ended feature ideas.

Gate:
- A problem statement, feature idea, or business objective must be provided
- If none is provided, ask: "What problem are you trying to solve or what capability are you trying to add?"

Sequence:
1. **Investigate sub-flow** -- gather context from codebase, git history, existing behavior, and external sources
2. `product-specialist` -- define user goals, user flows (Gherkin), acceptance criteria, error states, UX concerns, and out-of-scope items
3. `architecture-specialist` -- assess technical feasibility, identify constraints, map existing system boundaries
4. Synthesize findings into a PRD document containing: problem statement, user stories, acceptance criteria, technical constraints, open questions, and proposed scope
5. **Plan Phase Tooling** -- review all available skills and agents (project-defined, plugin-provided, and built-in) and determine which ones the Plan phase will need. For each recommended skill or agent, state why it is needed. If no skills or agents beyond the defaults are identified, explicitly justify why the standard set is sufficient. Include this as a "Recommended Tooling for Plan Phase" section in the PRD.
6. `learner` -- capture discoveries for future sessions

Output: A PRD document that includes a "Recommended Tooling for Plan Phase" section listing the skills and agents the Plan phase should use. If there is not enough context to produce a complete PRD, stop and report what is missing rather than producing an incomplete one.

### Plan

When: "Break this down", "Create tickets", epic planning, large scope work, JIRA epic tickets, "Turn this PRD into work items".

Gate:
- A PRD, specification document, or equivalent detailed description must be provided
- The specification must contain: clear scope, acceptance criteria, and enough detail to decompose into work items
- If no specification exists, stop and suggest running the **Research** flow first
- If the specification has unresolved ambiguities, stop and list them

Sequence:
1. **Investigate sub-flow** -- explore codebase for architecture, patterns, dependencies relevant to the spec
2. `product-specialist` -- validate and refine acceptance criteria for the whole scope
3. `architecture-specialist` -- map dependencies, identify cross-cutting concerns, determine execution order
4. **Implement/Verify Phase Tooling** -- review all available skills and agents (project-defined, plugin-provided, and built-in) and determine which ones the Implement and Verify phases will need for each work item. For each recommended skill or agent, state why it is needed and which work items it applies to. If no skills or agents beyond the defaults are identified for a work item, explicitly justify why the standard set is sufficient.
5. Decompose into ordered work items (epics, stories, tasks, spikes, bugs), each with:
   - Type (epic, story, task, spike, bug)
   - Acceptance criteria
   - Verification method
   - Dependencies
   - Skills and agents required (from step 4)
6. Create work items in the tracker (JIRA, Linear, GitHub) with acceptance criteria, dependencies, and recommended skills/agents
7. `learner` -- capture discoveries for future sessions

Output: Work items in a tracker with acceptance criteria and recommended skills/agents, ordered by dependency. If the specification cannot be decomposed without further clarification, stop and report what is missing.

### Implement

When: Working on a specific ticket (story, task, bug, spike), implementing a well-defined piece of work.

Gate:
- A well-defined work item with acceptance criteria must be provided (ticket URL, file spec, or detailed description)
- The work item must have clear scope, expected behavior, and verification method
- If acceptance criteria are missing or ambiguous, stop and ask before proceeding
- If the work item is too large (epic-level), stop and suggest running the **Plan** flow first

Determine the work type and execute the matching variant:

#### Build (features, stories, tasks)

1. **Investigate sub-flow** -- explore codebase for related code, patterns, dependencies
2. `product-specialist` -- define acceptance criteria, user flows, error states
3. `architecture-specialist` -- design approach, map files to modify, identify reusable code
4. `test-specialist` -- design test strategy (coverage, edge cases, TDD sequence)
5. `builder` -- implement via TDD (acceptance criteria become tests)
6. Run quality gates: lint, typecheck, tests (these are prerequisites, NOT verification)
7. `verification-specialist` -- verify locally (run the software, observe behavior)
8. `verification-specialist` -- invoke `codify-verification` skill per passing verification (Playwright for UI, integration test for API/DB/auth, etc.); commit each test in the same PR
9. **Review sub-flow**
10. `learner` -- capture discoveries

#### Fix (bugs)

1. **Reproduce sub-flow** -- write failing test or script that demonstrates the bug (MANDATORY before any fix is attempted)
2. **Investigate sub-flow** -- git history, root cause analysis
3. `debug-specialist` -- prove root cause with evidence
4. `architecture-specialist` -- assess fix risk, identify files to change, check for ripple effects
5. `test-specialist` -- design regression test strategy
6. `bug-fixer` -- implement fix via TDD (reproduction becomes failing test)
7. Run quality gates: lint, typecheck, tests (these are prerequisites, NOT verification)
8. `verification-specialist` -- verify locally (prove the bug is fixed)
9. `verification-specialist` -- invoke `codify-verification` skill to encode the fix as a regression test (mandatory for bug fixes — the test must fail against the pre-fix commit and pass against the fix); commit in the same PR
10. **Review sub-flow**
11. `learner` -- capture discoveries

#### Improve (refactoring, optimization, coverage improvement)

1. **Investigate sub-flow** -- understand current state, measure baseline
2. `architecture-specialist` -- identify target, plan approach
3. `test-specialist` -- ensure existing test coverage before refactoring (safety net)
4. `builder` -- implement improvements via TDD
5. Run quality gates: lint, typecheck, tests (these are prerequisites, NOT verification)
6. `verification-specialist` -- measure again, prove improvement over baseline
7. `verification-specialist` -- invoke `codify-verification` skill (typically a benchmark asserting against baseline for performance work, or a regression test for behavioral refactors); commit in the same PR
8. **Review sub-flow**
9. `learner` -- capture discoveries

#### Investigate Only (spikes)

1. **Investigate sub-flow** -- full investigation
2. Report findings with evidence
3. Recommend next action (Research, Plan, Implement, or escalate)
4. `learner` -- capture discoveries

Output: Code passing all quality gates + local empirical verification + codified regression test for each verification (except for spikes, which produce findings only, and non-behavioral verification types — PR / Documentation / Deploy — which carry their own proof).

### Verify

When: Code is ready to ship. All quality gates pass and local empirical verification is complete. Moving from "works on my machine" to "works in production".

Gate:
- Code must pass quality gates (lint, typecheck, tests)
- Local empirical verification must be complete
- Each passing local verification must be codified as a regression test (or carry a documented skip from the allowed set: PR / Documentation / Deploy / Investigate-Only). If verifications are not codified, return to the Implement flow's codify step before shipping
- If quality gates fail, go back to **Implement**
- If no code changes exist, there is nothing to verify

Sequence:
1. Commit -- atomic conventional commits via `git-commit` skill
2. PR -- create/update pull request via `git-submit-pr` skill
3. PR Watch Loop (repeat until mergeable):
   - If status checks fail -- fix and push
   - If merge conflicts -- resolve and push
   - If bot review feedback (CodeRabbit, etc.):
     - Valid feedback -- implement fix, push, resolve comment
     - Invalid feedback -- reply explaining why, resolve comment
   - Repeat until all checks pass and all comments are resolved
4. Merge the PR
5. Monitor deploy (watch the deployment action triggered by merge):
   - If deploy fails -- fix, open new PR, return to step 3
6. Remote verification:
   - `verification-specialist` -- verify in target environment (same checks as local verification, but on remote)
   - `ops-specialist` -- post-deploy health check, smoke test, monitor for errors in first minutes
   - If remote verification fails -- fix, open new PR, return to step 3

Output: Merged PR, successful deploy, remote verification passing.

## Sub-flows

Sub-flows are reusable sequences invoked by main flows. When a flow says "Investigate sub-flow", execute the full Investigate sequence.

### Investigate

Purpose: Gather context and evidence about code, behavior, or systems.

Sequence:
1. `git-history-analyzer` -- understand why affected code exists, find related past changes
2. `debug-specialist` -- reproduce if applicable, trace execution, prove findings with evidence
3. `ops-specialist` -- check logs, errors, health (if runtime issue)
4. Report findings with evidence

### Reproduce

Purpose: Create a reliable reproduction that demonstrates a bug before fixing it.

Sequence:
1. Execute the exact scenario that triggers the bug
2. Capture complete error output and evidence
3. Write a failing test that captures the bug (preferred) or a minimal reproduction script
4. Verify the reproduction is reliable (runs multiple times, consistently fails)

A bug MUST be reproduced before any fix is attempted. If reproduction fails, report what was tried and stop.

### Review

Purpose: Multi-dimensional code review before shipping.

Sequence:
1. Run in parallel: `quality-specialist`, `security-specialist`, `performance-specialist`
2. `product-specialist` -- verify acceptance criteria are met empirically
3. `test-specialist` -- verify test coverage and quality
4. Consolidate findings, ranked by severity

### Monitor

Purpose: Check application health and operational status. Can be invoked standalone or as part of Verify.

Sequence:
1. `ops-specialist` -- health checks, log inspection, error monitoring, performance analysis
2. Report findings, escalate if action needed

## Tracker Entry Point (JIRA or GitHub Issues)

When the request references a tracker ticket (a JIRA key like `PROJ-123`, a JIRA URL, a GitHub issue URL, or an `org/repo#<n>` token):

1. Hand off to the matching vendor agent — `jira-agent` (for JIRA refs) or `github-agent` (for GitHub Issue refs). The configured destination tracker (`.lisa.config.json` `tracker`) is the default when the ref shape is ambiguous.
2. The agent reads the ticket fully via the matching read skill (`jira-read-ticket` / `github-read-issue`) — description / body, comments, attachments, linked issues, parent (Epic / parent sub-issue), siblings.
3. The agent validates ticket quality via the matching verify skill (`jira-verify` / `github-verify`).
4. The agent runs analytical triage via the vendor-neutral `ticket-triage` skill.
5. If triage finds unresolved ambiguities (`BLOCKED` verdict), the agent posts findings and STOPS -- no work begins.
6. The agent determines intent and delegates to the appropriate flow:

| Ticket Type | Flow | Work Type |
|-------------|------|-----------|
| Epic | Plan | -- |
| Story | Implement | Build |
| Task | Implement | Build |
| Bug | Implement | Fix |
| Spike | Implement | Investigate Only |
| Improvement | Implement | Improve |
| Sub-task | Implement | (per parent's intent) |

For JIRA, the type comes from the ticket's issue type. For GitHub, the type comes from the `type:<value>` label.

If the ticket type is ambiguous, read the description / body to classify. A "Task" that describes broken behavior is a Fix. A "Bug" that requests new functionality is a Build.

7. The agent syncs progress at milestones via the matching sync skill (`jira-sync` / `github-sync`).
8. The agent posts evidence at completion via the matching evidence skill (`jira-evidence` / `github-evidence`).

Vendor-neutral callers (e.g., `implement`, `verify`) should invoke the `tracker-*` shims — they dispatch to the right vendor automatically.

## Flow Chaining

Flows can chain naturally:
- Research produces a PRD -- hand it to Plan
- Plan produces work items -- hand each to Implement
- Implement produces verified code -- hand to Verify
- If any flow discovers it lacks what it needs, it stops and suggests the preceding flow

The full lifecycle for a large initiative: Research -> Plan -> Implement (per item) -> Verify (per item).

## Sub-flow Usage

Flows reference sub-flows by name. When a flow says "Investigate sub-flow", execute the full Investigate sub-flow sequence. When it says "Review sub-flow", execute the full Review sequence. Sub-flows can be invoked by any main flow.

## Orchestration

> **Note**: Orchestration authority belongs to lifecycle skills (see `## Orchestration Selection Protocol` above). This section documents the patterns that lifecycle skills implement — it is reference material, not a directive for this rule to choose modes independently.

Lifecycle skills dispatch their agents according to the flow's shape. The following patterns are how they do it — do not default to the heaviest one.

### Agent Teams (default for multi-step flows)

Use an **agent team** (TeamCreate + TaskCreate per step) for:

- **Implement** (Build, Fix, Improve) — long sequences with parallel review and a real risk of compaction
- **Plan** — multiple specialists feeding a shared decomposition
- **Research** — multiple specialists feeding a shared PRD
- Any flow that invokes the **Review sub-flow** (the four review specialists run in parallel and gate a single follow-up task)

Why: these flows have enough steps that context compaction is likely; the Review sub-flow is parallel-by-design and `blockedBy` expresses that cleanly; durable task state lets the team lead recover assignments after compaction.

When using a team:

1. Create one team per top-level flow invocation. Do not nest teams for sub-flows — sub-flow steps become tasks within the existing team.
2. Express parallelism with `blockedBy`. The Review sub-flow's four specialists are independent; the "implement valid suggestions" task is `blockedBy` all four.
3. On every TaskUpdate that sets `owner`, also store it in `metadata.owner` so the assignment survives context compaction.
4. Re-read TaskList after any compaction event before assigning new work.

### One-shot Sub-agents (for short or single-agent flows)

Use direct `Agent` tool invocations (no team) for:

- **Verify** when run standalone — it's a linear gate sequence with no parallelism
- **Monitor** standalone — single specialist (`ops-specialist`) producing a report
- **Investigate Only** spikes — single investigation, findings out
- Any flow chained as a sub-flow inside a larger team — its agents become tasks in the parent team, not a new team

Why: TeamCreate plus per-step TaskCreate is real overhead. For a one-or-two-agent flow with no parallelism, the bookkeeping cost outweighs the recovery and orchestration benefits.

### When in doubt

If the flow has more than three agent steps, or any parallel step, or is likely to span a compaction boundary, use a team. Otherwise, sub-agents are fine.

# Intent Routing

Classify the user's request and execute the matching flow. Each flow is a sequence of agents. Sub-flows can be invoked by any flow.

## Flows

### Fix
When: Bug reports, broken behavior, error messages, JIRA bug tickets.

Sequence:
1. `git-history-analyzer` — understand why affected code exists, find related past fixes/reverts
2. `debug-specialist` — reproduce the bug, prove root cause with evidence
3. `architecture-specialist` — assess fix risk, identify files to change, check for ripple effects
4. `test-specialist` — design regression test strategy
5. `bug-fixer` — implement fix via TDD (reproduction becomes failing test)
6. **Verify sub-flow**
7. **Ship sub-flow**
8. `learner` — capture discoveries for future sessions

### Build
When: New features, stories, tasks, JIRA story/task tickets.

Sequence:
1. `product-specialist` — define acceptance criteria, user flows, error states
2. `architecture-specialist` — research codebase, design approach, map dependencies
3. `test-specialist` — design test strategy (coverage, edge cases, TDD sequence)
4. `builder` — implement via TDD (acceptance criteria become tests)
5. **Verify sub-flow**
6. **Review sub-flow**
7. **Ship sub-flow**
8. `learner` — capture discoveries

### Investigate
When: "Why is this happening?", triage requests, JIRA spike tickets.

Sequence:
1. `git-history-analyzer` — understand code evolution, find related changes
2. `debug-specialist` — reproduce, trace execution, prove root cause
3. `ops-specialist` — check logs, errors, health (if runtime issue)
4. Report findings with evidence, recommend next action (Fix, Build, or escalate)

### Plan
When: "Break this down", epic planning, large scope work, JIRA epic tickets.

Sequence:
1. `product-specialist` — define acceptance criteria for the whole scope
2. `architecture-specialist` — understand scope, map dependencies, identify cross-cutting concerns
3. Break down into ordered tasks, each with: acceptance criteria, verification type, dependencies

### Ship
When: Code is ready to deploy. Used as a sub-flow by Fix, Build, and Improve.

Sequence:
1. Commit — atomic conventional commits via `git-commit` skill
2. PR — create/update pull request via `git-submit-pr` skill
3. **Review sub-flow** (if not already done)
4. PR Watch Loop (repeat until mergeable):
   - If status checks fail → fix and push
   - If merge conflicts → resolve and push
   - If bot review feedback (CodeRabbit, etc.):
     - Valid feedback → implement fix, push, resolve comment
     - Invalid feedback → reply explaining why, resolve comment
   - Repeat until all checks pass and all comments are resolved
5. Merge the PR
6. `ops-specialist` — deploy to target environment
7. `verification-specialist` — post-deploy health check and smoke test
8. `ops-specialist` — monitor for errors in first minutes

### Review
When: Code review requests, PR review, quality assessment. Used as a sub-flow by Build.

Sequence:
1. Run in parallel: `quality-specialist`, `security-specialist`, `performance-specialist`
2. `product-specialist` — verify acceptance criteria are met empirically
3. `test-specialist` — verify test coverage and quality
4. Consolidate findings, ranked by severity

### Improve
When: Refactoring, optimization, coverage improvement, complexity reduction.

Sequence:
1. `architecture-specialist` — identify target, measure baseline, plan approach
2. `test-specialist` — ensure existing test coverage before refactoring (safety net)
3. `builder` — implement improvements via TDD
4. `verification-specialist` — measure again, prove improvement
5. **Ship sub-flow**
6. `learner` — capture discoveries

### Monitor
When: "Check the logs", "Any errors?", health checks, production monitoring.

Sequence:
1. `ops-specialist` — health checks, log inspection, error monitoring, performance analysis
2. Report findings, escalate if action needed

## JIRA Entry Point

When the request references a JIRA ticket (ticket ID like PROJ-123 or a JIRA URL):

1. Hand off to `jira-agent`
2. `jira-agent` reads the ticket, validates quality, determines intent
3. `jira-agent` delegates to the appropriate flow above
4. `jira-agent` syncs progress at milestones and posts evidence at completion

## Sub-flow Usage

Flows reference sub-flows by name. When a flow says "Ship sub-flow", execute the full Ship sequence. When it says "Review sub-flow", execute the full Review sequence. Sub-flows can be nested (e.g., Ship includes Review).

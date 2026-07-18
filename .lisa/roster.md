# Lisa Implement Roster Decision

Work item: queue campaign starting `CodySwannGT/lisa#1546`
Plan: `implement-ready-queue-1546`
Runtime: Cursor (Task tool specialists)
Recorded: 2026-07-18T20:55:00Z

## Queue (status:ready)

1. #1546 Wire the top-bar version status to the existing npm update check
2. #1545 Detect connected observability providers
3. #1544 Populate the automations section from the harness scheduler
4. #1543 Populate the GitHub repository panel from live gh api reads
5. #1542 Compute deploy pipeline stages from deploy.yml and github.environments
6. #1541 Compute the CI quality-jobs Active column from ci.yml
7. #1540 Wire the plugins & MCP section to .claude/settings.json enabledPlugins

SKIP this session: #1539 (status:in-progress, other branch). BLOCKED/human-needed and unlabeled self-hardening issues are out of the formal ready queue.

## Base branch assumption

Ticket #1546 names target environment `dev` (local-only UI on 127.0.0.1). `.lisa.config.json` `deploy.branches` only maps `production → main`. Interpreting `dev` as local verification (not a missing deploy branch); PR base = remote default `main`.

## Runtime agent inventory

INCLUDE|EXCLUDE - agent type - reason

INCLUDE - generalPurpose - Explore/research equivalent; plan naming, branch sync, task planning when no narrower specialist fits
INCLUDE - architecture-specialist - design approach, file map, reuse of checkVersion / live-status probe
INCLUDE - builder - TDD implementation of #1546 and subsequent ready items
INCLUDE - test-specialist - unit + Playwright regression for version status surface
INCLUDE - product-specialist - acceptance criteria / Validation Journey alignment
INCLUDE - verification-specialist - local empirical proof + verification-status.json
INCLUDE - quality-specialist - correctness / coverage / philosophy review
INCLUDE - code-reviewer - PR-oriented code review before merge drive
INCLUDE - code-simplifier - clarify recently modified code after green tests
INCLUDE - security-specialist - threat pass on live probe / npm registry reads
INCLUDE - learner - post-task learnings review (required by implement skill)
INCLUDE - github-agent - claim/sync issue labels, PR linkage, done transitions between queue items
INCLUDE - debug-specialist - only if reproduction or verification fails
INCLUDE - performance-specialist - only if version probe or UI polling shows latency issues
INCLUDE - spec-conformance-specialist - verify shipped work matches ticket AC before done
EXCLUDE - bug-fixer - work type is Build, not Fix; builder covers TDD
EXCLUDE - bugbot - only when explicitly requested
EXCLUDE - security-review - only when explicitly requested; security-specialist covers inline
EXCLUDE - best-of-n-runner - no parallel experiment need
EXCLUDE - cursor-guide - not a Cursor product question
EXCLUDE - *-prd-intake / *-build-intake - this is implement, not intake
EXCLUDE - jira-agent / linear-agent / confluence-* / notion-* - tracker is github
EXCLUDE - pr-mining-specialist / tracker-mining-specialist / learnings-synthesizer - debrief-only
EXCLUDE - skill-evaluator - no new skill authoring in this flow
EXCLUDE - git-history-analyzer - architecture-specialist + generalPurpose cover needed history

## Effective completion (queue)

Queue is clean when `gh issue list --label status:ready --state open` returns zero issues (or only items that transitioned to blocked with human_needed / linked dependency). Per-issue: verification-status.json all-pass, PR merged to main, tracker sync to env-keyed done.

---

Work item: `CodySwannGT/lisa#1539` — plan: `wire-stacks-detector-registry-1539`

Runtime: Claude Code implicit-team model (Agent tool). No shared task-list tool in this runtime (TaskCreate/TaskList absent) — task plan persisted in `.lisa/plan-1539.md`; verification verdict in `.lisa/verification-status.json`.

- `INCLUDE - Explore - read-only research; already served as the bounded input-resolver for this flow.`
- `INCLUDE - lisa:builder - owns the TDD implementation of the detected-stacks probe + UI wiring (Build work type).`
- `INCLUDE - lisa:test-specialist - authors the Playwright regression spec codifying the validation journey, alongside unit tests.`
- `INCLUDE - lisa:product-specialist - reviews behavior against the Gherkin AC from the user's perspective (parallel review lane).`
- `INCLUDE - lisa:quality-specialist - coding-philosophy/correctness review (parallel review lane).`
- `INCLUDE - coderabbit:code-reviewer - CodeRabbit review lane per the project review-parallelization rule.`
- `INCLUDE - lisa:spec-conformance-specialist - verifies shipped work matches the spec exactly (AC, Out of Scope, journey assertions).`
- `INCLUDE - lisa:verification-specialist - independent empirical verification (live browser journey, doctor agreement) + writes verification-status.json; never the implementer.`
- `INCLUDE - lisa:learner - collects and routes task learnings before team shutdown.`
- `INCLUDE - general-purpose - fallback for bounded mechanical chores only when no specialist fits; not a build lane.`
- `EXCLUDE - lisa:architecture-specialist - design fully pinned by the ticket + shipped #1537 probe contract; no open architectural decision.`
- `EXCLUDE - lisa:security-specialist - no new external input surface: /api/status pre-exists; new probe reads local filesystem only, loopback-bound.`
- `EXCLUDE - lisa:performance-specialist - bounded 5s-timeout filesystem probe already used by lisa doctor; no perf-sensitive path.`
- `EXCLUDE - lisa:debug-specialist / lisa:bug-fixer - Build flow, not Fix; no bug to reproduce.`
- `EXCLUDE - lisa:git-history-analyzer - relationship search already documented in the ticket and re-verified at triage.`
- `EXCLUDE - lisa:github-agent - its lifecycle is already running in this lead session via intake dispatch; spawning it would nest lifecycles.`
- `EXCLUDE - lisa:jira-agent / lisa:linear-agent - wrong tracker (tracker=github).`
- `EXCLUDE - lisa:*-build-intake / lisa:*-prd-intake - queue scanners, not per-item workers; the item is already claimed.`
- `EXCLUDE - lisa:learnings-synthesizer / lisa:pr-mining-specialist / lisa:tracker-mining-specialist - Debrief-flow agents, out of scope for a build ticket.`
- `EXCLUDE - lisa:skill-evaluator - reached through the learner flow, not a team lane.`
- `EXCLUDE - code-simplifier:code-simplifier - small change; quality-specialist + CodeRabbit cover simplification.`
- `EXCLUDE - claude-code-guide / hookify:conversation-analyzer / statusline-setup - unrelated utilities.`
- `EXCLUDE - claude - generic catch-all; specific specialists selected.`
- `EXCLUDE - Plan - decomposition exists; this IS the leaf work item.`

Base-branch resolution (recorded assumption): ticket env is `dev — local only; there is no deployed environment for this surface`. Merged `deploy.branches` maps only `production → main` (single-env repo; the npm release IS the deploy). Surface has no deployable environment → base = remote default `main` per the no-environment fallback. PR targets `main`.

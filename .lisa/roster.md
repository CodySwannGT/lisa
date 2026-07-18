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

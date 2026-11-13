# Roster Decision — CodySwannGT/lisa#4809

Plan: session-manager-other-cyclers. Work type: Implement / Build (Task). Base: main (Assumption: production — remote default branch main; Branch Plan matches).

INCLUDE - Explore - required read-only research agent; maps cli-status/ledger/cycle code and the #4496 tests before building.
INCLUDE - lisa:builder - implements the AC via TDD (ledger cyclers record, status otherCyclers, SKILL.md branch).
INCLUDE - lisa:verification-specialist - independent empirical verification of the Validation Journey (CLI output) and the v2 verdict.
INCLUDE - lisa:learner - captures task MLD into the learnings ledger.
EXCLUDE - general-purpose - specific specialists cover every task.
EXCLUDE - claude - catch-all; specific specialists fit.
EXCLUDE - Plan - scope is small and the issue's Technical Approach already names files and design.
EXCLUDE - lisa:architecture-specialist - design is fully specified in the issue.
EXCLUDE - lisa:test-specialist - builder owns TDD for two named test files; small surface.
EXCLUDE - lisa:quality-specialist - code review runs through lisa-git-submit-pr's local review and CI.
EXCLUDE - lisa:product-specialist - no UI; the AC Gherkin is already authored.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist covers the AC matrix for a 4-scenario item.
EXCLUDE - lisa:security-specialist - no auth/secret surface; identity explicitly excludes env/credentials.
EXCLUDE - lisa:performance-specialist - trivial ledger write per cycle.
EXCLUDE - lisa:bug-fixer - Build, not Fix.
EXCLUDE - lisa:debug-specialist - no defect to diagnose.
EXCLUDE - lisa:github-agent - lead handles tracker sync via skills.
EXCLUDE - lisa:eval-specialist, lisa:git-history-analyzer, lisa:learning-judge, lisa:learnings-synthesizer, lisa:skill-evaluator, lisa:pr-mining-specialist, lisa:tracker-mining-specialist - debrief/learnings-routing roles, not build roles.
EXCLUDE - lisa:*-prd-intake, lisa:*-build-intake, lisa:jira-agent, lisa:linear-agent - intake/other-tracker roles.
EXCLUDE - claude-code-guide, statusline-setup, web-fetch, hookify:conversation-analyzer, code-simplifier:code-simplifier - unrelated utility roles.

## Tool access preflight
- gh (GitHub tracker/PR): `gh issue view 4809` — pass.
- tmux (Validation Journey): probe at verification — required for manager.self.
- No other external system.

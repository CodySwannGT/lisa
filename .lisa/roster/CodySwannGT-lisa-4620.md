# Roster Decision — CodySwannGT/lisa#4620

Plan: `4620-manual-ci-pr-only-checks` — Fix (bug): the skipped-required-checks outcome guard
fails manual/push/schedule CI runs on jobs that only run for pull requests.

INCLUDE - Explore - Mandatory read-only research: locate current line numbers (issue cites a stale snapshot), the guard's env wiring, Notes 16/17, and the tests to extend.
INCLUDE - lisa:bug-fixer - Fix flow: reproduce as failing unit + wiring tests (RED), then implement the event-aware exemption (GREEN).
INCLUDE - lisa:quality-specialist - Independent review of correctness, fail-closed behaviour and test quality of the guard change.
INCLUDE - lisa:verification-specialist - Independent (non-implementer) empirical verification and the v2 verdict; post-merge manual ci.yml run on main.
INCLUDE - lisa:learner - Capture task MLD learnings to the ledger.
EXCLUDE - general-purpose - Lead-session planning steps only; every delegated task has a more specific specialist.
EXCLUDE - claude - Catch-all; specific specialists cover every task.
EXCLUDE - claude-code-guide - No Claude Code/API product question involved.
EXCLUDE - code-simplifier:code-simplifier - Small, targeted guard change; quality-specialist review covers simplification.
EXCLUDE - hookify:conversation-analyzer - Not analysing transcripts for hooks.
EXCLUDE - lisa:architecture-specialist - Technical Approach in the ticket already names files, env vars and the rule; no design work left.
EXCLUDE - lisa:builder - Bug, not a feature build; bug-fixer owns TDD.
EXCLUDE - lisa:debug-specialist - Root cause is already proven in the ticket (offline repro via inspectOutcomes); bug-fixer re-proves it RED.
EXCLUDE - lisa:test-specialist - Test cases are enumerated by the ticket (5 unit cases + bidirectional wiring check); bug-fixer writes them, quality-specialist reviews.
EXCLUDE - lisa:product-specialist - Gherkin AC already present; no UX surface.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the 6 scenarios + Out of Scope directly; small scope.
EXCLUDE - lisa:security-specialist - No auth/secrets/input surface; the change narrows nothing security-relevant (PR events stay fail-closed).
EXCLUDE - lisa:performance-specialist - No performance dimension.
EXCLUDE - lisa:eval-specialist - Not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Ticket already cites the relevant commits (#4136 e7f8fb3a91, #4146 181edaf047).
EXCLUDE - lisa:github-agent / lisa:jira-agent / lisa:linear-agent - Lifecycle is run by this lead via lisa-implement.
EXCLUDE - lisa:*-build-intake / lisa:*-prd-intake (github, jira, linear, notion, confluence) - Intake cycles, not this flow.
EXCLUDE - lisa:learning-judge / lisa:skill-evaluator / lisa:learnings-synthesizer - Invoked downstream by persist-learning/gardener, not directly here.
EXCLUDE - lisa:pr-mining-specialist / lisa:tracker-mining-specialist - Debrief flow only.
EXCLUDE - Plan - Ticket's Technical Approach is the plan.
EXCLUDE - statusline-setup - Unrelated.
EXCLUDE - web-fetch - No external pages needed.

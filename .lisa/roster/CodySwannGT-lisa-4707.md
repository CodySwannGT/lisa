# Roster Decision — CodySwannGT/lisa#4707

Plan: ci-marker-supersession. Work type: Implement / Build (sub-task: script + prose + tests; no UI surface).
Base: main (Assumption: production — remote default branch main; Branch Plan matches recomputation).

INCLUDE - lisa:github-agent - Bounded input-resolver: resolved, claimed (reused) and bound the GitHub leaf.
INCLUDE - Explore - Mandatory read-only research of route helper, producer predicate, fixtures and prose.
INCLUDE - lisa:builder - Implements the predicate change via TDD across producer, helper, prose and fixtures.
INCLUDE - lisa:quality-specialist - Independent review of correctness and parity across the four surfaces.
INCLUDE - lisa:security-specialist - The change is a trust boundary (untrusted public commenters suppressing CI rework).
INCLUDE - lisa:verification-specialist - Independent empirical verification and the v2 verdict.
INCLUDE - lisa:learner - Captures task MLD to the ledger.
EXCLUDE - claude - Catch-all; specific specialists cover every task.
EXCLUDE - claude-code-guide - No Claude Code product question.
EXCLUDE - code-simplifier:code-simplifier - Small change; quality-specialist covers simplification.
EXCLUDE - general-purpose - Lead-session helper steps done by the lead; no worker needs a generic agent.
EXCLUDE - hookify:conversation-analyzer - No transcript analysis.
EXCLUDE - lisa:architecture-specialist - Technical approach fully specified in the item.
EXCLUDE - lisa:bug-fixer - Build flow; builder covers TDD.
EXCLUDE - lisa:confluence-prd-intake - No PRD intake.
EXCLUDE - lisa:debug-specialist - No defect of unknown cause.
EXCLUDE - lisa:eval-specialist - Not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the #4607/#4677 history needed.
EXCLUDE - lisa:github-build-intake - Not a batch intake cycle.
EXCLUDE - lisa:github-prd-intake - No PRD intake.
EXCLUDE - lisa:jira-agent - Tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - Tracker is GitHub.
EXCLUDE - lisa:learning-judge - Runs inside persist-learning only if a candidate arises.
EXCLUDE - lisa:learnings-synthesizer - Debrief-only.
EXCLUDE - lisa:linear-agent - Tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - Tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - No PRD intake.
EXCLUDE - lisa:notion-prd-intake - No PRD intake.
EXCLUDE - lisa:performance-specialist - Comment-list scan; no performance surface.
EXCLUDE - lisa:pr-mining-specialist - Debrief-only.
EXCLUDE - lisa:product-specialist - No user-facing UX; ACs already Gherkin.
EXCLUDE - lisa:skill-evaluator - No learning routing decision.
EXCLUDE - lisa:spec-conformance-specialist - Three scenarios; verification-specialist checks them directly.
EXCLUDE - lisa:test-specialist - Builder writes the fixtures the item prescribes.
EXCLUDE - lisa:tracker-mining-specialist - Debrief-only.
EXCLUDE - statusline-setup - Unrelated.
EXCLUDE - web-fetch - No public page needed.
EXCLUDE - Plan - Approach specified.

Tool access preflight: GitHub via gh — pass (live read + claim succeeded). No other external tool
needed; verification is local CLI + test runs.

Completion condition: `node scripts/lisa-ci-rework-route.mjs --item 1 --payload <fixture>` prints
route `ci-rework` for claim-after-marker and for a new untrusted-later-marker fixture, and still prints
`implement` / `not-newest` for a trusted non-claim later marker; the producer predicate in
`scripts/lisa-ci-failure-redispatch.mjs` gives the same answer on every fixture. Constraint: no other
existing route fixture changes its result.

# Roster Decision — CodySwannGT/lisa#4598 (Shard Lisa's own unit-test CI job)

Flow: Implement / Improve (CI caller-workflow config only; `runtime_behavior_change = false`, config-only).
Scope: one `with:` input added to `.github/workflows/ci.yml`. Verification is this PR's own CI run.

- INCLUDE - general-purpose - Used as the bounded input-resolver (issue read) and for lead-session planning steps the skill assigns to it.
- INCLUDE - Explore - Mandatory read-only research: located `unit_test_shards` in quality.yml, the shard tests, and ci.yml's `quality` caller job.
- INCLUDE - lisa:verification-specialist - Independent verifier of the PR's CI run timing and the required-check conclusion; writes the verdict.
- INCLUDE - lisa:learner - Captures task MLD to the ledger at the end of the flow.
- EXCLUDE - claude - Generic catch-all; general-purpose already covers it.
- EXCLUDE - claude-code-guide - No Claude Code product question involved.
- EXCLUDE - code-simplifier:code-simplifier - A one-line YAML input has nothing to simplify.
- EXCLUDE - hookify:conversation-analyzer - Not analysing transcripts for hooks.
- EXCLUDE - lisa:architecture-specialist - Ticket prescribes the exact change; no design decision remains.
- EXCLUDE - lisa:bug-fixer - Not a bug.
- EXCLUDE - lisa:builder - The change is a single prescribed input; the lead applies it directly with no code to TDD.
- EXCLUDE - lisa:confluence-prd-intake - Not PRD intake.
- EXCLUDE - lisa:debug-specialist - No defect to diagnose.
- EXCLUDE - lisa:eval-specialist - Not measuring the factory's task suite.
- EXCLUDE - lisa:git-history-analyzer - The ticket's Relationship Search already covers ci.yml history.
- EXCLUDE - lisa:github-agent - Lifecycle is run by this lead via lisa-implement directly.
- EXCLUDE - lisa:github-build-intake - Not an intake cycle.
- EXCLUDE - lisa:github-prd-intake - Not PRD intake.
- EXCLUDE - lisa:jira-agent - Tracker is GitHub.
- EXCLUDE - lisa:jira-build-intake - Tracker is GitHub.
- EXCLUDE - lisa:learnings-synthesizer - Debrief-only.
- EXCLUDE - lisa:linear-agent - Tracker is GitHub.
- EXCLUDE - lisa:linear-build-intake - Tracker is GitHub.
- EXCLUDE - lisa:linear-prd-intake - Tracker is GitHub.
- EXCLUDE - lisa:notion-prd-intake - Not PRD intake.
- EXCLUDE - lisa:performance-specialist - The performance claim is CI wall-clock, measured directly from the run by the verification-specialist.
- EXCLUDE - lisa:pr-mining-specialist - Debrief-only.
- EXCLUDE - lisa:product-specialist - No user-facing surface.
- EXCLUDE - lisa:quality-specialist - A one-line YAML input; code review runs through lisa-git-submit-pr's local review.
- EXCLUDE - lisa:security-specialist - No secrets, permissions, or auth surface changes.
- EXCLUDE - lisa:skill-evaluator - No learning routing needed.
- EXCLUDE - lisa:spec-conformance-specialist - Three Gherkin scenarios map one-to-one onto the verification-specialist's checks.
- EXCLUDE - lisa:test-specialist - Coverage scenario is pinned by existing tests/integration/quality-unit-test-shards.test.ts per the ticket; no new test is required.
- EXCLUDE - lisa:tracker-mining-specialist - Debrief-only.
- EXCLUDE - lisa:learning-judge - Invoked by the learner if needed.
- EXCLUDE - Plan - No planning is left open.
- EXCLUDE - statusline-setup - Unrelated.

Blocker note: #4591 (A1) is open and marked human-needed. The ticket's Technical Approach covers its absence ("Otherwise keep 4"), and `scripts/test-timing-report.mjs` is not on origin/main, so the shard count is 4.
Regression-spec exit 1: no e2e harness applies to a CI caller-workflow input. The PR's own CI run is the observation.

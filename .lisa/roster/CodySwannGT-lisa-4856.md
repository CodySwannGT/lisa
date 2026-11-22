# Roster Decision — CodySwannGT/lisa#4856

Work item: CodySwannGT/lisa#4856 — Narrow post-evidence.sh cross-release link refusal and check it before upload
Work type: Implement / Fix (type:Bug). Leaf, single repository. Base branch: main (Target Backend Environment: production via deploy.branches; Branch Plan matches).
Branch: claude/4856-narrow-evidence-link-refusal

INCLUDE - Explore - Mandatory read-only researcher; maps post-evidence.sh, its three stack copies, the existing jira-evidence integration harness, and the two documentation files.
INCLUDE - lisa:bug-fixer - Fix flow owner: reproduces the over-strict refusal and the upload-before-refusal ordering as failing integration tests, then fixes via TDD.
INCLUDE - lisa:quality-specialist - Independent review of the shell change, test meaningfulness, and stack-copy parity.
INCLUDE - lisa:verification-specialist - Independent empirical verification (runs the real script with stubbed gh) and writes the v2 verdict; did not implement.
INCLUDE - lisa:learner - Captures task MLD into the learnings ledger.
INCLUDE - general-purpose - Lead-session planning helper only (plan name, base branch, completion condition) as the skill prescribes; no more specific agent owns those steps.
EXCLUDE - claude - Generic catch-all; the specific specialists above cover every step.
EXCLUDE - claude-code-guide - No question about Claude Code/SDK features.
EXCLUDE - code-simplifier:code-simplifier - Change is a narrow guard reorder; quality-specialist covers simplification.
EXCLUDE - hookify:conversation-analyzer - Not analyzing transcripts for hooks.
EXCLUDE - lisa:architecture-specialist - No design decision beyond what the ticket's Technical Approach already prescribes.
EXCLUDE - lisa:builder - This is a Fix; bug-fixer owns TDD.
EXCLUDE - lisa:confluence-prd-intake - Not PRD intake.
EXCLUDE - lisa:debug-specialist - Cause is already established by the ticket (deterministic script logic at known lines).
EXCLUDE - lisa:eval-specialist - Not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - History of interest is a single merged PR (#4843) the Explore pass covers.
EXCLUDE - lisa:github-agent - Lifecycle is run by the lead via this skill; already used as the input-resolver.
EXCLUDE - lisa:github-build-intake - Not an intake cycle.
EXCLUDE - lisa:github-prd-intake - Not PRD intake.
EXCLUDE - lisa:jira-agent - Tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - Not an intake cycle.
EXCLUDE - lisa:learning-judge - Invoked inside persist-learning only if a candidate arises.
EXCLUDE - lisa:learnings-synthesizer - Debrief-only.
EXCLUDE - lisa:linear-agent - Tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - Not an intake cycle.
EXCLUDE - lisa:linear-prd-intake - Not PRD intake.
EXCLUDE - lisa:notion-prd-intake - Not PRD intake.
EXCLUDE - lisa:performance-specialist - No performance surface (prune cost explicitly Out of Scope).
EXCLUDE - lisa:pr-mining-specialist - Debrief-only.
EXCLUDE - lisa:product-specialist - No UI/UX surface; acceptance criteria already in Gherkin.
EXCLUDE - lisa:security-specialist - Change narrows a link check; no auth/secret/input-trust surface added. quality-specialist reviews for regressions.
EXCLUDE - lisa:skill-evaluator - Advisory routing for learnings; not needed.
EXCLUDE - lisa:spec-conformance-specialist - Five Gherkin scenarios map 1:1 to tests; verification-specialist covers the coverage matrix.
EXCLUDE - lisa:test-specialist - bug-fixer writes the tests in the existing harness; quality-specialist reviews them.
EXCLUDE - lisa:tracker-mining-specialist - Debrief-only.
EXCLUDE - Plan - Plan is fully prescribed by the ticket.
EXCLUDE - statusline-setup - Unrelated.
EXCLUDE - web-fetch - No public web page needed.

# Roster Decision — CodySwannGT/lisa#4722

Plan: session-manager orphan and hold sweep. Flow: Implement / Build (skill instructions plus a deterministic planner subcommand).

INCLUDE - lisa:github-agent - Bounded input resolver; it resolved, claimed and bound the GitHub leaf.
INCLUDE - Explore - Required read-only research: the session-manager scripts, the blocked-plan/overruled-plan planners, tests, generated plugin copies, and human-gate history (#4661).
INCLUDE - lisa:builder - Implements the orphan/hold planner subcommand and the SKILL.md Reconcile sub-step via TDD.
INCLUDE - lisa:quality-specialist - Independent review of correctness, coding philosophy, and test quality on the diff.
INCLUDE - lisa:verification-specialist - Independent empirical verification: runs the new CLI subcommand against fixtures and writes the v2 verdict.
INCLUDE - lisa:learner - Captures task MLD learnings to the ledger.
EXCLUDE - general-purpose - Specific specialists cover every role; no fallback is needed.
EXCLUDE - claude - Catch-all; specific specialists cover every role.
EXCLUDE - claude-code-guide - No Claude Code product questions here.
EXCLUDE - code-simplifier:code-simplifier - The quality review covers simplification for a small diff.
EXCLUDE - hookify:conversation-analyzer - No hook authoring requested.
EXCLUDE - Plan - The architecture is small and set by the existing planner pattern; Explore plus the builder suffice.
EXCLUDE - lisa:architecture-specialist - Follows the established *-plan subcommand pattern; no new architecture.
EXCLUDE - lisa:bug-fixer - Build, not Fix.
EXCLUDE - lisa:debug-specialist - No defect to root-cause.
EXCLUDE - lisa:eval-specialist - Not measuring the factory suite.
EXCLUDE - lisa:git-history-analyzer - Explore covers the relevant history (#4661, #4657) for this scope.
EXCLUDE - lisa:jira-agent - The tracker is GitHub.
EXCLUDE - lisa:linear-agent - The tracker is GitHub.
EXCLUDE - lisa:confluence-prd-intake - Not PRD intake.
EXCLUDE - lisa:notion-prd-intake - Not PRD intake.
EXCLUDE - lisa:github-prd-intake - Not PRD intake.
EXCLUDE - lisa:linear-prd-intake - Not PRD intake.
EXCLUDE - lisa:github-build-intake - Not a batch intake cycle.
EXCLUDE - lisa:jira-build-intake - Not a batch intake cycle.
EXCLUDE - lisa:linear-build-intake - Not a batch intake cycle.
EXCLUDE - lisa:learning-judge - Routing is the learner's and gardener's job.
EXCLUDE - lisa:skill-evaluator - Advisory routing is not needed here.
EXCLUDE - lisa:learnings-synthesizer - Debrief-only role.
EXCLUDE - lisa:performance-specialist - No hot path; a bounded, capped planner.
EXCLUDE - lisa:pr-mining-specialist - Debrief-only role.
EXCLUDE - lisa:tracker-mining-specialist - Debrief-only role.
EXCLUDE - lisa:product-specialist - No UI; the quality and verification review covers operator-facing text.
EXCLUDE - lisa:security-specialist - No new trust boundary; hold release reuses the existing trustedAuthorIds/blocked-plan authority, and the quality review checks that this authority is not widened.
EXCLUDE - lisa:spec-conformance-specialist - The verification-specialist checks the three ACs directly for this small item.
EXCLUDE - lisa:test-specialist - The builder does TDD; the quality-specialist reviews the tests.
EXCLUDE - statusline-setup - Unrelated.

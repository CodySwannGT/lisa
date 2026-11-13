# Roster Decision — CodySwannGT/lisa#4838

Plan: 4838-evidence-release-overflow. Flow: Implement / Fix (Bug). Base: main (production, per Branch Plan — Match).

INCLUDE - Explore - mandatory read-only research of publisher, validator, evidence-release resolution and their tests.
INCLUDE - lisa:github-agent - bounded input-resolver (lisa-track resolve/claim/bind).
INCLUDE - lisa:bug-fixer - Bug: reproduce as failing unit test, fix via TDD (pin honored + overflow roll-over).
INCLUDE - lisa:test-specialist - test matrix for pin / overflow / old-proof validation (folded into bug-fixer brief; spawned only if coverage gaps appear).
INCLUDE - lisa:quality-specialist - independent review of the diff.
INCLUDE - lisa:verification-specialist - independent empirical verification and v2 verdict.
INCLUDE - lisa:learner - capture task learnings to the ledger.
INCLUDE - general-purpose - lead-session planning steps prescribed by the skill (performed inline by lead; trivially small).
EXCLUDE - lisa:architecture-specialist - cause and approach are specified to the line in the issue.
EXCLUDE - lisa:debug-specialist - root cause already confirmed on origin/main 24d0d26b34 (lines 101/103/280).
EXCLUDE - lisa:security-specialist - no auth/secret/input-trust surface changes.
EXCLUDE - lisa:performance-specialist - no hot path.
EXCLUDE - lisa:product-specialist - CLI-only, no UX surface.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist covers AC conformance for this small bug.
EXCLUDE - lisa:builder - superseded by bug-fixer for a Bug.
EXCLUDE - lisa:jira-agent, lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:*-build-intake, lisa:*-prd-intake - not an intake cycle.
EXCLUDE - lisa:tracker-mining-specialist, lisa:pr-mining-specialist, lisa:learnings-synthesizer - Debrief only.
EXCLUDE - lisa:learning-judge, lisa:skill-evaluator - invoked through persist-learning/gardener only.
EXCLUDE - lisa:eval-specialist - measures the factory, not this change.
EXCLUDE - lisa:git-history-analyzer - history already summarized in the issue's Relationship Search.
EXCLUDE - Plan - plan is in the issue.
EXCLUDE - claude, claude-code-guide, code-simplifier:code-simplifier, hookify:conversation-analyzer, statusline-setup, web-fetch - not relevant.

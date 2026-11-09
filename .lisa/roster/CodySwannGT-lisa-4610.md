# Roster Decision — CodySwannGT/lisa#4610

Plan: `4610-merge-regression-files`: merge one-off `#NNNN` regression test files into their module's primary test file. This is Improve work, test-only, with no runtime behavior change.

INCLUDE - lisa:github-agent - Bounded input-resolver: read the GitHub leaf, confirmed the existing claim (reused) and bound it to this worktree.
INCLUDE - Explore - Required read-only research: find candidates, match each to its primary file, and find CI path pins.
INCLUDE - lisa:test-specialist - Owns the merge pass: moves cases without weakening any assertion and deduplicates setup.
INCLUDE - lisa:quality-specialist - Independently reviews that no assertion or issue reference was lost and that merged files stay coherent.
INCLUDE - lisa:verification-specialist - Independently verifies before/after counts and the Vitest summary line, and writes the v2 verdict.
INCLUDE - lisa:learner - Captures each task's mistakes, learnings and desires in the learnings ledger.
EXCLUDE - general-purpose - The specialists above cover every task, so no fallback is needed.
EXCLUDE - claude - Catch-all; the specialists above fit.
EXCLUDE - claude-code-guide - No Claude Code product questions.
EXCLUDE - Plan - The issue's Technical Approach already specifies the approach.
EXCLUDE - statusline-setup - Unrelated.
EXCLUDE - code-simplifier:code-simplifier - It reshapes code; this change must only move tests, not reshape them.
EXCLUDE - hookify:conversation-analyzer - No transcript analysis.
EXCLUDE - lisa:architecture-specialist - Mechanical consolidation with no design decision.
EXCLUDE - lisa:bug-fixer - Not a Fix.
EXCLUDE - lisa:builder - Not a Build.
EXCLUDE - lisa:debug-specialist - No defect to diagnose.
EXCLUDE - lisa:eval-specialist - Not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the history this change needs.
EXCLUDE - lisa:performance-specialist - The Vitest summary line in verification measures the overhead directly.
EXCLUDE - lisa:product-specialist - No user-visible surface.
EXCLUDE - lisa:security-specialist - Test-only change with no security surface.
EXCLUDE - lisa:spec-conformance-specialist - The quality and verification specialists cover the five test-only acceptance scenarios.
EXCLUDE - lisa:jira-agent, lisa:linear-agent - Wrong tracker.
EXCLUDE - lisa:github-build-intake, lisa:jira-build-intake, lisa:linear-build-intake - Not an intake cycle.
EXCLUDE - lisa:github-prd-intake, lisa:notion-prd-intake, lisa:confluence-prd-intake, lisa:linear-prd-intake - Not PRD intake.
EXCLUDE - lisa:learning-judge, lisa:learnings-synthesizer, lisa:skill-evaluator - Learnings gate and gardener roles, not part of this flow.
EXCLUDE - lisa:pr-mining-specialist, lisa:tracker-mining-specialist - Debrief roles.

Target environment: `None — no runtime behavior change: test-only` (exempt from a Branch Plan). Base: remote default branch `main`.
Tool access: GitHub (`gh auth status`). No other external systems.

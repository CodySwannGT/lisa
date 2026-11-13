# Roster Decision — CodySwannGT/lisa#4530

Work type: Fix (bug) — gardener RETIRE rows lack a fingerprint-guarded retire API and a drift check.

INCLUDE - Explore - mandatory read-only research of learnings.ts, the audit skill, and existing tests.
INCLUDE - lisa:bug-fixer - reproduces the missing guard as a failing test, then implements retireLearningEntry via TDD.
INCLUDE - lisa:verification-specialist - independent verification by running the published API against a real ledger; writes the verdict.
INCLUDE - lisa:learner - captures task learnings to the ledger.
INCLUDE - general-purpose - lead-session planning helpers (plan name, base branch, completion condition) per the skill.
INCLUDE - lisa:quality-specialist - reviews correctness, immutability, and test meaningfulness of the new API.
INCLUDE - lisa:spec-conformance-specialist - checks all three proposed-fix requirements are delivered.
EXCLUDE - claude - catch-all; general-purpose covers the helper role.
EXCLUDE - claude-code-guide - no Claude Code product questions.
EXCLUDE - code-simplifier:code-simplifier - small change; quality-specialist covers clarity.
EXCLUDE - hookify:conversation-analyzer - no hook authoring from transcripts.
EXCLUDE - lisa:architecture-specialist - design is prescribed by the issue (mirror confirmLearningEntry).
EXCLUDE - lisa:builder - this is a Fix; bug-fixer owns it.
EXCLUDE - lisa:confluence-prd-intake - no PRD intake.
EXCLUDE - lisa:debug-specialist - root cause is established in the issue; nothing to diagnose.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers history of learnings.ts.
EXCLUDE - lisa:github-agent - used only as the input-resolver; lead runs the lifecycle.
EXCLUDE - lisa:github-build-intake - not an intake cycle.
EXCLUDE - lisa:github-prd-intake - no PRD intake.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - reached only via persist-learning when needed.
EXCLUDE - lisa:learnings-synthesizer - no debrief.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - no PRD intake.
EXCLUDE - lisa:notion-prd-intake - no PRD intake.
EXCLUDE - lisa:performance-specialist - no performance surface.
EXCLUDE - lisa:pr-mining-specialist - no debrief.
EXCLUDE - lisa:product-specialist - no user-visible UI; surface is a library API plus skill prose.
EXCLUDE - lisa:security-specialist - no auth, input, or secret surface; ledger is a local file.
EXCLUDE - lisa:skill-evaluator - not routing a learning.
EXCLUDE - lisa:test-specialist - bug-fixer writes tests; quality-specialist reviews them.
EXCLUDE - lisa:tracker-mining-specialist - no debrief.
EXCLUDE - Plan - plan is prescribed by the issue.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - no external pages needed.

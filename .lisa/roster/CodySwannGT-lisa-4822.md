# Roster Decision — CodySwannGT/lisa#4822

Plan: fix-packaged-apply-isolation-ci
Flow: Implement / Fix (bug). Target env: none — config-only (CI workflow/test fixture); base `main`.

INCLUDE - Explore - mandatory read-only research of fixture, workflow and recent history.
INCLUDE - lisa:debug-specialist - proves the container's real failure cause on the real path (CI/docker).
INCLUDE - lisa:bug-fixer - implements diagnostic surfacing + root-cause fix via reproduce-first.
INCLUDE - lisa:verification-specialist - independent verdict: dispatches the workflow and observes success.
INCLUDE - lisa:learner - captures task MLD to the ledger.
INCLUDE - lisa:quality-specialist - reviews the fixture change for correctness and test meaningfulness.
EXCLUDE - general-purpose - specific specialists cover every task; resolver already done.
EXCLUDE - claude - generic catch-all; specialists cover the work.
EXCLUDE - claude-code-guide - no Claude Code product questions involved.
EXCLUDE - code-simplifier:code-simplifier - change is small; quality-specialist covers clarity.
EXCLUDE - Plan - plan is trivial (surface logs, fix cause); lead records it.
EXCLUDE - hookify:conversation-analyzer - no hook-authoring need.
EXCLUDE - lisa:architecture-specialist - no design change; CI fixture fix.
EXCLUDE - lisa:builder - not a feature build; bug-fixer owns TDD fix.
EXCLUDE - lisa:confluence-prd-intake - not PRD intake.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the narrow window of history (dde99c9970, 4e403971ce).
EXCLUDE - lisa:github-agent - lead already runs the lifecycle for this issue.
EXCLUDE - lisa:github-build-intake - not batch intake.
EXCLUDE - lisa:github-prd-intake - not PRD intake.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - invoked through learner/persist-learning only if a candidate arises.
EXCLUDE - lisa:learnings-synthesizer - debrief-only.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - not PRD intake.
EXCLUDE - lisa:notion-prd-intake - not PRD intake.
EXCLUDE - lisa:performance-specialist - no performance surface.
EXCLUDE - lisa:pr-mining-specialist - debrief-only.
EXCLUDE - lisa:product-specialist - no user-facing product surface; CI check only.
EXCLUDE - lisa:security-specialist - no auth/secret surface changed.
EXCLUDE - lisa:skill-evaluator - no learning routing needed.
EXCLUDE - lisa:spec-conformance-specialist - two Gherkin ACs verified directly by verification-specialist.
EXCLUDE - lisa:test-specialist - fixture IS the test; bug-fixer + quality-specialist cover it.
EXCLUDE - lisa:tracker-mining-specialist - debrief-only.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - gh CLI covers GitHub reads.

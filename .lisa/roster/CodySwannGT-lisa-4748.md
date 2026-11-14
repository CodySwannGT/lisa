# Roster Decision — CodySwannGT/lisa#4748

Work type: Fix (release workflow race orphans the release tag). Scope: `.github/workflows/release-rails.yml` plus a local bare-remote race test.

INCLUDE - Explore - mandatory read-only research: release-rails.yml, its tests, and git history.
INCLUDE - lisa:bug-fixer - reproduces the race as a failing test and implements the fix via TDD.
INCLUDE - lisa:verification-specialist - independent empirical verification and verdict (not the implementer).
INCLUDE - lisa:quality-specialist - reviews correctness and test quality of the workflow change.
INCLUDE - lisa:learner - captures task MLD learnings to the ledger.
INCLUDE - general-purpose - lead-session planning helper (plan name, branch, completion condition) as the skill prescribes.
EXCLUDE - claude - catch-all; more specific specialists cover every task.
EXCLUDE - claude-code-guide - no Claude Code product questions involved.
EXCLUDE - code-simplifier:code-simplifier - small shell-in-YAML fix; quality-specialist covers clarity.
EXCLUDE - hookify:conversation-analyzer - not analyzing transcripts.
EXCLUDE - lisa:architecture-specialist - single-file change with an issue-prescribed design.
EXCLUDE - lisa:builder - this is a Fix; bug-fixer owns it.
EXCLUDE - lisa:confluence-prd-intake - no PRD intake.
EXCLUDE - lisa:debug-specialist - root cause already proven by the issue's reproduction; bug-fixer re-runs it.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the needed history.
EXCLUDE - lisa:github-agent - input already resolved; lead runs lifecycle.
EXCLUDE - lisa:github-build-intake - not an intake cycle.
EXCLUDE - lisa:github-prd-intake - no PRD.
EXCLUDE - lisa:jira-agent - tracker is github.
EXCLUDE - lisa:jira-build-intake - tracker is github.
EXCLUDE - lisa:learning-judge - reached via persist-learning only if needed.
EXCLUDE - lisa:learnings-synthesizer - not a debrief.
EXCLUDE - lisa:linear-agent - tracker is github.
EXCLUDE - lisa:linear-build-intake - tracker is github.
EXCLUDE - lisa:linear-prd-intake - no PRD.
EXCLUDE - lisa:notion-prd-intake - no PRD.
EXCLUDE - lisa:performance-specialist - no performance surface.
EXCLUDE - lisa:pr-mining-specialist - not a debrief.
EXCLUDE - lisa:product-specialist - no user-facing UI; release automation only.
EXCLUDE - lisa:security-specialist - no auth/secret handling change; push uses the existing token.
EXCLUDE - lisa:skill-evaluator - no learning routing.
EXCLUDE - lisa:spec-conformance-specialist - verification + quality review cover the issue's five fix points.
EXCLUDE - lisa:test-specialist - bug-fixer writes the race test; quality-specialist reviews it.
EXCLUDE - lisa:tracker-mining-specialist - not a debrief.
EXCLUDE - Plan - plan is prescribed by the issue.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - no external pages needed.

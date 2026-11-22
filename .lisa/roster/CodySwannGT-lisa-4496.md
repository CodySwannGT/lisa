# Roster Decision — CodySwannGT/lisa#4496

Plan: session-manager-self-duplicate-check
Work type: Fix (bug), so Reproduce runs first
Base branch: main (Target Backend Environment absent; the only `deploy.branches` entry is production=main, recorded as an Assumption)

INCLUDE - Explore - Required read-only research sweep of session-manager skill, scripts, and tests across the base, plugin, and agent-variant trees.
INCLUDE - lisa:bug-fixer - Fix flow: reproduce the self-as-duplicate defect as a failing test, then fix through TDD.
INCLUDE - lisa:verification-specialist - Independent empirical verification and the v2 verdict; it is not the implementer.
INCLUDE - lisa:quality-specialist - Reviews the fix for correctness and test quality before the PR.
INCLUDE - lisa:learner - Captures task MLD learnings to the ledger, as the flow requires.
EXCLUDE - general-purpose - More specific specialists cover every task.
EXCLUDE - claude - Catch-all; specialists cover the work.
EXCLUDE - claude-code-guide - No question about Claude Code docs or the API.
EXCLUDE - code-simplifier:code-simplifier - The change is small and targeted; quality-specialist covers simplification.
EXCLUDE - hookify:conversation-analyzer - Not a transcript-analysis task.
EXCLUDE - lisa:architecture-specialist - A single-contract bug with no architectural change.
EXCLUDE - lisa:confluence-prd-intake - Not PRD intake.
EXCLUDE - lisa:debug-specialist - The cause is already named in the ticket; bug-fixer's reproduce step proves it.
EXCLUDE - lisa:eval-specialist - Not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the history the fix needs.
EXCLUDE - lisa:github-agent - Lifecycle is run by this lead flow; the resolver used it for the read only.
EXCLUDE - lisa:github-build-intake - Not an intake cycle.
EXCLUDE - lisa:github-prd-intake - Not PRD intake.
EXCLUDE - lisa:jira-agent - The tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - The tracker is GitHub.
EXCLUDE - lisa:learning-judge - Invoked through persist-learning only if a candidate arises.
EXCLUDE - lisa:learnings-synthesizer - Not a debrief.
EXCLUDE - lisa:linear-agent - The tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - The tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - The tracker is GitHub.
EXCLUDE - lisa:notion-prd-intake - Not PRD intake.
EXCLUDE - lisa:performance-specialist - No performance surface.
EXCLUDE - lisa:pr-mining-specialist - Not a debrief.
EXCLUDE - lisa:product-specialist - Behavior is fully specified by the ticket's ACs; spec-conformance is covered by verification-specialist.
EXCLUDE - lisa:security-specialist - No auth, secrets, or input-validation surface changes.
EXCLUDE - lisa:skill-evaluator - No learning-routing decision.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist covers three Gherkin ACs; a small item.
EXCLUDE - lisa:test-specialist - bug-fixer writes the reproducing tests via TDD; quality-specialist reviews them.
EXCLUDE - lisa:tracker-mining-specialist - Not a debrief.
EXCLUDE - Plan - The lead plans; the scope is small.
EXCLUDE - statusline-setup - Unrelated.
EXCLUDE - web-fetch - No external pages needed.

# Roster Decision — CodySwannGT/lisa#4821

Plan: fix-4821-truncated-project-dir — Fix flow (type:Bug): first-prompt transcript lookup under truncated long project dirs.

INCLUDE - Explore - mandatory read-only research: locate first-prompt.mjs, its tests, callers, and Claude Code's project-dir naming.
INCLUDE - lisa:bug-fixer - Fix flow owner: reproduce as failing test, then TDD the fallback lookup.
INCLUDE - lisa:verification-specialist - independent empirical verification (spawn/classify against sandbox CLAUDE_CONFIG_DIR) and verdict writer.
INCLUDE - lisa:quality-specialist - post-implementation correctness/coding-philosophy review.
INCLUDE - lisa:learner - capture task MLD to the ledger.
EXCLUDE - general-purpose - specific specialists cover every task; no fallback needed.
EXCLUDE - claude - catch-all; specific specialists cover the work.
EXCLUDE - claude-code-guide - Claude Code's truncation rule is proven empirically per the ticket, not from docs.
EXCLUDE - code-simplifier:code-simplifier - small change; quality-specialist covers simplicity.
EXCLUDE - hookify:conversation-analyzer - no hook authoring.
EXCLUDE - lisa:architecture-specialist - single-function fallback, no design surface.
EXCLUDE - lisa:builder - this is a Fix, bug-fixer owns it.
EXCLUDE - lisa:confluence-prd-intake - not PRD intake.
EXCLUDE - lisa:debug-specialist - cause already identified by the ticket (exact-name lookup only).
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the relevant #4503 history.
EXCLUDE - lisa:github-agent - lifecycle driven by the lead; used only as input-resolver.
EXCLUDE - lisa:github-build-intake - not an intake cycle.
EXCLUDE - lisa:github-prd-intake - not PRD intake.
EXCLUDE - lisa:jira-agent - tracker is github.
EXCLUDE - lisa:jira-build-intake - tracker is github.
EXCLUDE - lisa:learning-judge - invoked via persist-learning only if a candidate arises.
EXCLUDE - lisa:learnings-synthesizer - debrief only.
EXCLUDE - lisa:linear-agent - tracker is github.
EXCLUDE - lisa:linear-build-intake - tracker is github.
EXCLUDE - lisa:linear-prd-intake - not PRD intake.
EXCLUDE - lisa:notion-prd-intake - not PRD intake.
EXCLUDE - lisa:performance-specialist - a directory scan on a cold path; no perf concern.
EXCLUDE - lisa:pr-mining-specialist - debrief only.
EXCLUDE - lisa:product-specialist - no user-facing UX; the ticket's Gherkin is already written.
EXCLUDE - lisa:security-specialist - reads local transcript dirs only; no auth/input surface change.
EXCLUDE - lisa:skill-evaluator - no learning routing.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the 3 scenarios against the spec.
EXCLUDE - lisa:test-specialist - bug-fixer writes the unit tests; scope is small.
EXCLUDE - lisa:tracker-mining-specialist - debrief only.
EXCLUDE - Plan - plan is fully specified in the ticket's Technical Approach.
EXCLUDE - statusline-setup - unrelated.

Access preflight: gh (tracker/PR) — proven by resolver's live read+claim; local `claude` CLI for the truncation-rule probe. No remote deploy target: plugin skill script, delivered via release.

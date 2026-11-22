# Roster Decision — CodySwannGT/lisa#4644

Plan: update-projects-skill-references (Fix, 1 point, skill text + reference/parity test)

INCLUDE - Explore - mandatory read-only research of both skill copies, cited paths, and git history.
INCLUDE - lisa:bug-fixer - Bug type; writes the failing reference/parity test first (RED) then fixes the skill text (GREEN).
INCLUDE - lisa:verification-specialist - independent verdict; runs the red/green test log the Validation Journey requires.
INCLUDE - lisa:quality-specialist - reviews the test and the procedure text for correctness and drift.
INCLUDE - lisa:spec-conformance-specialist - checks the three Gherkin scenarios and Out of Scope (#4641, #4604) are honoured.
INCLUDE - lisa:learner - captures task MLD to the ledger.
EXCLUDE - claude - generic catch-all; specific specialists cover every task.
EXCLUDE - claude-code-guide - no Claude Code product question involved.
EXCLUDE - code-simplifier:code-simplifier - change is skill prose plus one small test; quality-specialist covers it.
EXCLUDE - general-purpose - no task lacks a more specific specialist.
EXCLUDE - hookify:conversation-analyzer - not a hook-authoring task.
EXCLUDE - Plan - scope is fully specified by the ticket's Technical Approach.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - no public web page needed.
EXCLUDE - lisa:architecture-specialist - no design decision; the ticket prescribes the approach.
EXCLUDE - lisa:builder - Fix flow uses bug-fixer instead.
EXCLUDE - lisa:debug-specialist - root cause already proven in the ticket (deleted script, pinned callers, drifted copy).
EXCLUDE - lisa:test-specialist - one deterministic text test; bug-fixer writes it, quality-specialist reviews.
EXCLUDE - lisa:product-specialist - no user-visible UI or flow change.
EXCLUDE - lisa:security-specialist - no auth, secrets, or input-handling surface.
EXCLUDE - lisa:performance-specialist - no runtime code path.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the needed history (commits named in the ticket).
EXCLUDE - lisa:github-agent - lead runs the lifecycle; tracker read done by the resolver.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:github-build-intake - not an intake cycle.
EXCLUDE - lisa:jira-build-intake - not an intake cycle.
EXCLUDE - lisa:linear-build-intake - not an intake cycle.
EXCLUDE - lisa:github-prd-intake - not a PRD.
EXCLUDE - lisa:notion-prd-intake - not a PRD.
EXCLUDE - lisa:confluence-prd-intake - not a PRD.
EXCLUDE - lisa:linear-prd-intake - not a PRD.
EXCLUDE - lisa:learning-judge - invoked only via persist-learning paths.
EXCLUDE - lisa:skill-evaluator - invoked only by the gardener.
EXCLUDE - lisa:learnings-synthesizer - Debrief-only.
EXCLUDE - lisa:pr-mining-specialist - Debrief-only.
EXCLUDE - lisa:tracker-mining-specialist - Debrief-only.

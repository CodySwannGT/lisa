# Roster Decision — CodySwannGT/lisa#4692

Plan: evidence-release-rotation (Fix: completion-proof evidence hardcoded to one `pr-assets` release)

INCLUDE - Explore - mandatory read-only research of publisher/validator/evidence scripts and git history.
INCLUDE - lisa:bug-fixer - Fix work type: reproduce the hardcoded-release defect as a failing test, then fix via TDD.
INCLUDE - lisa:quality-specialist - review correctness and coding-philosophy compliance of the fix.
INCLUDE - lisa:verification-specialist - independent empirical verification and v2 verdict.
INCLUDE - lisa:learner - capture task MLD to the learnings ledger.
INCLUDE - lisa:github-agent - post takeover comment, file Ask 2 follow-up, sync tracker milestones.
EXCLUDE - general-purpose - specialists above cover every task; no fallback needed.
EXCLUDE - claude - catch-all; specialists cover the work.
EXCLUDE - claude-code-guide - no Claude Code/API questions involved.
EXCLUDE - Plan - lead plans from resolver + Explore findings; scope fixed by the manager decision.
EXCLUDE - lisa:architecture-specialist - localized change to two modules plus evidence scripts; Explore covers file mapping.
EXCLUDE - lisa:builder - Fix flow uses bug-fixer.
EXCLUDE - lisa:debug-specialist - cause is stated and located in the issue (hardcoded release tag).
EXCLUDE - lisa:test-specialist - bug-fixer owns TDD; quality-specialist reviews the tests.
EXCLUDE - lisa:security-specialist - no auth/secrets surface change; release names are validated strings.
EXCLUDE - lisa:performance-specialist - asset-count probe is one API call; no perf surface.
EXCLUDE - lisa:product-specialist - no UI; operator-facing error text reviewed by quality-specialist.
EXCLUDE - lisa:spec-conformance-specialist - manager-fixed subset of three asks; verification-specialist checks conformance.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the relevant history.
EXCLUDE - lisa:learning-judge, lisa:skill-evaluator, lisa:learnings-synthesizer, lisa:pr-mining-specialist, lisa:tracker-mining-specialist - debrief/learning-routing roles, not this flow.
EXCLUDE - lisa:jira-agent, lisa:linear-agent, all *-build-intake and *-prd-intake agents - tracker is github; not an intake cycle.
EXCLUDE - code-simplifier:code-simplifier - quality-specialist covers simplification review.
EXCLUDE - hookify:conversation-analyzer - not analyzing transcripts.
EXCLUDE - statusline-setup - unrelated.

Base branch: main. Target Backend Environment: `Assumption: production — remote default branch main` (no env signal in the issue; deploy.branches production=main).
Scope (manager decision): Ask 1 (configurable/rotating evidence release; old records keep validating) + Ask 3 (clear near-full error). Ask 2 (prune) filed as build-ready follow-up.

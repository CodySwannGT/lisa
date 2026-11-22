# Roster Decision — CodySwannGT/lisa#4511

Work type: Fix (bug) — two parts: (1) Node version drift in shipped templates/docs, (2) managed-file guard refusing create-only ci.yml in a nestjs host.

INCLUDE - Explore - mandatory read-only research: locate Node version strings across templates and the guard's ownership resolution.
INCLUDE - lisa:bug-fixer - reproduces both defects as failing tests, then fixes via TDD.
INCLUDE - lisa:quality-specialist - reviews the diff for correctness and test quality before PR.
INCLUDE - lisa:verification-specialist - independent empirical verification and verdict (implementer must not self-certify).
INCLUDE - lisa:learner - captures task MLD into the learnings ledger.
INCLUDE - general-purpose - lead-session bookkeeping only (plan name, branch, completion condition) as the skill prescribes; no specialist owns those steps.
EXCLUDE - claude - catch-all; specific specialists cover every role.
EXCLUDE - claude-code-guide - no Claude Code product questions.
EXCLUDE - code-simplifier:code-simplifier - change is small; quality-specialist review covers clarity.
EXCLUDE - hookify:conversation-analyzer - not analyzing transcripts.
EXCLUDE - lisa:architecture-specialist - no new architecture; fix lives in existing guard and templates.
EXCLUDE - lisa:confluence-prd-intake - not PRD intake.
EXCLUDE - lisa:debug-specialist - cause is stated in the issue and reproducible by test; bug-fixer reproduces it.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the relevant history (#2538/#2549/#4367).
EXCLUDE - lisa:github-agent - lifecycle is run by the lead under this skill; used only as input-resolver.
EXCLUDE - lisa:github-build-intake - not a batch intake cycle.
EXCLUDE - lisa:github-prd-intake - not PRD intake.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - invoked by persist-learning only if a candidate arises.
EXCLUDE - lisa:learnings-synthesizer - Debrief flow only.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - not PRD intake.
EXCLUDE - lisa:notion-prd-intake - not PRD intake.
EXCLUDE - lisa:performance-specialist - no performance surface.
EXCLUDE - lisa:pr-mining-specialist - Debrief flow only.
EXCLUDE - lisa:product-specialist - no user-facing UI; operator-visible outcome is a docs string and a hook decision.
EXCLUDE - lisa:security-specialist - guard change narrows a refusal only for project-owned create-only paths; quality review plus tests cover it; no auth/secrets surface changes.
EXCLUDE - lisa:skill-evaluator - no learning routing needed.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist covers the two acceptance expectations directly.
EXCLUDE - lisa:test-specialist - bug-fixer writes the regression tests; quality-specialist reviews them.
EXCLUDE - lisa:tracker-mining-specialist - Debrief flow only.
EXCLUDE - Plan - Explore + lead planning suffice for a two-part bounded fix.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - no external pages needed.

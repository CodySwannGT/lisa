# Roster Decision — CodySwannGT/lisa#4730

Work type: Fix (type:Bug). The Codex plugin tree omits shared scripts its skill scripts import.

INCLUDE - Explore - required read-only research over the generator, the OpenCode sibling fix (#4737), and existing guard tests.
INCLUDE - lisa:bug-fixer - reproduces the ERR_MODULE_NOT_FOUND as a failing test and implements the generator fix via TDD.
INCLUDE - lisa:verification-specialist - independent empirical verification (session-manager --help exit 0, regeneration stable) and the verdict.
INCLUDE - lisa:quality-specialist - reviews the generator change and guard test for correctness and test quality.
INCLUDE - lisa:learner - captures task learnings to the ledger.
EXCLUDE - claude - catch-all; the specific specialists above fit.
EXCLUDE - general-purpose - fallback only; specific specialists fit and lead-session coordination is done by the lead.
EXCLUDE - Plan - the issue's Technical Approach already prescribes the fix; bug-fixer plans inline.
EXCLUDE - claude-code-guide - no Claude Code product question.
EXCLUDE - code-simplifier:code-simplifier - small generator change; quality-specialist covers simplification.
EXCLUDE - hookify:conversation-analyzer - no hook authoring.
EXCLUDE - lisa:architecture-specialist - the fix mirrors the already-merged OpenCode design (#4737).
EXCLUDE - lisa:builder - this is a Fix; bug-fixer owns it.
EXCLUDE - lisa:debug-specialist - root cause is proven deterministically in the issue (files never emitted).
EXCLUDE - lisa:eval-specialist - not a factory-measurement task.
EXCLUDE - lisa:git-history-analyzer - Explore covers the relevant history (#4737).
EXCLUDE - lisa:test-specialist - bug-fixer writes the guard and e2e tests; quality-specialist reviews them.
EXCLUDE - lisa:product-specialist - no user-facing UX flow beyond CLI --help.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the four ACs directly.
EXCLUDE - lisa:security-specialist - no auth, secrets, or input surface touched.
EXCLUDE - lisa:performance-specialist - no performance surface.
EXCLUDE - lisa:learning-judge, lisa:skill-evaluator, lisa:learnings-synthesizer, lisa:pr-mining-specialist, lisa:tracker-mining-specialist - debrief/gardener roles, not part of a single Fix.
EXCLUDE - lisa:jira-agent, lisa:linear-agent, lisa:github-agent (beyond input resolution), all *-intake agents - tracker is github; the lead drives lifecycle through skills.
EXCLUDE - statusline-setup, web-fetch - not needed.

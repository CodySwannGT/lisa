# Roster Decision — CodySwannGT/lisa#4503

Work type: Fix (session-manager worker first-prompt failure misclassified as `working`).

INCLUDE - Explore - mandatory read-only research: locate spawn/classify code, tests, fixtures in lisa-session-manager.
INCLUDE - lisa:bug-fixer - reproduce as failing tests (unknown-command + hook-blocked fixtures) and implement fix via TDD.
INCLUDE - lisa:quality-specialist - review correctness and coding-philosophy compliance of the diff.
INCLUDE - lisa:verification-specialist - independent empirical verification + verdict (implementer cannot self-certify).
INCLUDE - lisa:learner - capture task MLD to the learnings ledger.
EXCLUDE - general-purpose - lead handles plan naming/branch/flow determination; specific specialists cover the rest.
EXCLUDE - lisa:debug-specialist - root cause already stated in the issue (classifier ignores first-prompt failure); bug-fixer reproduces.
EXCLUDE - lisa:architecture-specialist - localized change in the session-manager scripts; no cross-cutting design.
EXCLUDE - lisa:test-specialist - bug-fixer owns TDD fixtures; quality-specialist reviews tests.
EXCLUDE - lisa:product-specialist - operator-facing CLI script, no UX surface beyond classify output.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist covers the Expected list as ACs.
EXCLUDE - lisa:security-specialist - no auth/secret handling changes (transcript parsing only).
EXCLUDE - lisa:performance-specialist - no performance-sensitive path.
EXCLUDE - lisa:builder - this is a Fix; bug-fixer is the matching implementer.
EXCLUDE - lisa:github-agent - tracker resolution already done by the input-resolver; lead syncs.
EXCLUDE - lisa:git-history-analyzer - Explore covers relevant history.
EXCLUDE - lisa:eval-specialist, lisa:learning-judge, lisa:skill-evaluator, lisa:learnings-synthesizer, lisa:pr-mining-specialist, lisa:tracker-mining-specialist - debrief/gardener roles, not part of an implement flow.
EXCLUDE - lisa:confluence/github/linear/notion-prd-intake, lisa:github/jira/linear-build-intake, lisa:jira-agent, lisa:linear-agent - other trackers/intake flows; tracker is github.
EXCLUDE - Plan - lead plans directly; scope is small.
EXCLUDE - claude, claude-code-guide, code-simplifier:code-simplifier, hookify:conversation-analyzer, statusline-setup, web-fetch - not relevant to this fix.

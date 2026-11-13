# Roster Decision — CodySwannGT/lisa#4699

Work type: Fix (usage writer accepts a short `linear:<KEY>` artifact_ref that the completion-proof reader refuses).

INCLUDE - Explore - mandatory read-only research: find the usage writer, how it encodes artifact_ref, and the isVerifyEntryFor consumer.
INCLUDE - lisa:bug-fixer - writes the failing regression test for the short ref, then fixes the writer through TDD.
INCLUDE - lisa:verification-specialist - independently runs the real usage-writer CLI with short and qualified refs and writes the verdict.
INCLUDE - lisa:quality-specialist - reviews the diff for correctness, coding philosophy, and test quality.
INCLUDE - lisa:learner - records task MLD to the ledger.
EXCLUDE - general-purpose - specific specialists cover every task.
EXCLUDE - claude - a catch-all; specific specialists cover every task.
EXCLUDE - Plan - the fix is small; bug-fixer plans it inline and architecture is not in question.
EXCLUDE - lisa:architecture-specialist - a single-module ref-grammar fix with no architectural decision.
EXCLUDE - lisa:builder - this is a Fix, so bug-fixer owns it.
EXCLUDE - lisa:debug-specialist - the root cause is already stated with file and line; there is nothing to diagnose.
EXCLUDE - lisa:test-specialist - bug-fixer writes the regression test, and quality-specialist reviews test quality.
EXCLUDE - lisa:security-specialist - string normalisation in a local script, with no auth, secrets, or input-trust boundary.
EXCLUDE - lisa:performance-specialist - no performance surface.
EXCLUDE - lisa:product-specialist - no UI or user flow; it is an internal ledger grammar.
EXCLUDE - lisa:spec-conformance-specialist - the spec is three sentences; verification-specialist covers conformance.
EXCLUDE - lisa:git-history-analyzer - Explore covers the relevant history.
EXCLUDE - lisa:github-agent - its only job here was input resolution, which is done.
EXCLUDE - lisa:learning-judge, lisa:skill-evaluator, lisa:learnings-synthesizer, lisa:pr-mining-specialist, lisa:tracker-mining-specialist, lisa:eval-specialist - Debrief, gardener, and eval roles, out of scope for an Implement fix.
EXCLUDE - lisa:*-intake agents (confluence/github/jira/linear/notion prd and build intake) - intake roles, not Implement.
EXCLUDE - lisa:jira-agent, lisa:linear-agent - wrong tracker.
EXCLUDE - code-simplifier:code-simplifier - quality-specialist covers it.
EXCLUDE - claude-code-guide, statusline-setup, web-fetch, hookify:conversation-analyzer - unrelated tooling.

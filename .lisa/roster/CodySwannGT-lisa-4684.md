# Roster Decision — CodySwannGT/lisa#4684

Plan: 4684-test-only-completion-scope. Work type: Fix (bug). Surface: Node CLI scripts + skill/rule prose (no UI, no deploy runtime).

INCLUDE - Explore - Mandatory read-only research: locate declaredScope(), the record contract, and every S8 validator grammar.
INCLUDE - lisa:bug-fixer - Reproduce as a failing test, then fix declaredScope() and grammar parity via TDD.
INCLUDE - lisa:quality-specialist - Independent correctness/coverage review of the fix.
INCLUDE - lisa:verification-specialist - Independent empirical verification (run the real completion-proof code) and verdict authoring.
INCLUDE - lisa:learner - Capture task MLD learnings to the ledger.
EXCLUDE - general-purpose - More specific specialists cover every task.
EXCLUDE - claude - Catch-all; specialists cover the work.
EXCLUDE - claude-code-guide - No Claude Code product question involved.
EXCLUDE - code-simplifier:code-simplifier - Small regex/contract edit; quality-specialist covers clarity.
EXCLUDE - hookify:conversation-analyzer - Not analysing transcripts for hooks.
EXCLUDE - lisa:architecture-specialist - No design change; a closed-set extension plus parity.
EXCLUDE - lisa:builder - Fix flow; bug-fixer owns it.
EXCLUDE - lisa:confluence-prd-intake - Not PRD intake.
EXCLUDE - lisa:debug-specialist - Root cause already cited verbatim in the issue (exact regex at a named line).
EXCLUDE - lisa:eval-specialist - Not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers relevant history (#4545).
EXCLUDE - lisa:github-agent - Used only as the input-resolver; lifecycle run by lead.
EXCLUDE - lisa:github-build-intake - Not an intake cycle.
EXCLUDE - lisa:github-prd-intake - Not PRD intake.
EXCLUDE - lisa:jira-agent - Tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - Tracker is GitHub.
EXCLUDE - lisa:learning-judge - Invoked by learner/persist-learning if needed.
EXCLUDE - lisa:learnings-synthesizer - Not a debrief.
EXCLUDE - lisa:linear-agent - Tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - Tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - Not PRD intake.
EXCLUDE - lisa:notion-prd-intake - Not PRD intake.
EXCLUDE - lisa:performance-specialist - No performance surface.
EXCLUDE - lisa:pr-mining-specialist - Not a debrief.
EXCLUDE - lisa:product-specialist - No user-facing UX change.
EXCLUDE - lisa:security-specialist - No auth/secret/input-trust surface touched.
EXCLUDE - lisa:skill-evaluator - Not routing a learning.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist covers ACs for this small fix.
EXCLUDE - lisa:test-specialist - bug-fixer writes the tests; quality-specialist reviews them.
EXCLUDE - lisa:tracker-mining-specialist - Not a debrief.
EXCLUDE - Plan - Lead plans; scope is narrow.
EXCLUDE - statusline-setup - Irrelevant.
EXCLUDE - web-fetch - No external pages needed.

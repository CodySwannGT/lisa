# Roster Decision — CodySwannGT/lisa#4698

Work type: Fix (completion-proof validator rejects lisa-capture's plain-text output for typed evidence kinds).

INCLUDE - Explore - mandatory read-only research of validator, lisa-capture, and the verification-captures contract.
INCLUDE - lisa:bug-fixer - reproduces the defect as a failing test and implements the fix via TDD.
INCLUDE - lisa:verification-specialist - independent empirical proof (run lisa-capture + validator) and verdict authoring.
INCLUDE - lisa:quality-specialist - reviews correctness, coding philosophy and test quality of the fix.
INCLUDE - lisa:learner - captures task MLD learnings to the ledger.
INCLUDE - general-purpose - lead-session bookkeeping (plan name, base branch, completion condition) per skill mandate.
EXCLUDE - claude - generic catch-all; bug-fixer is the specific fit.
EXCLUDE - claude-code-guide - no Claude Code product questions involved.
EXCLUDE - code-simplifier:code-simplifier - change is small; quality-specialist covers simplification review.
EXCLUDE - hookify:conversation-analyzer - not analyzing transcripts for hooks.
EXCLUDE - lisa:architecture-specialist - design choice is narrow (one of two options stated in the issue); Explore findings suffice.
EXCLUDE - lisa:builder - this is a Fix, bug-fixer owns it.
EXCLUDE - lisa:confluence-prd-intake - no Confluence PRD.
EXCLUDE - lisa:debug-specialist - root cause is stated in the issue and confirmed by reading the validator.
EXCLUDE - lisa:eval-specialist - not measuring factory capability.
EXCLUDE - lisa:git-history-analyzer - Explore covers the relevant history.
EXCLUDE - lisa:github-agent - lifecycle is driven by this lead session.
EXCLUDE - lisa:github-build-intake - not an intake cycle.
EXCLUDE - lisa:github-prd-intake - no PRD.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - invoked via persist-learning only if a learning candidate arises.
EXCLUDE - lisa:learnings-synthesizer - not a debrief.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - tracker is GitHub.
EXCLUDE - lisa:notion-prd-intake - no Notion PRD.
EXCLUDE - lisa:performance-specialist - no performance surface.
EXCLUDE - lisa:pr-mining-specialist - not a debrief.
EXCLUDE - lisa:product-specialist - CLI/library contract change, no user flow.
EXCLUDE - lisa:security-specialist - no auth/secret/input-trust surface beyond file parsing.
EXCLUDE - lisa:skill-evaluator - no learning routing needed.
EXCLUDE - lisa:spec-conformance-specialist - quality + verification specialists cover AC conformance for a small fix.
EXCLUDE - lisa:test-specialist - bug-fixer writes tests under TDD; quality-specialist reviews them.
EXCLUDE - lisa:tracker-mining-specialist - not a debrief.
EXCLUDE - Plan - planning is done by the lead.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - no external pages needed.

# Roster Decision — CodySwannGT/lisa#4760

Work type: Improve (agent/rule prose + regression test). Runtime: Claude Code, Agent tool.

INCLUDE - Explore - mandatory read-only research: find every falsification instruction and its tests.
INCLUDE - lisa:builder - implements the prose change and the regression test via TDD.
INCLUDE - lisa:quality-specialist - independent review of the diff and test meaningfulness.
INCLUDE - lisa:verification-specialist - independent verdict; it is also the agent whose instruction changes.
INCLUDE - lisa:learner - captures task MLD to the ledger.
INCLUDE - general-purpose - lead-session helper for plan name, base branch, and completion condition (no narrower specialist fits those lead chores).
EXCLUDE - claude - catch-all duplicate of general-purpose.
EXCLUDE - claude-code-guide - no Claude Code product question involved.
EXCLUDE - code-simplifier:code-simplifier - prose-only change; nothing to simplify.
EXCLUDE - hookify:conversation-analyzer - not analysing transcripts for hooks.
EXCLUDE - lisa:architecture-specialist - no design decision; change location is named by the issue.
EXCLUDE - lisa:bug-fixer - Improve, not a reproduced code defect.
EXCLUDE - lisa:confluence-prd-intake - PRD intake, out of scope.
EXCLUDE - lisa:debug-specialist - no defect cause to prove.
EXCLUDE - lisa:eval-specialist - not measuring factory capability.
EXCLUDE - lisa:git-history-analyzer - Explore covers the history needed for one file.
EXCLUDE - lisa:github-agent - used only as the bounded input-resolver.
EXCLUDE - lisa:github-build-intake - batch intake, out of scope.
EXCLUDE - lisa:github-prd-intake - PRD intake, out of scope.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - no candidate learning to judge in-flow.
EXCLUDE - lisa:learnings-synthesizer - debrief only.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - PRD intake, out of scope.
EXCLUDE - lisa:notion-prd-intake - PRD intake, out of scope.
EXCLUDE - lisa:performance-specialist - no runtime performance surface.
EXCLUDE - lisa:pr-mining-specialist - debrief only.
EXCLUDE - lisa:product-specialist - no user-facing UX flow; agent prose only.
EXCLUDE - lisa:security-specialist - no auth/secrets/input surface touched.
EXCLUDE - lisa:skill-evaluator - not routing a learning.
EXCLUDE - lisa:spec-conformance-specialist - quality + verification specialists cover conformance for a one-paragraph spec.
EXCLUDE - lisa:test-specialist - builder writes a single fixture-style regression test.
EXCLUDE - lisa:tracker-mining-specialist - debrief only.
EXCLUDE - Plan - plan is trivially small; lead records it.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - no external page needed.

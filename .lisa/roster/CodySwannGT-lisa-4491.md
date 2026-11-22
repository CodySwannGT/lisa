# Roster Decision — CodySwannGT/lisa#4491

Work type: Implement / Improve (skill-text change in lisa-root-cause-analysis and lisa-reproduce-bug, propagated to every generated agent surface). No runtime UI/API surface.

INCLUDE - Explore - mandatory read-only research: locate source skill files, every generated copy, and the parity/build mechanism.
INCLUDE - general-purpose - lead-session planning steps (plan name, base branch, flow/work type, completion condition, tool-access preflight) the skill assigns to it.
INCLUDE - lisa:builder - makes the source edits, regenerates agent surfaces, and adds any test/guard coverage.
INCLUDE - lisa:quality-specialist - reviews wording correctness, parity across surfaces, and test adequacy.
INCLUDE - lisa:spec-conformance-specialist - checks the shipped text against the issue's proposed template change section by section.
INCLUDE - lisa:verification-specialist - independent verdict: runs the generators/sync checks and records verification-status.json.
INCLUDE - lisa:learner - captures task MLD into the learnings ledger.
EXCLUDE - claude - catch-all; more specific specialists cover every task.
EXCLUDE - claude-code-guide - no question about Claude Code product features.
EXCLUDE - code-simplifier:code-simplifier - prose insertion, nothing to simplify.
EXCLUDE - hookify:conversation-analyzer - not analyzing transcripts for hooks.
EXCLUDE - lisa:architecture-specialist - no architectural design; the issue prescribes exact insertions.
EXCLUDE - lisa:bug-fixer - not a defect fix; it is an Improvement.
EXCLUDE - lisa:confluence-prd-intake - not PRD intake.
EXCLUDE - lisa:debug-specialist - nothing to debug.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the small history need.
EXCLUDE - lisa:github-agent - already used as the input resolver; lifecycle owned by this lead.
EXCLUDE - lisa:github-build-intake - not an intake cycle.
EXCLUDE - lisa:github-prd-intake - not PRD intake.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - invoked via persist-learning only if a candidate arises.
EXCLUDE - lisa:learnings-synthesizer - not a debrief.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - not PRD intake.
EXCLUDE - lisa:notion-prd-intake - not PRD intake.
EXCLUDE - lisa:performance-specialist - no performance surface.
EXCLUDE - lisa:pr-mining-specialist - not a debrief.
EXCLUDE - lisa:product-specialist - no user-facing product flow; operator-facing skill text is reviewed by quality/spec specialists.
EXCLUDE - lisa:security-specialist - no security surface in skill prose.
EXCLUDE - lisa:skill-evaluator - destination of the knowledge is prescribed by the issue.
EXCLUDE - lisa:test-specialist - builder covers the small test need; quality-specialist reviews it.
EXCLUDE - lisa:tracker-mining-specialist - not a debrief.
EXCLUDE - Plan - general-purpose lead planning suffices for a two-section text change.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - no external pages needed.

# Roster Decision — CodySwannGT/lisa#4492

Fix (bug): block-suppress-directives hook should refuse directive growth, not presence.

INCLUDE - Explore - mandatory read-only research: hook source copies, codex variant, tests, plugin artifact sync.
INCLUDE - lisa:bug-fixer - reproduce as failing tests, then fix via TDD; primary implementer.
INCLUDE - lisa:verification-specialist - independent empirical proof by piping real hook payloads into the built hook; writes the verdict.
INCLUDE - general-purpose - lead-session plan/branch/completion-condition steps per skill text (performed by the lead, shell-only).
EXCLUDE - claude - catch-all; bug-fixer is more specific.
EXCLUDE - claude-code-guide - no Claude Code product question.
EXCLUDE - code-simplifier:code-simplifier - small shell change; submit-pr local review covers it.
EXCLUDE - hookify:conversation-analyzer - not analyzing transcripts.
EXCLUDE - lisa:architecture-specialist - single-hook change; the issue prescribes the approach.
EXCLUDE - lisa:builder - this is a Fix; bug-fixer covers it.
EXCLUDE - lisa:confluence-prd-intake, lisa:notion-prd-intake, lisa:linear-prd-intake, lisa:github-prd-intake - no PRD intake.
EXCLUDE - lisa:debug-specialist - the issue already proves the cause (lines cited); a failing test reproduces it.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers relevant history.
EXCLUDE - lisa:github-agent, lisa:jira-agent, lisa:linear-agent - lead runs the lifecycle directly.
EXCLUDE - lisa:github-build-intake, lisa:jira-build-intake, lisa:linear-build-intake - single item, already dispatched.
EXCLUDE - lisa:learner - MLD recorded in task metadata; empty is valid.
EXCLUDE - lisa:learning-judge, lisa:learnings-synthesizer, lisa:skill-evaluator, lisa:pr-mining-specialist, lisa:tracker-mining-specialist - debrief/learning routing out of scope.
EXCLUDE - lisa:performance-specialist - no performance surface.
EXCLUDE - lisa:product-specialist - no UI/UX surface.
EXCLUDE - lisa:quality-specialist - covered by submit-pr local review.
EXCLUDE - lisa:security-specialist - fail-closed retained; relaxation scoped to unchanged directives; local review covers it.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks ACs directly for this 3-point bug.
EXCLUDE - lisa:test-specialist - bug-fixer writes the tests.
EXCLUDE - Plan - approach prescribed by the issue.
EXCLUDE - statusline-setup, web-fetch - irrelevant.

Target environment: Assumption: production — remote default branch main. Base branch: main.
Tool access: gh (probe: gh issue view 4492 — pass). No other external tools.
Completion condition: piping Claude PreToolUse JSON payloads into the built hook yields exit 0 for (Write keeping existing directive; Edit hunk spanning unchanged directive) and exit 2 for (Write adding a second directive; new file with directive; -next-line widened to file-wide; unreadable target), with the gate-façade branch untouched and all plugin copies in sync.

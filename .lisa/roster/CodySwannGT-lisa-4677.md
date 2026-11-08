# Roster Decision — CodySwannGT/lisa#4677

Plan: ci-rework-session-manager-route. Work type: Build (skill + script + tests).

INCLUDE - Explore - mandatory read-only research of lisa-track, lisa-implement, build-intake 3b, and the #4607 script.
INCLUDE - general-purpose - lead-session planning helpers (plan name, base branch, completion condition) per the skill.
INCLUDE - lisa:builder - implements the route helper, fixtures, and skill edits via TDD.
INCLUDE - lisa:verification-specialist - independent verdict; did not implement the change.
INCLUDE - lisa:quality-specialist - post-implementation review of correctness and test quality.
INCLUDE - lisa:learner - captures task MLD to the ledger.
EXCLUDE - claude - catch-all; specific specialists cover every task.
EXCLUDE - claude-code-guide - no Claude Code product question involved.
EXCLUDE - code-simplifier:code-simplifier - small new script; quality-specialist review covers simplification.
EXCLUDE - hookify:conversation-analyzer - no transcript analysis requested.
EXCLUDE - lisa:architecture-specialist - the issue already decides placement and the shared-helper design.
EXCLUDE - lisa:bug-fixer - Build, not Fix.
EXCLUDE - lisa:confluence-prd-intake - no PRD intake.
EXCLUDE - lisa:debug-specialist - no defect to diagnose.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - #4607 history is summarized in the issue; Explore covers the rest.
EXCLUDE - lisa:github-agent - used only as the bounded input-resolver.
EXCLUDE - lisa:github-build-intake - no intake cycle.
EXCLUDE - lisa:github-prd-intake - no PRD intake.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - invoked only through persist-learning if a candidate arises.
EXCLUDE - lisa:learnings-synthesizer - debrief-only.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - tracker is GitHub.
EXCLUDE - lisa:notion-prd-intake - no PRD intake.
EXCLUDE - lisa:performance-specialist - one gh read per dispatch; no performance surface.
EXCLUDE - lisa:pr-mining-specialist - debrief-only.
EXCLUDE - lisa:product-specialist - no user-facing UI; AC are already Gherkin.
EXCLUDE - lisa:security-specialist - trust rules mirror the reviewed #4607 MARKER_AUTHORS check; quality review covers it.
EXCLUDE - lisa:skill-evaluator - no learning routing needed.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks AC conformance for this size.
EXCLUDE - lisa:test-specialist - builder writes the fixture matrix the issue fully enumerates.
EXCLUDE - lisa:tracker-mining-specialist - debrief-only.
EXCLUDE - Plan - issue already contains the technical approach.
EXCLUDE - statusline-setup - unrelated.

Tool access: gh (GitHub CLI, authenticated — probe `gh issue view 4677` passed). No other external tools required.
Completion condition: `node scripts/lisa-ci-rework-route.mjs --item <n> --payload tests/fixtures/ci-rework-route/trusted-marker.json` prints route ci-rework; each untrusted fixture prints route implement with the matching reason; generated plugin copies contain the routing text; PR merged to main and release workflow fired.

# Roster Decision — CodySwannGT/lisa#4604

Work type: Implement / Build (Lisa-only skill + plan script + unit tests). Plan: canary-first-update-projects.

INCLUDE - Explore - mandatory read-only research: existing update-projects skill, script/test conventions, push-timing report, `gh pr checks` usage.
INCLUDE - lisa:builder - implements the plan script, fixtures, tests and skill updates via TDD against the Gherkin AC.
INCLUDE - lisa:quality-specialist - reviews correctness, coding philosophy and test quality of the change.
INCLUDE - lisa:verification-specialist - independent empirical verification (CLI runs of the plan script) and verdict authoring.
INCLUDE - lisa:learner - captures task MLD into the learnings ledger.
INCLUDE - general-purpose - lead-session helper steps the skill names explicitly (plan naming, flow determination); no specific specialist fits those.
EXCLUDE - claude - catch-all; specific specialists cover every role.
EXCLUDE - claude-code-guide - no Claude Code product questions.
EXCLUDE - code-simplifier:code-simplifier - small new script; quality-specialist covers simplification.
EXCLUDE - hookify:conversation-analyzer - no hook-from-transcript work.
EXCLUDE - lisa:architecture-specialist - technical approach is fully specified in the ticket.
EXCLUDE - lisa:bug-fixer - Build, not Fix.
EXCLUDE - lisa:confluence-prd-intake - no PRD intake.
EXCLUDE - lisa:debug-specialist - no defect to diagnose.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - relationship search already in the ticket; Explore covers recent history.
EXCLUDE - lisa:github-agent - used as the input-resolver; tracker writes go through skills.
EXCLUDE - lisa:github-build-intake - single dispatched item, no intake cycle.
EXCLUDE - lisa:github-prd-intake - no PRD intake.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - invoked by persist-learning only if a candidate arises.
EXCLUDE - lisa:learnings-synthesizer - Debrief-only.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - tracker is GitHub.
EXCLUDE - lisa:notion-prd-intake - no Notion.
EXCLUDE - lisa:performance-specialist - no performance surface.
EXCLUDE - lisa:pr-mining-specialist - Debrief-only.
EXCLUDE - lisa:product-specialist - no user-visible UI; Gherkin AC already authored.
EXCLUDE - lisa:security-specialist - local JSON parsing only, no auth/secrets surface.
EXCLUDE - lisa:skill-evaluator - no learning routing needed.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist covers the AC matrix for a 4-scenario leaf.
EXCLUDE - lisa:test-specialist - builder writes tests TDD; quality-specialist reviews them.
EXCLUDE - lisa:tracker-mining-specialist - Debrief-only.
EXCLUDE - Plan - approach specified in the ticket.
EXCLUDE - statusline-setup - irrelevant.

## Flow facts (lead)
- Flow: Implement / Build. Readiness: leaf, open, claimed, Gherkin AC + Validation Journey present.
- Target env: Assumption: production — remote default main (unconfirmed automated annotation; no conflicting signal). Base: main. Branch Plan: matches (main → main).
- Branch: claude/4604-canary-first-update-projects, from origin/main f7355b414b.
- Regression spec: no browser/device surface (CLI script + skill prose) — unit tests are the highest practical observation level.
- Tool access: gh (GitHub) only — probed via the input-resolver's live read/claim. No other external tools.
- Completion condition: `node scripts/lisa-update-projects-plan.mjs --workspaces tests/fixtures/update-projects/one-canary.json` prints canary then rest; `decide --canary-result pass|fail|timeout` prints proceed|halt|halt; no-canary/two-canary fixtures refuse with the designation message; skill grep shows canary steps; unit tests pass. Constraint: legacy string entries keep their branch.

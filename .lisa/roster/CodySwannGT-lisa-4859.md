# Roster Decision — CodySwannGT/lisa#4859

Plan: `npm-updater-jira-linear-trackers`
Flow: Implement / Build (Task). Base `main` (Target Backend Environment: production → `deploy.branches.production=main`; Branch Plan matches).
Work-item context: `.lisa/work-item-context.md` (worktree-local, git-ignored).

```text
INCLUDE - Explore - mandatory read-only research of the npm-update scripts, tests and tracker config keys before implementation.
INCLUDE - lisa:architecture-specialist - designs the tracker adapter interface and the per-vendor workItem ref grammar while keeping GitHub signed artifacts byte-identical.
INCLUDE - lisa:builder - implements the adapters, policy widening and workflow inputs via TDD against the Gherkin acceptance criteria.
INCLUDE - lisa:test-specialist - designs the mocked Jira REST / Linear GraphQL harness and the GitHub byte-identity regression tests.
INCLUDE - lisa:security-specialist - the change adds credential env vars and signed-artifact ref parsing; fail-closed and foreign-ref rejection need review.
INCLUDE - lisa:quality-specialist - post-implementation review of correctness, coding philosophy and coverage.
INCLUDE - lisa:spec-conformance-specialist - maps each of the seven Gherkin scenarios and Out of Scope to evidence.
INCLUDE - lisa:verification-specialist - independent empirical verification and the v2 verdict; implementer may not self-certify.
INCLUDE - lisa:learner - captures task MLD into the learnings ledger as the flow requires.
INCLUDE - general-purpose - team-lead helper steps the skill assigns to it (plan name, base branch, completion condition, tool preflight, task creation); no narrower specialist owns those.
EXCLUDE - claude - catch-all duplicate of general-purpose; general-purpose already covers lead helper steps.
EXCLUDE - Plan - architecture-specialist owns design for this flow; a second planner would duplicate it.
EXCLUDE - claude-code-guide - no Claude Code / API product question is involved.
EXCLUDE - code-simplifier:code-simplifier - quality-specialist review covers simplification; avoid a second refactor pass over signed-artifact code that must stay byte-identical.
EXCLUDE - hookify:conversation-analyzer - not analyzing transcripts for hooks.
EXCLUDE - statusline-setup - unrelated to the task.
EXCLUDE - web-fetch - Jira REST v3 / Linear GraphQL shapes are mocked in tests; no live page read needed (Explore/builder can consult in-repo skills that already use these APIs).
EXCLUDE - lisa:bug-fixer - this is a Build (Task), not a Fix.
EXCLUDE - lisa:debug-specialist - no defect to root-cause; re-include if a gate fails inexplicably.
EXCLUDE - lisa:product-specialist - no user-facing UI; acceptance criteria are already Gherkin and spec-conformance covers them.
EXCLUDE - lisa:performance-specialist - CI script with a handful of API calls per run; no performance surface.
EXCLUDE - lisa:git-history-analyzer - Explore covers the relevant history of #4347/#4741; a dedicated archaeology pass is not needed.
EXCLUDE - lisa:eval-specialist - measures the factory, not this change.
EXCLUDE - lisa:learning-judge - invoked only via lisa-persist-learning when a candidate arises.
EXCLUDE - lisa:skill-evaluator - no learning routing judgement needed in this flow.
EXCLUDE - lisa:learnings-synthesizer - Debrief-only.
EXCLUDE - lisa:pr-mining-specialist - Debrief-only.
EXCLUDE - lisa:tracker-mining-specialist - Debrief-only.
EXCLUDE - lisa:github-agent - lifecycle is already being run by this lisa-implement lead.
EXCLUDE - lisa:jira-agent - tracker is github.
EXCLUDE - lisa:linear-agent - tracker is github.
EXCLUDE - lisa:github-build-intake - intake dispatcher, not needed for a single resolved item.
EXCLUDE - lisa:jira-build-intake - intake dispatcher; tracker is github.
EXCLUDE - lisa:linear-build-intake - intake dispatcher; tracker is github.
EXCLUDE - lisa:github-prd-intake - PRD intake, not this flow.
EXCLUDE - lisa:notion-prd-intake - PRD intake, not this flow.
EXCLUDE - lisa:confluence-prd-intake - PRD intake, not this flow.
EXCLUDE - lisa:linear-prd-intake - PRD intake, not this flow.
```

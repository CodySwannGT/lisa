# Roster Decision — CodySwannGT/lisa#4607

Plan: `ci-failure-redispatch` · Flow: Implement / Build · Base: `main` (production via `deploy.branches`)

```text
INCLUDE - Explore - mandatory read-only research of existing workflows, lisa-work-item.mjs Work-Item binding, build-intake skill and test conventions.
INCLUDE - lisa:builder - Build work: new workflow, script, fixtures, tests and skill change via TDD.
INCLUDE - lisa:verification-specialist - independent empirical proof (dry-run CLI over fixtures, live workflow_dispatch dry run) and the v2 verdict.
INCLUDE - lisa:quality-specialist - post-implementation review of correctness and coding-philosophy compliance.
INCLUDE - lisa:security-specialist - workflow_run carries a write token; review that no PR code is checked out or executed and permissions are minimal.
INCLUDE - lisa:learner - capture task learnings to the ledger.
INCLUDE - general-purpose - lead-session planning helpers (plan name, completion condition, tool preflight) per the skill.
EXCLUDE - claude - catch-all; more specific specialists cover every task.
EXCLUDE - claude-code-guide - no Claude Code product questions in scope.
EXCLUDE - code-simplifier:code-simplifier - quality-specialist review covers simplification for a small new script.
EXCLUDE - hookify:conversation-analyzer - no hook authoring from transcripts.
EXCLUDE - lisa:architecture-specialist - the ticket's Technical Approach already fixes the design (trigger, script, skill route).
EXCLUDE - lisa:bug-fixer - Build, not Fix.
EXCLUDE - lisa:confluence-prd-intake - no PRD intake.
EXCLUDE - lisa:debug-specialist - no defect to root-cause.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - the ticket's relationship search already covered history; Explore handles any remaining lookups.
EXCLUDE - lisa:github-agent - lifecycle is driven by this lead via lisa-implement; tracker writes use the tracker skills.
EXCLUDE - lisa:github-build-intake - not running an intake cycle.
EXCLUDE - lisa:github-prd-intake - no PRD intake.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - invoked inside the learner/persist-learning path only if a candidate needs routing.
EXCLUDE - lisa:learnings-synthesizer - Debrief only.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - tracker is GitHub.
EXCLUDE - lisa:notion-prd-intake - no Notion PRDs.
EXCLUDE - lisa:performance-specialist - a per-run metadata script has no performance surface.
EXCLUDE - lisa:pr-mining-specialist - Debrief only.
EXCLUDE - lisa:product-specialist - no user-facing UI; ACs are already Gherkin.
EXCLUDE - lisa:skill-evaluator - no learning routing judgment needed.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the ACs; the spec is small and explicit.
EXCLUDE - lisa:test-specialist - builder writes the tests TDD; the ticket enumerates the fixture matrix.
EXCLUDE - lisa:tracker-mining-specialist - Debrief only.
EXCLUDE - Plan - the ticket carries an owner-approved Technical Approach.
EXCLUDE - statusline-setup - unrelated.
```

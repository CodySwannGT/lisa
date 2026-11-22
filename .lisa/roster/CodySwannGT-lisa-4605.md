# Roster Decision — CodySwannGT/lisa#4605

Plan: `4605-release-rollback` · Flow: Implement / Build (story-sized sub-task, new Lisa-only CLI + runbook + tests)
Base branch: `main` (Target Backend Environment `Assumption: production`, Branch Plan matches `deploy.branches.production=main`)

```text
INCLUDE - general-purpose - bounded input-resolver (lisa-track resolve/claim/bind); no more specific type owns tracker resolution.
INCLUDE - Explore - mandatory read-only research: release.yml packument read, startRegistry fixture, script/test conventions.
INCLUDE - lisa:builder - implements the CLI, package script, runbook and tests via TDD from the Gherkin AC.
INCLUDE - lisa:quality-specialist - independent review of correctness, coding philosophy and test meaningfulness.
INCLUDE - lisa:security-specialist - the command drives npm/gh writes with release credentials; must never read/print tokens and must refuse before writes.
INCLUDE - lisa:verification-specialist - independent empirical proof (dry-run output, test-registry real run, refusal) and the v2 verdict.
INCLUDE - lisa:learner - captures task MLD to the ledger.
EXCLUDE - claude - catch-all; general-purpose already covers the one bounded generic job.
EXCLUDE - claude-code-guide - no Claude Code/API product questions in scope.
EXCLUDE - code-simplifier:code-simplifier - quality-specialist review covers simplification for a single new script.
EXCLUDE - hookify:conversation-analyzer - not analyzing transcripts for hooks.
EXCLUDE - lisa:architecture-specialist - Technical Approach in the ticket already fixes the design (flags, order, verification method).
EXCLUDE - lisa:bug-fixer - Build, not Fix.
EXCLUDE - lisa:confluence-prd-intake - no PRD intake.
EXCLUDE - lisa:debug-specialist - no defect to diagnose.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - ticket's Relationship Search already cites the relevant history (2f3e326646); Explore covers any remaining lookup.
EXCLUDE - lisa:github-agent - lifecycle is driven by this lead via lisa-implement.
EXCLUDE - lisa:github-build-intake - not an intake cycle.
EXCLUDE - lisa:github-prd-intake - not PRD intake.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learnings-synthesizer - Debrief-only.
EXCLUDE - lisa:learning-judge - invoked by lisa-persist-learning only if a planning-miss arises.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - tracker is GitHub.
EXCLUDE - lisa:notion-prd-intake - not PRD intake.
EXCLUDE - lisa:performance-specialist - one-shot CLI with three network calls; no performance surface.
EXCLUDE - lisa:pr-mining-specialist - Debrief-only.
EXCLUDE - lisa:product-specialist - no UI/user flow; Gherkin AC already authored on the ticket.
EXCLUDE - lisa:skill-evaluator - no learning routing needed.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks each AC against observed output; spec is small and explicit.
EXCLUDE - lisa:test-specialist - builder writes the tests TDD; quality-specialist reviews test meaningfulness.
EXCLUDE - lisa:tracker-mining-specialist - Debrief-only.
EXCLUDE - Plan - design is fixed by the ticket.
EXCLUDE - statusline-setup - unrelated.
```

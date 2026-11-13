# Roster Decision — CodySwannGT/lisa#4690

Work type: Fix (bug) — completion `spec_sha256` hashes Linear-normalized Lisa Usage boilerplate.
Target environment: production (`main`) — remote default branch; Lisa library/scripts change published via npm release from `main`.

```text
INCLUDE - general-purpose - bounded input-resolver (lisa-track claim/bind); already ran.
INCLUDE - Explore - mandatory read-only research: locate primarySpecProjection/usageSpecRemainder, upsertLisaUsageSection, sibling #4670/#4689 fixes.
INCLUDE - lisa:bug-fixer - Fix flow: reproduce as failing test, then fix via TDD.
INCLUDE - lisa:quality-specialist - independent review of correctness and test quality of the fix.
INCLUDE - lisa:verification-specialist - independent verdict; runs the real projection on canonical vs Linear-normalized text.
INCLUDE - lisa:learner - capture task MLD to the ledger.
EXCLUDE - claude - catch-all; specific specialists cover every role.
EXCLUDE - claude-code-guide - no Claude Code product question.
EXCLUDE - code-simplifier:code-simplifier - small targeted change; quality-specialist covers simplification.
EXCLUDE - hookify:conversation-analyzer - not analysing transcripts.
EXCLUDE - lisa:architecture-specialist - single-function fix, no design decision beyond the issue's stated proposal.
EXCLUDE - lisa:builder - Fix flow uses bug-fixer.
EXCLUDE - lisa:confluence-prd-intake - not PRD intake.
EXCLUDE - lisa:debug-specialist - cause is already proven in the issue with digests; bug-fixer's reproduce step confirms it.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the relevant history (#4545/#4670/#4689).
EXCLUDE - lisa:github-agent - lifecycle already owned by this lead.
EXCLUDE - lisa:github-build-intake - not an intake cycle.
EXCLUDE - lisa:github-prd-intake - not PRD intake.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - invoked only via persist-learning if a planning-miss arises.
EXCLUDE - lisa:learnings-synthesizer - debrief-only.
EXCLUDE - lisa:linear-agent - tracker is GitHub (Linear is only the data shape under test).
EXCLUDE - lisa:linear-build-intake - not an intake cycle.
EXCLUDE - lisa:linear-prd-intake - not PRD intake.
EXCLUDE - lisa:notion-prd-intake - not PRD intake.
EXCLUDE - lisa:performance-specialist - string projection over small text; no perf surface.
EXCLUDE - lisa:pr-mining-specialist - debrief-only.
EXCLUDE - lisa:product-specialist - no user-facing UI; behaviour is a hash invariant.
EXCLUDE - lisa:security-specialist - no auth/secrets/input-trust change.
EXCLUDE - lisa:skill-evaluator - no learning routing needed.
EXCLUDE - lisa:spec-conformance-specialist - issue is small; verification-specialist checks the reproduction steps directly.
EXCLUDE - lisa:test-specialist - bug-fixer writes the regression tests; quality-specialist reviews them.
EXCLUDE - lisa:tracker-mining-specialist - debrief-only.
EXCLUDE - Plan - plan is the issue's own proposal.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - no external pages needed.
```

# Roster Decision — CodySwannGT/lisa#4733

Plan: `4733-proof-publish-retry`. Work type: **Fix**, covering bounded transient retry in the completion-proof gh transport, plus adoption of an identical already-uploaded record.

- INCLUDE - Explore - read-only research of completion-proof-github.mjs, its callers and tests before implementation.
- INCLUDE - lisa:bug-fixer - reproduces the transient-failure abort as a failing test and fixes it via TDD.
- INCLUDE - lisa:quality-specialist - independent review of correctness, immutability and test quality of the retry change.
- INCLUDE - lisa:verification-specialist - independent empirical verification against a fault-injecting gh shim, and writes the verdict.
- INCLUDE - lisa:learner - captures task MLD into the ledger.
- EXCLUDE - general-purpose - more specific specialists cover every task.
- EXCLUDE - claude - catch-all, and specialists fit.
- EXCLUDE - claude-code-guide - no Claude Code product question.
- EXCLUDE - code-simplifier:code-simplifier - quality-specialist covers simplification for a small change.
- EXCLUDE - hookify:conversation-analyzer - no hook-authoring need.
- EXCLUDE - lisa:architecture-specialist - single-module transport change; Explore covers data flow.
- EXCLUDE - lisa:builder - this is a Fix, so bug-fixer owns it.
- EXCLUDE - lisa:confluence-prd-intake / lisa:github-prd-intake / lisa:linear-prd-intake / lisa:notion-prd-intake - no PRD intake.
- EXCLUDE - lisa:debug-specialist - the cause is already established by the issue's instrumented replay (no retry in call()).
- EXCLUDE - lisa:eval-specialist - not measuring the factory.
- EXCLUDE - lisa:git-history-analyzer - Explore covers the relevant history (PR #4777).
- EXCLUDE - lisa:github-agent / lisa:jira-agent / lisa:linear-agent - the lead drives the lifecycle directly.
- EXCLUDE - lisa:github-build-intake / lisa:jira-build-intake / lisa:linear-build-intake - not an intake cycle.
- EXCLUDE - lisa:learning-judge / lisa:learnings-synthesizer / lisa:skill-evaluator - no debrief or promotion.
- EXCLUDE - lisa:performance-specialist - backoff is bounded and small; no perf surface.
- EXCLUDE - lisa:pr-mining-specialist / lisa:tracker-mining-specialist - debrief-only.
- EXCLUDE - lisa:product-specialist - no user-facing UI; the operator-facing message is covered by quality review.
- EXCLUDE - lisa:security-specialist - no auth, secret or input-trust change; retry does not widen permissions.
- EXCLUDE - lisa:spec-conformance-specialist - verification-specialist covers the small spec.
- EXCLUDE - lisa:test-specialist - bug-fixer writes the TDD tests and quality-specialist reviews them.
- EXCLUDE - Plan - the plan is small and the lead records it.
- EXCLUDE - statusline-setup - irrelevant.
- EXCLUDE - web-fetch - no external pages.

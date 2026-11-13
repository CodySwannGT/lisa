# Roster Decision — CodySwannGT/lisa#4689 (Fix: inline-code evidence markers)

Plan: fix-4689-inline-code-markers. Work type: Implement / Fix. Base: main (production=main).

INCLUDE - Explore - Required read-only research. It finds the inline-code handling and the existing tests.
INCLUDE - lisa:bug-fixer - Reproduces the bug as failing tests, then fixes it with TDD.
INCLUDE - lisa:verification-specialist - Independent empirical verification and the v2 verdict.
INCLUDE - lisa:quality-specialist - Code review after implementation.
INCLUDE - lisa:learner - Captures task learnings to the ledger.
EXCLUDE - general-purpose - Specific specialists cover every role.
EXCLUDE - claude - Catch-all. Specific specialists cover every role.
EXCLUDE - Plan - The fix is narrow and fully specified.
EXCLUDE - lisa:architecture-specialist - One function in one file, with no design decision to make.
EXCLUDE - lisa:debug-specialist - The issue gives the exact repro and cause, so there is no root cause to hunt for.
EXCLUDE - lisa:test-specialist - bug-fixer writes the regression tests, and the acceptance criteria name the cases.
EXCLUDE - lisa:builder - This is a fix, not a feature.
EXCLUDE - lisa:product-specialist - No user-facing UI or flow changes.
EXCLUDE - lisa:spec-conformance-specialist - Three Gherkin acceptance criteria. verification-specialist checks each one.
EXCLUDE - lisa:security-specialist - A parser change that touches no auth, secrets, or trust boundary.
EXCLUDE - lisa:performance-specialist - Not a hot path.
EXCLUDE - lisa:git-history-analyzer - The issue already cites the #4686 history.
EXCLUDE - lisa:learning-judge - Invoked by the learner/persist flow, not directly.
EXCLUDE - lisa:skill-evaluator - Invoked by the gardener, not by this flow.
EXCLUDE - lisa:learnings-synthesizer - Debrief only.
EXCLUDE - lisa:eval-specialist - Measures the factory, not this change.
EXCLUDE - lisa:github-agent - Already used as the bounded input-resolver. The lead runs the lifecycle.
EXCLUDE - lisa:jira-agent - Wrong tracker.
EXCLUDE - lisa:linear-agent - Wrong tracker.
EXCLUDE - lisa:github-build-intake - Batch intake flow, not a single item.
EXCLUDE - lisa:github-prd-intake - PRD flow, not a single item.
EXCLUDE - lisa:jira-build-intake - Wrong tracker and a batch flow.
EXCLUDE - lisa:linear-build-intake - Wrong tracker and a batch flow.
EXCLUDE - lisa:linear-prd-intake - PRD flow.
EXCLUDE - lisa:notion-prd-intake - PRD flow.
EXCLUDE - lisa:confluence-prd-intake - PRD flow.
EXCLUDE - lisa:pr-mining-specialist - Debrief only.
EXCLUDE - lisa:tracker-mining-specialist - Debrief only.
EXCLUDE - code-simplifier:code-simplifier - Small diff. quality-specialist covers it.
EXCLUDE - hookify:conversation-analyzer - Not relevant.
EXCLUDE - claude-code-guide - Not relevant.
EXCLUDE - statusline-setup - Not relevant.
EXCLUDE - web-fetch - No web pages needed.

Input-resolver: lisa:github-agent. Claim reused, binding verified, route implement.

Tool access preflight: gh (GitHub tracker and PR) was proven by the resolver's live read and claim. node and bun run locally. The proof command (`node -e` against `localMarkers`) needs no external system.

Completion condition: running the issue's repro lines against `all/copy-overwrite/scripts/lib/completion-proof-shape.mjs` prints `[]` for every inline-code-only case (escaped and plain, single and multiple backticks). A body with a top-level marker plus an inline-code quote returns exactly the top-level marker. The two #4670 top-level cases still return `[{"kind":"cli-output","name":"x"}]`. Constraint: fenced, indented, and HTML-comment handling and the malformed-marker refusal for top-level text stay unchanged.

Target Backend Environment: Assumption: none. The change is in a template script shipped through the npm release, and main is the PR base (deploy.branches production=main).

# Roster Decision — CodySwannGT/lisa#4740

Plan: 4740-evidence-release-docs — Fix (doc-only), base `main`, Target Backend Environment: None — doc-only.

INCLUDE - Explore - mandatory read-only research: locate every LISA_EVIDENCE_RELEASE mention in sources, generated copies, tests and phrase manifest.
INCLUDE - lisa:bug-fixer - Fix flow: reproduce the defect as a failing doc-contract test (RED), then apply the doc fix and regenerate plugin copies (GREEN).
INCLUDE - lisa:verification-specialist - independent verifier that runs the validation journey and writes the v2 verdict; must not be the implementer.
INCLUDE - lisa:quality-specialist - reviews the diff for correctness of the shell wording and test meaningfulness.
INCLUDE - lisa:learner - captures task MLD to the ledger per the flow contract.
EXCLUDE - general-purpose - specific specialists cover every task; no fallback needed.
EXCLUDE - claude - catch-all; specific specialists fit.
EXCLUDE - claude-code-guide - no Claude Code product questions.
EXCLUDE - code-simplifier:code-simplifier - doc-wording change, nothing to simplify beyond quality review.
EXCLUDE - hookify:conversation-analyzer - not analysing transcripts for hooks.
EXCLUDE - Plan - the issue already carries a precise technical approach.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - no external pages needed.
EXCLUDE - lisa:architecture-specialist - no design decisions; doc-only.
EXCLUDE - lisa:builder - this is a Fix; bug-fixer owns it.
EXCLUDE - lisa:debug-specialist - root cause is already proven in the issue (bash `export` discards substitution status).
EXCLUDE - lisa:test-specialist - single contract test; bug-fixer writes it, quality-specialist reviews it.
EXCLUDE - lisa:product-specialist - no user-facing product flow; docs for agents.
EXCLUDE - lisa:security-specialist - no auth/secret/input-handling change.
EXCLUDE - lisa:performance-specialist - no runtime code.
EXCLUDE - lisa:spec-conformance-specialist - acceptance criteria are small; verification-specialist checks them directly.
EXCLUDE - lisa:git-history-analyzer - history already summarized in the issue's Relationship Search.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:learning-judge / lisa:skill-evaluator / lisa:learnings-synthesizer - only invoked via persist-learning/gardener paths, not needed here.
EXCLUDE - lisa:pr-mining-specialist / lisa:tracker-mining-specialist - Debrief-only.
EXCLUDE - lisa:github-agent / lisa:jira-agent / lisa:linear-agent - lead drives the lifecycle; input already resolved.
EXCLUDE - lisa:*-build-intake / lisa:*-prd-intake (github, jira, linear, notion, confluence) - intake loops, not this flow.

## Preflight and completion condition

- Tool access preflight: `gh` (GitHub tracker + PR) — `gh issue view 4740 --repo CodySwannGT/lisa` passed via the resolver; `bun` — local build/test. No other external tool is required (doc-only, no deploy target).
- Completion condition: `grep -rn 'export LISA_EVIDENCE_RELEASE=\$(' plugins/` returns nothing; the new contract test passes and fails when the old line is restored; `bun run check:artifacts` passes; the stop-guard snippet exits 1 with the stop message when the resolver fails.

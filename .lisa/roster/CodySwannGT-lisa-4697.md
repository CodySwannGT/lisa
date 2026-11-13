# Roster Decision — CodySwannGT/lisa#4697 (Fix: Lisa Usage section swallows trailing non-heading content)

INCLUDE - github-agent - Served as the bounded input-resolver (read-only issue read).
INCLUDE - lisa:bug-fixer - Owns the Reproduce sub-flow (failing test first) and the TDD fix in usage-ledger.mjs.
INCLUDE - Explore - The lead ran the read-only search inline (the section-range finder is at all/copy-overwrite/scripts/lib/usage-ledger.mjs:87). The bug-fixer brief carries the findings.
INCLUDE - lisa:verification-specialist - Independent (non-implementer) empirical proof by running the real module; writes the v2 verdict.
INCLUDE - lisa:quality-specialist - Reviews the boundary change for correctness and backward compatibility with legacy layouts.
EXCLUDE - lisa:builder - Fix flow, not Build; bug-fixer covers it.
EXCLUDE - lisa:test-specialist - Regression tests are authored by bug-fixer; the scope is a handful of unit cases.
EXCLUDE - lisa:debug-specialist - Root cause is proven by reading the range finder (it ends at the next `##` or EOF).
EXCLUDE - lisa:architecture-specialist - Single-function boundary change, no design surface.
EXCLUDE - lisa:security-specialist - No auth, input-trust, or secret-handling change.
EXCLUDE - lisa:performance-specialist - No performance-relevant change.
EXCLUDE - lisa:product-specialist - No user-facing UI; library behavior only.
EXCLUDE - lisa:spec-conformance-specialist - The spec is two sentences; verification-specialist covers conformance.
EXCLUDE - lisa:learner - MLD is recorded in task metadata; no durable learning surfaced worth a ledger write.
EXCLUDE - lisa:git-history-analyzer, lisa:eval-specialist, lisa:learning-judge, lisa:skill-evaluator, lisa:learnings-synthesizer, lisa:pr-mining-specialist, lisa:tracker-mining-specialist - Debrief, gardener, and eval flows do not apply.
EXCLUDE - lisa:*-prd-intake, lisa:*-build-intake, lisa:jira-agent, lisa:linear-agent - Tracker is GitHub and this is not an intake flow.
EXCLUDE - general-purpose, claude, Plan, code-simplifier:code-simplifier, claude-code-guide, hookify:conversation-analyzer, statusline-setup, web-fetch - More specific specialists cover the work.

Target environment: None — no runtime behavior change to a deployed service. This is a library fix that ships through the npm release on main. Base: main. PR target: main.
Tool access: gh (probe: `gh issue view 4697 -R CodySwannGT/lisa`, pass). No other external tool is required.

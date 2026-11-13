# Roster Decision — CodySwannGT/lisa#4846

Work type: Implement / Fix (bug). Small change: one new shared `.mjs` grammar module, integrity-check wiring, TS writer re-pointing, tests, and regenerated artifacts.

INCLUDE - Explore - mandatory read-only research on the integrity check, reader grammar, and the #4699 writer module.
INCLUDE - general-purpose - the lead's bounded helpers (input resolution, branch/env resolution, PR plumbing); no more specific type covers tracker plumbing.
INCLUDE - lisa:bug-fixer - reproduces the defect as a failing test, then fixes it through TDD.
INCLUDE - lisa:verification-specialist - independent empirical proof (the Validation Journey `bun -e` runs) and the v2 verdict; must not be the implementer.
INCLUDE - lisa:quality-specialist - reviews correctness, coding philosophy, and test quality on the diff.
INCLUDE - lisa:learner - captures task MLD to the learnings ledger.
EXCLUDE - lisa:test-specialist - bug-fixer writes the failing test; the test matrix is three Gherkin scenarios, not enough for a separate strategist.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist covers the three ACs directly; scope is too small for a separate matrix.
EXCLUDE - lisa:product-specialist - no user-visible UI or UX surface; the change is an internal integrity check.
EXCLUDE - lisa:architecture-specialist - the Technical Approach already fixes the design (one shared module, two importers).
EXCLUDE - lisa:security-specialist - no auth, secrets, or input surface beyond string-grammar validation.
EXCLUDE - lisa:performance-specialist - a constant-time regex check, so no performance surface.
EXCLUDE - lisa:debug-specialist - the root cause is already established in the issue (the check never inspects artifact_ref).
EXCLUDE - lisa:builder - this is a Fix, so bug-fixer owns it.
EXCLUDE - lisa:git-history-analyzer - the resolver already captured the relevant history; Explore covers the rest.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:learning-judge / lisa:skill-evaluator / lisa:learnings-synthesizer / lisa:pr-mining-specialist / lisa:tracker-mining-specialist - debrief/gardener flows, not Implement.
EXCLUDE - lisa:github-agent / lisa:jira-agent / lisa:linear-agent - lifecycle dispatchers; this skill is already the lifecycle.
EXCLUDE - lisa:*-build-intake / lisa:*-prd-intake - intake cycles, not single-item implementation.
EXCLUDE - Plan - the Technical Approach is already prescriptive.
EXCLUDE - claude / claude-code-guide / statusline-setup / web-fetch / hookify:conversation-analyzer / code-simplifier:code-simplifier - not relevant to this task (quality-specialist covers simplification).

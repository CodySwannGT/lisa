# Roster Decision — CodySwannGT/lisa#4508

Plan: `4508-oxlint-force-range` — stop `package-lisa` `force.devDependencies` from downgrading hosts already on a newer, still-compatible oxlint (<1.86.0).

Flow: Implement / Fix (bug). Target environment: production (`main`) by assumption — remote default branch `main`; the change ships through the npm release on merge.

```text
INCLUDE - Explore - mandatory read-only research: locate the force merge implementation, template entries, tests, and git history of 096032a7.
INCLUDE - lisa:bug-fixer - Fix flow: reproduce the downgrade as a failing test, then fix via TDD.
INCLUDE - lisa:quality-specialist - independent review of correctness, test meaningfulness, and coding-philosophy compliance.
INCLUDE - lisa:verification-specialist - independent empirical proof (run lisa apply against a fixture host) and the v2 verdict; implementer may not self-certify.
INCLUDE - lisa:learner - capture task MLD to the learnings ledger.
EXCLUDE - general-purpose - every role has a more specific specialist; lead does plan naming/branch steps inline.
EXCLUDE - Plan - change is small and well-specified by the issue; bug-fixer + Explore cover design.
EXCLUDE - lisa:architecture-specialist - no new architecture; a localized change to merge semantics.
EXCLUDE - lisa:builder - this is a Fix, bug-fixer owns it.
EXCLUDE - lisa:test-specialist - bug-fixer writes the reproducing test; quality-specialist reviews test quality.
EXCLUDE - lisa:debug-specialist - cause is stated precisely in the issue (exact pin in force); no unknown defect to diagnose.
EXCLUDE - lisa:product-specialist - no user-visible UI/UX surface.
EXCLUDE - lisa:spec-conformance-specialist - small spec; verification-specialist checks the stated outcome directly.
EXCLUDE - lisa:security-specialist - no auth/secrets/input-handling surface touched.
EXCLUDE - lisa:performance-specialist - no performance surface.
EXCLUDE - lisa:git-history-analyzer - Explore covers the single relevant commit (096032a7).
EXCLUDE - lisa:github-agent - lead runs the lifecycle via skills directly.
EXCLUDE - lisa:github-build-intake / lisa:jira-build-intake / lisa:linear-build-intake - intake cycles, not single-item work.
EXCLUDE - lisa:github-prd-intake / lisa:confluence-prd-intake / lisa:linear-prd-intake / lisa:notion-prd-intake - PRD intake, not applicable.
EXCLUDE - lisa:jira-agent / lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:eval-specialist - measures the factory, not this change.
EXCLUDE - lisa:learning-judge / lisa:skill-evaluator / lisa:learnings-synthesizer - invoked by learner/persist flows, not directly.
EXCLUDE - lisa:pr-mining-specialist / lisa:tracker-mining-specialist - debrief-only.
EXCLUDE - claude / claude-code-guide / statusline-setup / web-fetch / hookify:conversation-analyzer / code-simplifier:code-simplifier - not relevant to this change.
```

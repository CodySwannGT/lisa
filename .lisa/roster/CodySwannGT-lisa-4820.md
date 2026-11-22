# Roster Decision — CodySwannGT/lisa#4820

Plan: session-manager-setup-gap-persist. Flow: Implement / Fix (type:Bug). Base: main (Assumption: production — remote default branch main; Branch Plan matches).

- INCLUDE - Explore - mandatory read-only research of the session-manager scripts, ledger control block, and existing tests.
- INCLUDE - lisa:bug-fixer - Fix flow: reproduce as failing tests (queue offers gap repo; spawn re-launches) then implement via TDD.
- INCLUDE - lisa:quality-specialist - post-implementation review of correctness, coding philosophy, test quality.
- INCLUDE - lisa:verification-specialist - independent empirical verification of the Validation Journey via the CLI with the stub claude, writes verdict.
- INCLUDE - lisa:learner - capture task MLD learnings to the ledger.
- INCLUDE - general-purpose - lead-session planning helper (plan name, base branch, completion condition) per skill; no specialist fits that bookkeeping.
- EXCLUDE - lisa:builder - bug-fixer covers the TDD implementation for a Bug.
- EXCLUDE - lisa:test-specialist - bug-fixer writes the reproduction tests; quality-specialist reviews them.
- EXCLUDE - lisa:architecture-specialist - Technical Approach is fully specified on the issue (files, ledger shape, command name).
- EXCLUDE - lisa:debug-specialist - root cause already established by code reading (queue has no setup-gap filter).
- EXCLUDE - lisa:security-specialist - no auth/secret/input-trust surface changes; repo names are config-derived.
- EXCLUDE - lisa:performance-specialist - trivial map lookup, no performance surface.
- EXCLUDE - lisa:product-specialist - CLI-only operator messaging; ACs already in Gherkin.
- EXCLUDE - lisa:spec-conformance-specialist - verification-specialist covers the 4 ACs + journey directly for this small leaf.
- EXCLUDE - lisa:git-history-analyzer - origin (#4503) is known; Explore covers needed history.
- EXCLUDE - lisa:learning-judge, lisa:skill-evaluator, lisa:learnings-synthesizer, lisa:tracker-mining-specialist, lisa:pr-mining-specialist, lisa:eval-specialist - debrief/gardener/eval flows, not Implement.
- EXCLUDE - lisa:github-agent, lisa:jira-agent, lisa:linear-agent, lisa:*-build-intake, lisa:*-prd-intake - tracker lifecycle/intake dispatchers; this flow is already dispatched and claimed.
- EXCLUDE - Plan - Technical Approach already specified.
- EXCLUDE - code-simplifier:code-simplifier - quality-specialist covers simplification.
- EXCLUDE - claude, claude-code-guide, hookify:conversation-analyzer, statusline-setup, web-fetch - not relevant to this change.

Tool access preflight: gh (tracker/PR) — `gh issue view 4820` pass; bun/node local — pass. No external systems needed (CLI-only verification with stub claude).

Completion condition: in a sandbox state dir with the stub claude, `spawn <ref>` with an unknown-command first-prompt exits 2 and the ledger control block records `setupGaps[<repo>]`; `queue` then omits that repo's items and names the reason; a second `spawn` exits 2 without launching; `ledger clear-setup-gap <repo>` then `queue` offers the items again. Constraints: other repos' items still offered; no change to first-prompt detection.

# Roster Decision — CodySwannGT/lisa#4738

Plan: `4738-stale-evidence-context` — let a stale third-party evidence check run be cleared (dispatch `context` input + publish under every declared reviewer context + doctor gap).
Work type: Fix (bug). Target: production → `main` (Assumption, from config). Route: implement.

INCLUDE - lisa:github-agent - Bounded input-resolver: read, claim (reused) and bind #4738.
INCLUDE - Explore - Mandatory read-only research of the prover, both workflow copies, the seed/doctor modules and their tests.
INCLUDE - lisa:bug-fixer - Fix flow: reproduce as failing tests (RED) then implement the fix (GREEN) via TDD.
INCLUDE - lisa:quality-specialist - Independent review of correctness, test quality and coding philosophy on the diff.
INCLUDE - lisa:verification-specialist - Independent (non-implementer) empirical verification and the v2 verdict.
INCLUDE - lisa:learner - Capture task MLD learnings to the ledger.
INCLUDE - general-purpose - Lead-session helper steps the skill assigns to it (plan name, base branch, completion condition); no closer specialist exists for those.
EXCLUDE - lisa:test-specialist - Test cases are fully enumerated in the ticket's Technical Approach; bug-fixer writes them under TDD.
EXCLUDE - lisa:architecture-specialist - Ticket already records the design decision (publish under every declared context; issue_comment trigger rejected).
EXCLUDE - lisa:debug-specialist - Cause is already proven in the ticket (no context input; publish name from waking context only).
EXCLUDE - lisa:security-specialist - No auth/secret surface changes; workflow input is passed via env to a node script, not interpolated into shell — quality review covers that.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the four Gherkin scenarios directly.
EXCLUDE - lisa:product-specialist - No user-facing UI; CI-only behavior.
EXCLUDE - lisa:performance-specialist - No performance-sensitive path.
EXCLUDE - lisa:builder - Fix flow uses bug-fixer.
EXCLUDE - lisa:git-history-analyzer - Explore covers the one relevant commit (#4630 fix).
EXCLUDE - lisa:eval-specialist, lisa:learning-judge, lisa:skill-evaluator, lisa:learnings-synthesizer, lisa:pr-mining-specialist, lisa:tracker-mining-specialist - Debrief/gardener roles, not part of an Implement flow.
EXCLUDE - lisa:jira-agent, lisa:linear-agent - Tracker is GitHub.
EXCLUDE - lisa:*-build-intake, lisa:*-prd-intake - Intake dispatchers; this is a single direct item.
EXCLUDE - Plan - Plan is fully specified by the ticket's Technical Approach.
EXCLUDE - claude, claude-code-guide, code-simplifier:code-simplifier, hookify:conversation-analyzer, statusline-setup, web-fetch - Not relevant to this fix.

# Roster Decision — CodySwannGT/lisa#4628

Work type: Implement / Fix (bug) — third-party review evidence prover counts substitute markers from any author.

INCLUDE - Explore - mandatory read-only research: locate prover, gate, tests, workflow, skill text on current main.
INCLUDE - general-purpose - lead-session setup steps the skill assigns to it (plan name, base branch, completion condition, tool preflight); no more specific type owns these.
INCLUDE - lisa:bug-fixer - Fix flow: reproduce as failing tests (the five AC cases) then fix via TDD.
INCLUDE - lisa:quality-specialist - independent review of the change for correctness and coding-philosophy compliance.
INCLUDE - lisa:security-specialist - the change is an authorization rule (who may substitute for a required review); needs threat review.
INCLUDE - lisa:verification-specialist - independent empirical verification (offline prover/gate agreement CLI run) and the v2 verdict.
INCLUDE - lisa:learner - capture task MLD to the learnings ledger.
EXCLUDE - lisa:debug-specialist - root cause is already proven in the issue body (plain `includes` check, no author filter).
EXCLUDE - lisa:builder - this is a Fix, bug-fixer owns TDD.
EXCLUDE - lisa:test-specialist - the five test cases are fully specified as Gherkin; bug-fixer writes them.
EXCLUDE - lisa:architecture-specialist - scope is two scripts plus a shared lib; design choice stated in the ticket.
EXCLUDE - lisa:product-specialist - no user-facing product surface; CI script behavior only.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist plus quality review cover the five ACs directly.
EXCLUDE - lisa:performance-specialist - no performance surface (a per-login cached API read).
EXCLUDE - lisa:git-history-analyzer - #4528 history already summarized in the ticket.
EXCLUDE - lisa:eval-specialist, lisa:learning-judge, lisa:skill-evaluator, lisa:learnings-synthesizer, lisa:pr-mining-specialist, lisa:tracker-mining-specialist - debrief/gardener roles, not part of a single-item fix.
EXCLUDE - lisa:github-agent, lisa:jira-agent, lisa:linear-agent - this flow already owns the item lifecycle.
EXCLUDE - lisa:confluence-prd-intake, lisa:github-prd-intake, lisa:linear-prd-intake, lisa:notion-prd-intake, lisa:github-build-intake, lisa:jira-build-intake, lisa:linear-build-intake - intake roles, not implementation.
EXCLUDE - Plan - planning is small and done by the lead; bug-fixer handles implementation planning.
EXCLUDE - claude, claude-code-guide, statusline-setup, hookify:conversation-analyzer, code-simplifier:code-simplifier - not relevant to this fix.

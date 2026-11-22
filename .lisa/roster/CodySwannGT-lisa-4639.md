# Roster Decision — CodySwannGT/lisa#4639

Plan: `4639-jira-evidence-pr-scoped-assets` — Fix (bug). Scope a Jira evidence upload's release asset names to its pull request.

- INCLUDE - Explore - Read-only research of the three post-evidence.sh copies, generators, existing tests and generated variants (mandatory).
- INCLUDE - lisa:bug-fixer - Owns the Reproduce sub-flow (failing stubbed-gh test on main) and the TDD fix across scripts, generators and docs.
- INCLUDE - lisa:quality-specialist - Independent review of the diff for correctness and test meaningfulness.
- INCLUDE - lisa:verification-specialist - Independent empirical proof (stubbed-gh two-PR run) and the v2 verdict; must not be the implementer.
- INCLUDE - lisa:learner - Captures task MLD to the learnings ledger.
- EXCLUDE - claude - Catch-all; specific specialists cover every task.
- EXCLUDE - claude-code-guide - No Claude Code product question involved.
- EXCLUDE - general-purpose - Specific specialists fit every task; the lead performs the small orchestration steps itself.
- EXCLUDE - Plan - The issue's Technical Approach already names the design.
- EXCLUDE - statusline-setup - Unrelated.
- EXCLUDE - web-fetch - No public pages needed; gh covers GitHub.
- EXCLUDE - code-simplifier:code-simplifier - Change is a small shell/python edit; quality-specialist covers simplification.
- EXCLUDE - hookify:conversation-analyzer - Not analysing transcripts.
- EXCLUDE - lisa:architecture-specialist - Design fixed by the ticket; no cross-module architecture.
- EXCLUDE - lisa:builder - This is a Fix; bug-fixer owns it.
- EXCLUDE - lisa:debug-specialist - Root cause already proven in the ticket with line citations.
- EXCLUDE - lisa:test-specialist - Tests are specified by the ticket; bug-fixer writes them TDD-first and quality-specialist reviews them.
- EXCLUDE - lisa:security-specialist - No auth/secret handling change; the scripts' token handling is untouched.
- EXCLUDE - lisa:performance-specialist - No performance surface.
- EXCLUDE - lisa:product-specialist - No user-facing UI; the outcome is an asset-naming contract.
- EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the four Gherkin scenarios directly; small scope.
- EXCLUDE - lisa:eval-specialist - Not measuring the factory.
- EXCLUDE - lisa:git-history-analyzer - Ticket already records the relevant history.
- EXCLUDE - lisa:learning-judge - Invoked by learner/persist-learning only when needed.
- EXCLUDE - lisa:skill-evaluator - No routing judgment needed.
- EXCLUDE - lisa:learnings-synthesizer, lisa:pr-mining-specialist, lisa:tracker-mining-specialist - Debrief-only.
- EXCLUDE - lisa:github-agent, lisa:jira-agent, lisa:linear-agent - This flow is already the lifecycle; github-agent only served as the bounded input-resolver.
- EXCLUDE - lisa:github-build-intake, lisa:jira-build-intake, lisa:linear-build-intake, lisa:github-prd-intake, lisa:jira/notion/confluence/linear-prd-intake - Intake flows, not implementation.

Tool access preflight: `gh` (probe `gh auth status` + `gh issue view 4639`): pass. No Jira/Figma/AWS needed — tests run offline against a stubbed `gh`. maestro/playwright not required (no UI surface).

Target environment: `Assumption: production — remote default branch main` → base `main`; Branch Plan matches (branch from main, PR into main).

Completion condition: a stubbed-`gh` run of `post-evidence.sh` for PRs 101 then 102 with the same `01-search-step-desktop.png` and `01-health-check.json` records uploads named `pr-101-…` and `pr-102-…` (no bare names), the contract test over every source and generated copy passes and fails on main, and the generators link `pr-<n>-<file>`. Constraint: Jira attachment behaviour and status transitions unchanged.

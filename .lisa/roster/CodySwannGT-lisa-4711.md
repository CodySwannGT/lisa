# Roster Decision — CodySwannGT/lisa#4711

Plan: `4711-absent-required-checks-pending` — Fix (bug), single repo-only script
(`scripts/lisa-ci-failure-redispatch.mjs`), no UI, no persistent state.

- INCLUDE - lisa:github-agent - Served as the bounded input-resolver (read #4711, its graph and comments).
- INCLUDE - lisa:builder - Implements the fix TDD-first: three fixtures, red tests, then the absent-context guard.
- INCLUDE - lisa:verification-specialist - Independent verifier; runs the dry-run fixtures and the live post-merge dry run and writes the v2 verdict.
- INCLUDE - lisa:quality-specialist - Reviews the diff for correctness, lint budgets (300 lines/file, 75/function) and test quality.
- INCLUDE - lisa:learner - Captures task MLD into the learnings ledger at the end.
- INCLUDE - Explore - Required read-only research member; the lead's own read of the script, its 8 test files, 19 fixtures and the live ruleset already covers the research, so it is spawned only if a question outgrows that.
- EXCLUDE - lisa:bug-fixer - The reproduction is a deterministic fixture replay the builder writes as its red test; one implementer avoids two agents editing the same file.
- EXCLUDE - lisa:test-specialist - Test matrix is fixed by the ticket (three named fixtures); builder writes them.
- EXCLUDE - lisa:debug-specialist - Root cause is already proven in the ticket (absent rows treated as passing in classifyRequiredChecks).
- EXCLUDE - lisa:architecture-specialist - One-function change inside an existing module; no design choice beyond reusing requiredContexts.
- EXCLUDE - lisa:product-specialist - No user-facing surface; behaviour is a CI automation outcome.
- EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the three Gherkin scenarios directly; scope is small.
- EXCLUDE - lisa:security-specialist - No new input, auth, or secret handling; reads an existing GitHub API endpoint already used by the script.
- EXCLUDE - lisa:performance-specialist - Adds at most one API read, only on the pass path.
- EXCLUDE - lisa:git-history-analyzer - History already summarized in the ticket's Relationship Search.
- EXCLUDE - lisa:eval-specialist - Not measuring the factory.
- EXCLUDE - lisa:learning-judge / lisa:skill-evaluator / lisa:learnings-synthesizer / lisa:pr-mining-specialist / lisa:tracker-mining-specialist - Debrief/gardener roles, not part of an Implement flow.
- EXCLUDE - lisa:jira-agent / lisa:linear-agent / lisa:*-build-intake / lisa:*-prd-intake - Tracker is GitHub; no intake cycle.
- EXCLUDE - general-purpose / claude / Plan / claude-code-guide / code-simplifier:code-simplifier / hookify:conversation-analyzer / statusline-setup - A specific specialist covers each needed role.

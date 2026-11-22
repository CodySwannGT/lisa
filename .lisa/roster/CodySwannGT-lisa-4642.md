# Roster Decision — CodySwannGT/lisa#4642

Plan: opencode-emit-shared-scripts (Fix: OpenCode emit omits shared `../../../scripts/` modules)

- INCLUDE - lisa:github-agent - bounded input-resolver; read the issue and its graph.
- INCLUDE - lisa:bug-fixer - Fix flow: reproduce as failing tests (import-resolution guard + `--help` e2e), then fix via TDD.
- INCLUDE - Explore - mandatory read-only research; folded into the bug-fixer's brief (single installer file, research is small) rather than a separate spawn.
- INCLUDE - lisa:verification-specialist - independent empirical proof: emit into scratch project, run `session-manager.mjs --help`, write the verdict.
- INCLUDE - lisa:quality-specialist - independent review of the diff before PR.
- INCLUDE - lisa:learner - capture task MLD into the learnings ledger.
- EXCLUDE - claude - catch-all; specific specialists cover every role.
- EXCLUDE - claude-code-guide - no Claude Code product question.
- EXCLUDE - code-simplifier:code-simplifier - quality-specialist covers it for a small diff.
- EXCLUDE - general-purpose - specific specialists fit every role.
- EXCLUDE - hookify:conversation-analyzer - no hook authoring.
- EXCLUDE - lisa:architecture-specialist - approach is prescribed by the issue's Technical Approach.
- EXCLUDE - lisa:builder - this is a Fix, bug-fixer owns it.
- EXCLUDE - lisa:confluence-prd-intake / lisa:github-prd-intake / lisa:linear-prd-intake / lisa:notion-prd-intake - no PRD intake.
- EXCLUDE - lisa:debug-specialist - root cause already proven in the issue with file/line evidence.
- EXCLUDE - lisa:eval-specialist - not measuring the factory.
- EXCLUDE - lisa:git-history-analyzer - issue already records the history.
- EXCLUDE - lisa:github-build-intake / lisa:jira-build-intake / lisa:linear-build-intake - not an intake cycle.
- EXCLUDE - lisa:jira-agent / lisa:linear-agent - tracker is GitHub.
- EXCLUDE - lisa:learning-judge / lisa:learnings-synthesizer / lisa:skill-evaluator - invoked by persist/gardener paths, not this flow.
- EXCLUDE - lisa:performance-specialist - copy of a few files; no perf surface.
- EXCLUDE - lisa:pr-mining-specialist / lisa:tracker-mining-specialist - debrief-only.
- EXCLUDE - lisa:product-specialist - no user-facing UX change; behavior is "CLI loads".
- EXCLUDE - lisa:security-specialist - copies Lisa-owned files only; no new trust boundary.
- EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the three Gherkin scenarios directly.
- EXCLUDE - lisa:test-specialist - bug-fixer writes the tests; quality-specialist reviews them.
- EXCLUDE - Plan - approach prescribed.
- EXCLUDE - statusline-setup - unrelated.
- EXCLUDE - web-fetch - no web sources needed.

Base branch: main (Target Backend Environment `Assumption: production — remote default branch main`; deploy.branches production=main; Branch Plan matches).
Tool access: gh (GitHub) — probe `gh issue view 4642` passed; node/bun local. No other external tools.
Completion condition: from a scratch project emitted by the fixed OpenCode installer, `node .opencode/skills/lisa/lisa-session-manager/scripts/session-manager.mjs --help` exits 0 and prints help; the guard test resolves every relative import of every emitted `.mjs` inside the emitted tree and fails naming importer+target when one escapes. Constraint: no non-OpenCode runtime output changes.

# Roster Decision — CodySwannGT/lisa#4609 (fold phrase-only doc tests into a required-phrases manifest)

Flow: Implement / Improve (test-only refactor; Target Backend Environment: None — no runtime behavior change: test-only; base `main`, no branch plan required).

INCLUDE - Explore - mandatory read-only research: locate phrase-only test files, vitest config, existing test helpers and conventions.
INCLUDE - lisa:builder - implements classifier, TS-compiler-API manifest generator, data-driven test, deletions and before/after proof check via TDD.
INCLUDE - lisa:quality-specialist - reviews the generator/classifier for correctness and that protection is preserved identically.
INCLUDE - lisa:verification-specialist - independent verifier; runs the proof commands (classifier, before/after count, mutate-a-phrase red check) and writes the verdict.
INCLUDE - lisa:learner - captures task MLD to the learnings ledger.
EXCLUDE - general-purpose - more specific specialists cover every task.
EXCLUDE - claude - catch-all; specialists cover the work.
EXCLUDE - Plan - the issue carries an owner-approved technical approach; builder plans the TDD sequence.
EXCLUDE - lisa:architecture-specialist - design fixed by the ticket; no architectural choice open.
EXCLUDE - lisa:test-specialist - builder owns the single data-driven test; quality-specialist reviews test quality.
EXCLUDE - lisa:bug-fixer - not a bug.
EXCLUDE - lisa:debug-specialist - no defect to diagnose.
EXCLUDE - lisa:product-specialist - no user-facing behavior change.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the four Gherkin scenarios directly; small scope.
EXCLUDE - lisa:security-specialist - test-only change, no auth/secrets/input surface.
EXCLUDE - lisa:performance-specialist - perf impact is file-count only, measured by the AC.
EXCLUDE - code-simplifier:code-simplifier - generated data; quality review suffices.
EXCLUDE - lisa:git-history-analyzer - Explore covers the needed history.
EXCLUDE - lisa:github-agent - input already resolved; lead owns tracker writes.
EXCLUDE - lisa:eval-specialist, lisa:learning-judge, lisa:skill-evaluator, lisa:learnings-synthesizer, lisa:pr-mining-specialist, lisa:tracker-mining-specialist - debrief/gardener roles, not part of an Implement flow.
EXCLUDE - lisa:confluence-prd-intake, lisa:github-prd-intake, lisa:linear-prd-intake, lisa:notion-prd-intake, lisa:github-build-intake, lisa:jira-build-intake, lisa:linear-build-intake, lisa:jira-agent, lisa:linear-agent - intake/other-tracker agents; not applicable.
EXCLUDE - claude-code-guide, statusline-setup, hookify:conversation-analyzer - unrelated tooling.

Tool access preflight: gh (CodySwannGT/lisa) — pass (issue read succeeded). bun/vitest local — probed by builder. No external systems required.

Completion condition: `node scripts/classify-phrase-tests.mjs` lists the phrase-only files on the base commit; the before/after check script exits 0 reporting base phrase-assertion count == manifest entries + listed untranslatable; `vitest run tests/unit/docs/required-phrases.test.ts` passes; deleting one required phrase from a manifest file makes that test fail naming file+phrase; adding a forbidden phrase fails naming file+phrase. Constraint: no non-phrase-only test file deleted; full unit suite still green.

## Resume session — 2026-11-08 (after blocker #4701 released)

Scope: rebase the finished branch onto `main` (124 commits behind); address the three review points from comments 6–7 on `tests/integration/rails-rspec-shard-ruby.test.ts` (comment wording; RubyGems-free version probe run without inherited `RUBYOPT`; probe the same Ruby the drivers use); re-run the phrase-manifest parity proof on the rebased tree; push through the required push gate; open the PR; drive it to merge.

INCLUDE - Explore - mandatory read-only research: the Ruby probe, how the drivers resolve Ruby, and what changed on main that touches phrase-only tests.
INCLUDE - lisa:builder - rebase/conflict resolution, manifest regeneration if main changed phrase tests, Ruby probe fixes.
INCLUDE - lisa:quality-specialist - reviews the rebased diff and the probe change.
INCLUDE - lisa:verification-specialist - independent verifier; re-runs parity, mutate-a-phrase red checks, and the probe under RUBYOPT=--disable-gems; writes the verdict.
INCLUDE - lisa:learner - captures this session's MLD to the ledger.
EXCLUDE - general-purpose - plan name, base (`main`; Target Backend Environment "None — test-only", so no branch plan), flow (Implement/Improve) and completion condition are recorded above; the lead carries them forward.
INCLUDE - lisa:debug-specialist - added mid-flow: push gate failed on tests/integration/npm-update-dual-lock.test.ts ("Bun executable is aliased"), untouched by this branch; prove whether it reproduces on origin/main and why.
EXCLUDE - all other types - same reasons as the original roster above.

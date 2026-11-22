# Roster Decision — CodySwannGT/lisa#4608

Plan: bounded-ci-watch (E2 · Story #4588 · Epic #4582). Flow: Implement / Improve — skill-contract prose plus a contract test.

INCLUDE - Explore - mandatory read-only research of the drive-pr skill, its plugin copies, and the drive-pr contract test family.
INCLUDE - lisa:builder - implements the SKILL.md section 2 change and the contract test via TDD.
INCLUDE - lisa:quality-specialist - independent review of the diff for correctness and test quality.
INCLUDE - lisa:verification-specialist - independent empirical verification of the Validation Journey and the v2 verdict.
INCLUDE - lisa:learner - captures task MLD to the learnings ledger.
INCLUDE - general-purpose - lead bookkeeping only (plan name, base branch, completion condition) where no specialist fits.
EXCLUDE - claude - catch-all; specific specialists cover every role.
EXCLUDE - claude-code-guide - no Claude Code product questions.
EXCLUDE - code-simplifier:code-simplifier - prose plus a small test; quality-specialist covers clarity.
EXCLUDE - hookify:conversation-analyzer - not analyzing transcripts for hooks.
EXCLUDE - lisa:architecture-specialist - Technical Approach is fully specified by the ticket.
EXCLUDE - lisa:bug-fixer - not a Fix flow.
EXCLUDE - lisa:confluence-prd-intake - no PRD intake.
EXCLUDE - lisa:debug-specialist - no defect to root-cause.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - ticket's Relationship Search already captured relevant history (1b78504374); Explore covers the rest.
EXCLUDE - lisa:github-agent - used only as the bounded input-resolver.
EXCLUDE - lisa:github-build-intake - not an intake cycle.
EXCLUDE - lisa:github-prd-intake - no PRD intake.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - invoked by persist-learning only if a candidate arises.
EXCLUDE - lisa:learnings-synthesizer - Debrief-only.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - tracker is GitHub.
EXCLUDE - lisa:notion-prd-intake - no PRD intake.
EXCLUDE - lisa:performance-specialist - no runtime performance surface.
EXCLUDE - lisa:pr-mining-specialist - Debrief-only.
EXCLUDE - lisa:product-specialist - no user-facing UI flow; acceptance criteria already Gherkin.
EXCLUDE - lisa:security-specialist - no auth/secrets/input surface touched.
EXCLUDE - lisa:skill-evaluator - advisory learnings routing; not needed.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the four Gherkin scenarios directly.
EXCLUDE - lisa:test-specialist - one contract test extending an existing family; builder writes, quality reviews.
EXCLUDE - lisa:tracker-mining-specialist - Debrief-only.
EXCLUDE - Plan - plan is specified in the ticket.
EXCLUDE - statusline-setup - unrelated.

## Base branch
Target Backend Environment: `Assumption: production — remote default branch main` → deploy.branches production=main. Branch Plan matches (branch from main, PR into main). Feature branch `worktree-4608-bounded-ci-watch` is at origin/main (0 behind).

## Tool access preflight
- gh: `gh auth status` — pass.
- bun 1.3.5: `bun --version` — pass.
- No AWS/Figma/Sentry/browser needed; maestro preflight block is irrelevant (no mobile surface). No e2e harness applies to skill prose (regression coverage = contract unit test).

## Completion condition
`bun run test:unit -- tests/unit/strategies/drive-pr` passes, including a new contract test that fails when the bounded-watch instruction or CI PENDING report is removed or a background-watcher instruction is added; `bun run check:plugins` passes; Validation Journey greps show the bounded watch and only the prohibition; PR merged to main with green required checks.
Constraints: existing watch-loop rules (poll by PR number, re-read hold label, refresh lease, 1b78504374 guidance) remain intact.

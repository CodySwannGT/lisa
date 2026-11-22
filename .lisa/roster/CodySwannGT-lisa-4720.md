# Roster decision — CodySwannGT/lisa#4720

Plan: evidence-release-prune. Work type: Implement / Build (Task). Runtime: Claude Code (implicit team via Agent).

INCLUDE - lisa:github-agent - Served as the bounded input-resolver (read, reused claim, worktree binding).
INCLUDE - Explore - Mandatory read-only research: find the merged #4692 release resolver, the completion-proof shapes, and the test transport conventions.
INCLUDE - lisa:builder - Implements the prune script and pure library via TDD against the Gherkin acceptance criteria.
INCLUDE - lisa:quality-specialist - Independent review of correctness, immutability, and test meaningfulness of the new script.
INCLUDE - lisa:security-specialist - The --apply path deletes release assets; an independent review of the delete-safety invariants (pinned set, read-back before delete, fail-closed) is warranted.
INCLUDE - lisa:spec-conformance-specialist - Check every acceptance scenario, out-of-scope item, and the single-resolver constraint.
INCLUDE - lisa:verification-specialist - Independent read-only dry-run against the real pr-assets release and the v2 verdict.
INCLUDE - lisa:learner - Capture task MLD telemetry to the ledger.
EXCLUDE - lisa:test-specialist - The builder owns the TDD test file the issue fully specifies; quality-specialist reviews it.
EXCLUDE - lisa:product-specialist - Operator-facing output is a CLI report whose wording the issue specifies verbatim; spec-conformance covers it.
EXCLUDE - lisa:architecture-specialist - The issue names the exact files and shape; Explore covers the resolver reuse question.
EXCLUDE - lisa:bug-fixer - Build, not a fix.
EXCLUDE - lisa:debug-specialist - No defect to diagnose.
EXCLUDE - lisa:performance-specialist - Bounded CLI over at most ~1000 assets; no performance surface.
EXCLUDE - lisa:git-history-analyzer - Relationship search is recorded on the issue; Explore covers recent #4729 history.
EXCLUDE - lisa:learning-judge - Invoked only through lisa-persist-learning if a candidate arises.
EXCLUDE - lisa:skill-evaluator - No routing of knowledge needed.
EXCLUDE - lisa:eval-specialist - Not measuring the factory.
EXCLUDE - lisa:learnings-synthesizer - Debrief-only.
EXCLUDE - lisa:pr-mining-specialist - Debrief-only.
EXCLUDE - lisa:tracker-mining-specialist - Debrief-only.
EXCLUDE - lisa:jira-agent - Tracker is GitHub.
EXCLUDE - lisa:linear-agent - Tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - Not an intake cycle.
EXCLUDE - lisa:linear-build-intake - Not an intake cycle.
EXCLUDE - lisa:github-build-intake - Not an intake cycle.
EXCLUDE - lisa:github-prd-intake - No PRD.
EXCLUDE - lisa:notion-prd-intake - No PRD.
EXCLUDE - lisa:confluence-prd-intake - No PRD.
EXCLUDE - lisa:linear-prd-intake - No PRD.
EXCLUDE - general-purpose - Specific specialists cover every role.
EXCLUDE - Plan - Explore plus builder cover planning for a fully specified leaf.
EXCLUDE - claude - Catch-all; specific specialists fit.
EXCLUDE - claude-code-guide - No Claude Code product question.
EXCLUDE - code-simplifier:code-simplifier - quality-specialist covers simplification review.
EXCLUDE - hookify:conversation-analyzer - Not analyzing transcripts.
EXCLUDE - statusline-setup - Unrelated.
EXCLUDE - web-fetch - No public page needed.

## Tool access preflight
- gh (GitHub API, release read for dry-run verification): probe `gh api repos/CodySwannGT/lisa/releases/tags/pr-assets --jq .id` — see plan.
- Node/Bun: local.
- maestro (preflight BLOCKED): not needed — no mobile surface in this item.

## Completion condition
`node all/copy-overwrite/scripts/lisa-evidence-prune.mjs --release pr-assets` exits 0, prints total equal to the live paginated asset count, every completion-*.json counted pinned, and the asset count is unchanged afterwards; `--release does-not-exist` exits non-zero with a plain-language error; the unit suite covering every Gherkin scenario passes. Constraint: no asset in the real release is created, moved or deleted.

# Roster Decision — CodySwannGT/lisa#4694

Plan: 4694-sweep-json-flush — Fix: flush the cleanup sweep's full `--json` output before exiting.
Work type: Fix (type:Bug). Base: `main` (Assumption: production — remote default branch main; Branch Plan matches config).

INCLUDE - Explore - Mandatory read-only research: CLI entry point, existing sweep tests, harness for piped child-process tests.
INCLUDE - lisa:bug-fixer - Reproduces the truncation as a failing piped-output test, then applies the smallest exit-path fix via TDD.
INCLUDE - lisa:verification-specialist - Independent (non-implementer) empirical proof via the issue's reproduction, writes the v2 verdict.
INCLUDE - lisa:learner - Captures task MLD into the learnings ledger.
INCLUDE - general-purpose - Lead-session bookkeeping (plan name, base branch, completion condition, tool-access preflight) per the skill; no specialist owns these.
EXCLUDE - claude - Catch-all; general-purpose already covers lead bookkeeping.
EXCLUDE - claude-code-guide - No Claude Code / API questions in scope.
EXCLUDE - Plan - Fix is a two-line exit-path change already specified in the ticket; no design trade-offs.
EXCLUDE - statusline-setup - Unrelated.
EXCLUDE - lisa:architecture-specialist - No architectural change; single CLI entry point.
EXCLUDE - lisa:builder - Fix flow uses bug-fixer.
EXCLUDE - lisa:debug-specialist - Root cause is stated and proven deterministic in the ticket (exit before async pipe drain); bug-fixer's reproduction confirms it.
EXCLUDE - lisa:test-specialist - One regression test; bug-fixer owns it under TDD.
EXCLUDE - lisa:quality-specialist - Review covered by lisa-git-submit-pr local review + CodeRabbit on a ~5-line diff.
EXCLUDE - lisa:security-specialist - No auth, input, or secret handling changes.
EXCLUDE - lisa:performance-specialist - Output flushing only; no perf surface.
EXCLUDE - lisa:product-specialist - No user-facing UX surface (CLI JSON for machines).
EXCLUDE - lisa:spec-conformance-specialist - Two Gherkin scenarios, checked directly by verification-specialist.
EXCLUDE - lisa:git-history-analyzer - History is a single PR (#4688), cited in the ticket.
EXCLUDE - lisa:eval-specialist, lisa:learning-judge, lisa:learnings-synthesizer, lisa:skill-evaluator, lisa:pr-mining-specialist, lisa:tracker-mining-specialist - Debrief/learning-routing/eval roles, not Implement.
EXCLUDE - lisa:github-agent, lisa:jira-agent, lisa:linear-agent - Tracker lifecycle handled by lead via skills (github-agent used once as input-resolver).
EXCLUDE - lisa:*-build-intake, lisa:*-prd-intake - Intake roles, not Implement.
EXCLUDE - code-simplifier:code-simplifier - Diff too small to benefit.
EXCLUDE - hookify:conversation-analyzer - Unrelated.

## Lead bookkeeping
- Completion condition: `TMPDIR=<root with 10,000 stale private lisa- dirs> node all/copy-overwrite/scripts/lib/lisa-cleanup-sweep.mjs --json --dry-run --no-processes | cat > piped.json` yields a file byte-identical in size to the direct-redirect run, `JSON.parse` succeeds, and it lists all 10,000 entries; without `--json` the CLI still prints one summary line and exits 0.
- Tool-access preflight: git, gh (authenticated, claim succeeded), node, bun — all local; no external systems needed. Pass.
- Regression harness: no browser/device surface (CLI); highest practical observation = unit test spawning the CLI into a pipe.

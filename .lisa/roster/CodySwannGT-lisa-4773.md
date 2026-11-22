# Roster Decision — CodySwannGT/lisa#4773 (Fix: Terminal Transition sweep read-error)

Plan: 4773-terminal-transition-read-error. Flow: Implement / Fix. Base: main (production, per deploy.branches; ticket Branch Plan matches).

INCLUDE - lisa:debug-specialist - Root cause is explicitly unknown; needs proof by execution of which GitHub read fails in CI.
INCLUDE - lisa:bug-fixer - Reproduce as failing test, then TDD fix and error-naming change.
INCLUDE - lisa:verification-specialist - Independent verdict; post-merge confirm #4730 closes via the workflow.
INCLUDE - lisa:quality-specialist - Review of the fix diff.
INCLUDE - lisa:learner - Capture task MLD to the ledger.
INCLUDE - Explore - Mandatory read-only research (folded into the debug-specialist brief to avoid duplicate reads).
INCLUDE - general-purpose - Lead-session bookkeeping the skill assigns to it (plan name, base branch, completion condition).
INCLUDE - lisa:github-agent - Bounded input-resolver (already ran).
EXCLUDE - lisa:builder - Fix flow, not a feature build.
EXCLUDE - lisa:test-specialist - bug-fixer owns the regression tests; scope is one reader module.
EXCLUDE - lisa:architecture-specialist - No design change.
EXCLUDE - lisa:security-specialist - Only secret concern is "do not leak token in error"; covered by quality review.
EXCLUDE - lisa:performance-specialist - No performance surface.
EXCLUDE - lisa:product-specialist - No UI; operator-facing message reviewed by quality-specialist.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the two Gherkin scenarios directly.
EXCLUDE - lisa:git-history-analyzer - Relevant history (608cbc6670, 48f24c7b27) already named in the ticket.
EXCLUDE - lisa:jira-agent, lisa:linear-agent, all *-build-intake and *-prd-intake agents - Tracker is GitHub; no intake cycle.
EXCLUDE - lisa:learning-judge, lisa:learnings-synthesizer, lisa:skill-evaluator, lisa:eval-specialist, lisa:tracker-mining-specialist, lisa:pr-mining-specialist - Debrief/gardener roles, not this flow.
EXCLUDE - Plan - Lead plans inline; scope is small.
EXCLUDE - code-simplifier:code-simplifier, claude-code-guide, hookify:conversation-analyzer, statusline-setup, web-fetch, claude - Not relevant.

Completion condition: after merge, the Terminal Transition On Merge workflow (merge push or workflow_dispatch) reports #4730 completed; `gh issue view 4730 --json state,labels` shows CLOSED with the production done label (status:done). Constraint: no change to what counts as an accepted completion proof.

Tool access: gh (repo, actions logs, release assets) — probed OK via `gh run view 43194847415 --log`.

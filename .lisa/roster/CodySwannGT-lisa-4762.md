# Roster Decision — CodySwannGT/lisa#4762

Plan: `lisa-implement-step10-foreground-deploy-wait`
Flow: Implement / Improve (skill-contract text change plus regression test; no runtime service behavior).

INCLUDE - lisa:github-agent - Served as the bounded input-resolver (lisa-track read, claim, bind).
INCLUDE - Explore - Mandatory read-only research: locate step 10 in every agent's generated copy, the drive-pr-to-merge CI-watcher wording, and existing skill-contract tests.
INCLUDE - lisa:builder - Implements the step-10 text change across the source skill and generated parity artifacts, plus the regression test, via TDD.
INCLUDE - lisa:quality-specialist - Independent review of the diff for correctness, parity, and test meaningfulness.
INCLUDE - lisa:verification-specialist - Independent empirical verification and the v2 verdict; must not be the implementer.
INCLUDE - lisa:learner - Captures task MLD into the learnings ledger per the flow.
INCLUDE - general-purpose - Lead-session helper for plan naming, branch/flow determination, completion condition, and tool preflight; no narrower specialist owns those lead chores.
EXCLUDE - claude - Catch-all duplicate of general-purpose; not needed.
EXCLUDE - claude-code-guide - The change is to Lisa's own skill text, not a question about Claude Code features.
EXCLUDE - code-simplifier:code-simplifier - A small wording change leaves nothing to simplify; quality-specialist covers clarity.
EXCLUDE - hookify:conversation-analyzer - No transcript analysis needed.
EXCLUDE - lisa:architecture-specialist - No design decision; the issue prescribes the change and its location.
EXCLUDE - lisa:bug-fixer - Not a code defect; it is a missing contract clause handled as Improve by the builder.
EXCLUDE - lisa:confluence-prd-intake - Not PRD intake.
EXCLUDE - lisa:debug-specialist - The cause is stated and verified by reading the issue; nothing to diagnose.
EXCLUDE - lisa:eval-specialist - Not measuring factory capability.
EXCLUDE - lisa:git-history-analyzer - Explore covers the history needed (the drive-pr-to-merge CI rule's origin).
EXCLUDE - lisa:github-build-intake - Not an intake cycle.
EXCLUDE - lisa:github-prd-intake - Not PRD intake.
EXCLUDE - lisa:jira-agent - The tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - The tracker is GitHub.
EXCLUDE - lisa:learnings-synthesizer - Debrief-only.
EXCLUDE - lisa:learning-judge - Invoked inside persist-learning only if a candidate arises; not a standing roster member.
EXCLUDE - lisa:linear-agent - The tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - The tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - The tracker is GitHub.
EXCLUDE - lisa:notion-prd-intake - Not PRD intake.
EXCLUDE - lisa:performance-specialist - No runtime performance surface.
EXCLUDE - lisa:pr-mining-specialist - Debrief-only.
EXCLUDE - lisa:product-specialist - No user-facing UI; the operator-visible effect (no idle lead) is covered by spec conformance in verification.
EXCLUDE - lisa:security-specialist - No auth, secrets, or input-handling surface changes.
EXCLUDE - lisa:skill-evaluator - Advisory routing of learnings; not needed for an issue-prescribed change.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist covers the issue's two acceptance points; scope is tiny.
EXCLUDE - lisa:test-specialist - The builder writes one contract assertion; quality-specialist reviews its meaningfulness.
EXCLUDE - lisa:tracker-mining-specialist - Debrief-only.
EXCLUDE - Plan - The issue prescribes the change; no separate architecture plan needed.
EXCLUDE - statusline-setup - Unrelated.
EXCLUDE - web-fetch - No external pages needed.

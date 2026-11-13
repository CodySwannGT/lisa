# Roster Decision — CodySwannGT/lisa#4761

Work type: Implement / Build (skill + rule contract change with a regression fixture). Runtime: Claude Code.

INCLUDE - Explore - mandatory read-only research: locate step 4 of lisa-task-decomposition, the DoR relationship gate, stale-state-claims, generated parity copies, and existing tests that pin these texts.
INCLUDE - lisa:builder - implements the contract change in source skill/rule text plus regenerated per-agent artifacts via TDD.
INCLUDE - lisa:quality-specialist - independent review of the diff for correctness, parity, and test meaningfulness.
INCLUDE - lisa:spec-conformance-specialist - confirms every "What to change" item and the regression check in the issue body landed.
INCLUDE - lisa:verification-specialist - independent verdict writer; runs the regression fixture and gates, records verification-status.json.
INCLUDE - lisa:learner - captures task MLD into the ledger after completion.
EXCLUDE - lisa:test-specialist - the regression check is a single fixture-driven test the builder writes TDD-first; quality-specialist reviews test meaningfulness.
EXCLUDE - lisa:git-history-analyzer - Explore covers the needed git log context for two files.
EXCLUDE - lisa:architecture-specialist - no architectural change; edits are confined to two contract texts and their tests.
EXCLUDE - lisa:product-specialist - no user-visible UI/flow; operator-facing behavior is covered by spec-conformance.
EXCLUDE - lisa:security-specialist - no auth, secrets, input handling, or network surface touched.
EXCLUDE - lisa:performance-specialist - text/contract change, no runtime hot path.
EXCLUDE - lisa:bug-fixer - not a defect reproduction flow; it is a build to add a missing check.
EXCLUDE - lisa:debug-specialist - nothing to root-cause; the failure mode is stated in the issue.
EXCLUDE - lisa:eval-specialist - factory capability measurement is out of scope.
EXCLUDE - lisa:github-agent - used only as the bounded input-resolver; lifecycle is run by this lead.
EXCLUDE - lisa:github-build-intake - intake dispatcher, not needed for a single claimed item.
EXCLUDE - lisa:github-prd-intake - PRD intake, not applicable.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - not applicable.
EXCLUDE - lisa:notion-prd-intake - not applicable.
EXCLUDE - lisa:confluence-prd-intake - not applicable.
EXCLUDE - lisa:learning-judge - no new candidate learning is being judged in this flow; learner captures MLD.
EXCLUDE - lisa:learnings-synthesizer - debrief-only agent.
EXCLUDE - lisa:pr-mining-specialist - debrief-only agent.
EXCLUDE - lisa:tracker-mining-specialist - debrief-only agent.
EXCLUDE - lisa:skill-evaluator - routing of learnings; the destination (skill + DoR rule) is already decided by the issue.
EXCLUDE - code-simplifier:code-simplifier - prose change; quality-specialist covers clarity.
EXCLUDE - general-purpose - more specific specialists fit every task.
EXCLUDE - claude - catch-all; specific specialists fit.
EXCLUDE - Plan - builder plans its own TDD sequence for a small change.
EXCLUDE - claude-code-guide - no Claude Code product questions.
EXCLUDE - hookify:conversation-analyzer - not analysing transcripts.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - no external pages needed.

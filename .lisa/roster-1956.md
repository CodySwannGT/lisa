# Roster Decision — plan: work-item-sync-lanes (CodySwannGT/lisa#1956)

Runtime: Claude Code, implicit-team model. Work type: Fix (bug) — Reproduce sub-flow mandatory.

INCLUDE - Explore - flow-required read-only research (validator internals, hook state machine, existing test harnesses for lisa-work-item.mjs).
INCLUDE - lisa:bug-fixer - owns Reproduce-first TDD: failing tests for all three wedge lanes, then the fixes.
INCLUDE - lisa:security-specialist - two changes weaken-or-refine gates (work-item validation range exclusion; safety-net rebase --abort allowance) — must prove no laundering lane opens (e.g. foreign-commit exclusion cannot exempt branch-authored commits; --abort allowance cannot discard real conflict resolutions).
INCLUDE - lisa:quality-specialist - validator JS + hook shell conventions, test quality, skill-text accuracy.
INCLUDE - lisa:verification-specialist - independent verdict incl. live end-to-end rebase + merge-sync + push in a scratch bound repo.
INCLUDE - lisa:spec-conformance-specialist - maps shipped work to the 5 suggested fixes + derived AC.
INCLUDE - lisa:learner - flow-required learnings pass.
INCLUDE - general-purpose - bounded one-shot chores only (input resolution already done).
EXCLUDE - lisa:builder - bug-fixer owns Fix-type implementation; no separate feature build.
EXCLUDE - lisa:test-specialist - repro-test design is intrinsic to bug-fixer's Reproduce mandate here (validator has existing unit-test conventions to follow); a separate matrix designer added value for the 138-fixture guard wall, not for three targeted repro lanes.
EXCLUDE - lisa:debug-specialist - root causes already diagnosed with line-level evidence (assertStateBranch unconditional gate; parsePushLines range; safety-net abort guard).
EXCLUDE - lisa:architecture-specialist - fixes are localized to one script + one hook + one skill text; no cross-cutting design needed (issue enumerates the design).
EXCLUDE - lisa:performance-specialist / lisa:product-specialist / lisa:git-history-analyzer - not relevant to this defect class.
EXCLUDE - lisa:pr-mining-specialist / lisa:tracker-mining-specialist / lisa:learnings-synthesizer - Debrief-flow agents.
EXCLUDE - lisa:github-agent / jira-agent / linear-agent / all *-intake - lifecycle wrappers and queue scanners; this session orchestrates.
EXCLUDE - lisa:skill-evaluator - reached via learner.
EXCLUDE - code-simplifier / coderabbit:code-reviewer / claude-code-guide / Plan / claude / statusline-setup - as in roster-1960 (PR-side review covers CodeRabbit; no API questions; lead owns planning).
EXCLUDE - chief/casey/felix/lex/mark/parker/sally - acmeorgd business-domain agents, irrelevant.

All spawns model=opus.

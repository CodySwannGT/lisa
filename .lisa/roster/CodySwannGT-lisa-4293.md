# Roster Decision — CodySwannGT/lisa#4293

Nested flow: this Implement run was handed to a spawned subagent by the session
lead, so it is inside an existing team. Claude teams are flat and a teammate
cannot add named teammates; specialist work below is either done in this agent
or delegated to anonymous one-shot subagents whose results return here.

- INCLUDE - Explore - read-only discovery of release.yml, its tests, and docs (performed inline, bounded).
- INCLUDE - lisa:builder - TDD implementation of the new release.yml inputs (performed by this agent).
- INCLUDE - lisa:test-specialist - test design for the release-name resolver step (performed by this agent).
- INCLUDE - lisa:verification-specialist - read-only live Sentry confirmation of the naming contract.
- INCLUDE - lisa:quality-specialist - local review via lisa-git-submit-pr's review pass.
- INCLUDE - coderabbit:code-reviewer - PR review runs as the CodeRabbit check on the PR.
- INCLUDE - lisa:learner - learnings recorded in the final report for the lead's learner.
- EXCLUDE - lisa:bug-fixer - the defect is a missing capability, delivered as a builder change; reproduction is the live Sentry read.
- EXCLUDE - lisa:debug-specialist - root cause is already established (bare-version release name).
- EXCLUDE - lisa:architecture-specialist - single-job change with no cross-module design.
- EXCLUDE - lisa:security-specialist - no new credential path; caller command runs without Sentry secrets in its env.
- EXCLUDE - lisa:performance-specialist - no runtime performance surface.
- EXCLUDE - lisa:product-specialist - no UI; contract documented for operators.
- EXCLUDE - lisa:spec-conformance-specialist - acceptance is three bullets checked in the verdict.
- EXCLUDE - lisa:git-history-analyzer - history of the Sentry job already read directly.
- EXCLUDE - tracker/intake/debrief agents (jira/github/linear/notion/confluence/*-intake, tracker-mining, pr-mining, learnings-synthesizer, learning-judge, skill-evaluator, eval-specialist) - not part of a single-item build.
- EXCLUDE - general-purpose, Plan, claude, claude-code-guide, code-simplifier, hookify, statusline-setup - more specific coverage above or unrelated.

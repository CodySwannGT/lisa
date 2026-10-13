# Roster Decision: CodySwannGT/lisa#4448

Plan: `session-manager`. Flow: Implement / Build. Runtime: Claude Code (agent types from the `Agent` tool).

INCLUDE - Explore - Mandatory read-only research: maps plugins/src/base skill layout, build:plugins, the tracker dispatch pattern, automation-runbook contract and doctor checks.
INCLUDE - lisa:architecture-specialist - Designs the skill/script/config split, the vendor-neutral queue-ordering extension and the automation registration points before any code is written.
INCLUDE - lisa:git-history-analyzer - Explains how comparable skills (lisa-intake, lisa-repair-intake, lisa-tracker-claim, the runbook contract #1737/#1796/#1799) evolved, so the new skill follows established conventions.
INCLUDE - lisa:builder - Implements the skills, scripts, config schema and tests against the Gherkin acceptance criteria via TDD.
INCLUDE - lisa:test-specialist - Designs the test matrix for the shell helpers (capacity, spawn guards, env scrubbing) and the config/packaging checks.
INCLUDE - lisa:quality-specialist - Reviews correctness and Lisa coding conventions on the diff.
INCLUDE - lisa:security-specialist - The feature runs yolo-mode sessions driven by tracker text and Telegram; threat modelling of prompt injection, token storage and allowlisting is required.
INCLUDE - lisa:spec-conformance-specialist - Checks the shipped diff against the issue's acceptance criteria and Out of Scope, flagging misses and scope creep.
INCLUDE - lisa:verification-specialist - Independently runs the real system (built plugin, scripts against live `claude agents --json`, a dry dispatch) and writes the v2 verdict.
INCLUDE - lisa:learner - Captures task MLD learnings into the ledger, as the flow requires.
INCLUDE - general-purpose - Team-lead helper for plan naming, branch establishment and tool-access preflight, which the skill assigns to general-purpose explicitly.
EXCLUDE - claude - Catch-all duplicate of general-purpose; the more specific specialists above cover every task.
EXCLUDE - claude-code-guide - Claude Code platform facts were already verified against live docs and plugin source and are recorded in the issue; re-consulted only if a new platform question arises.
EXCLUDE - Plan - architecture-specialist covers implementation planning with Lisa-specific knowledge.
EXCLUDE - lisa:product-specialist - No end-user UI surface; the operator-facing behaviour is fully specified in the Gherkin ACs, which spec-conformance checks.
EXCLUDE - lisa:performance-specialist - No hot path; the capacity calculation is a few shell calls per cycle.
EXCLUDE - lisa:bug-fixer - Build flow, not a Fix flow.
EXCLUDE - lisa:debug-specialist - No defect to root-cause; added if verification turns up an unexplained failure.
EXCLUDE - lisa:eval-specialist - Measures the factory's own task suite, which is unrelated to this feature build.
EXCLUDE - lisa:github-agent - The lead already runs the GitHub lifecycle for this item; a second lifecycle agent would duplicate tracker writes.
EXCLUDE - lisa:jira-agent - The tracker is GitHub.
EXCLUDE - lisa:linear-agent - The tracker is GitHub.
EXCLUDE - lisa:github-build-intake - A queue scanner; this flow works a single, already-claimed item.
EXCLUDE - lisa:jira-build-intake - A queue scanner; the tracker is not Jira.
EXCLUDE - lisa:linear-build-intake - A queue scanner; the tracker is not Linear.
EXCLUDE - lisa:confluence-prd-intake - PRD intake; not applicable.
EXCLUDE - lisa:github-prd-intake - PRD intake; not applicable.
EXCLUDE - lisa:linear-prd-intake - PRD intake; not applicable.
EXCLUDE - lisa:notion-prd-intake - PRD intake; not applicable.
EXCLUDE - lisa:learning-judge - Invoked by the learner/gardener path, not as a flow teammate.
EXCLUDE - lisa:learnings-synthesizer - Debrief-only.
EXCLUDE - lisa:pr-mining-specialist - Debrief-only.
EXCLUDE - lisa:tracker-mining-specialist - Debrief-only.
EXCLUDE - lisa:skill-evaluator - Routes candidate learnings; not part of a build.
EXCLUDE - lisa-expo:ops-specialist - Expo/serverless operations; Lisa ships as a plugin release, not an Expo/serverless deploy.
EXCLUDE - statusline-setup - Unrelated to this work.

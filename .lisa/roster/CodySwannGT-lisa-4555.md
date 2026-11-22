# Roster Decision — CodySwannGT/lisa#4555

Plan: session-manager-optional-telegram
Work type: Improve (Story) — session-manager CLI, skills, doctor check, tests.

INCLUDE - Explore - mandatory read-only search across session-manager.mjs, skills, doctor and parity surfaces.
INCLUDE - lisa:architecture-specialist - designs the CLI/config shape (notify.provider none, secrets-provider token, human-needed marking) and maps files to change.
INCLUDE - lisa:builder - implements the CLI, skill and doctor changes via TDD against the acceptance criteria.
INCLUDE - lisa:test-specialist - designs the CLI unit-test matrix (no-channel cycle, token resolve/fail, migration, cycle-continues-while-human-needed) with fakes only.
INCLUDE - lisa:security-specialist - the change moves a bot token into the secrets provider and into a tmux env; leakage paths need review.
INCLUDE - lisa:quality-specialist - parallel post-implementation code review.
INCLUDE - coderabbit:code-reviewer - parallel post-implementation review; substitute review required if CodeRabbit is rate-limited.
INCLUDE - lisa:spec-conformance-specialist - seven acceptance criteria; verifies every one landed and no scope creep.
INCLUDE - lisa:verification-specialist - independent empirical proof by running the CLI (start/doctor/status/cycle) against fakes; writes the v2 verdict.
INCLUDE - lisa:learner - captures task MLD to the ledger.
EXCLUDE - general-purpose - only used for the bounded input-resolver; specific specialists cover the rest.
EXCLUDE - lisa:bug-fixer - this is an Improve/Build, not a defect reproduction.
EXCLUDE - lisa:debug-specialist - no defect to root-cause; include later only if a gate fails mysteriously.
EXCLUDE - lisa:product-specialist - CLI/runbook surface with no UI; spec-conformance covers acceptance mapping.
EXCLUDE - lisa:performance-specialist - no performance-sensitive path changes.
EXCLUDE - lisa:git-history-analyzer - Explore covers the history needed for session-manager.
EXCLUDE - code-simplifier:code-simplifier - quality-specialist covers simplification in review.
EXCLUDE - lisa:eval-specialist - measures the factory, not this change.
EXCLUDE - lisa:github-agent / lisa:jira-agent / lisa:linear-agent - lifecycle is being run by this lead flow directly.
EXCLUDE - lisa:github-build-intake / lisa:jira-build-intake / lisa:linear-build-intake - batch intake, not single-item work.
EXCLUDE - lisa:github-prd-intake / lisa:confluence-prd-intake / lisa:linear-prd-intake / lisa:notion-prd-intake - PRD intake not in scope.
EXCLUDE - lisa:learning-judge / lisa:skill-evaluator / lisa:learnings-synthesizer - gardener/debrief roles, not implement.
EXCLUDE - lisa:pr-mining-specialist / lisa:tracker-mining-specialist - debrief roles.
EXCLUDE - lisa-expo:ops-specialist - Expo/serverless ops; Lisa has no deploy target beyond npm release.
EXCLUDE - hookify:conversation-analyzer - not a hook-authoring task.
EXCLUDE - claude-code-guide / statusline-setup / Plan / claude - specialists above cover planning and work.

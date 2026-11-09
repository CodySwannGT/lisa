# Roster Decision — CodySwannGT/lisa#4645

Plan: prune-retired-plugin-keys-and-dead-registrations
Work type: Implement / Fix (bug). Base branch: `main` (Target Backend Environment: production via `deploy.branches`; Branch Plan matches).

```text
INCLUDE - Explore - mandatory read-only research of the plugin install, migration, and bootstrap code paths.
INCLUDE - lisa:bug-fixer - reproduces each defect as a failing test, then fixes via TDD (the core of this Fix).
INCLUDE - lisa:verification-specialist - independent empirical proof (scratch host `lisa apply` run) and the v2 verdict; not the implementer.
INCLUDE - lisa:quality-specialist - review of the diff for correctness and coding-philosophy compliance.
INCLUDE - lisa:learner - captures task MLD into the ledger, as the skill requires.
EXCLUDE - claude - catch-all; more specific specialists cover every task.
EXCLUDE - claude-code-guide - no Claude Code product question; the plugin CLI behaviour is checked empirically in the repo.
EXCLUDE - code-simplifier:code-simplifier - quality-specialist review covers simplification for a small diff.
EXCLUDE - general-purpose - every task maps to a specific specialist; lead does branch/plan bookkeeping itself.
EXCLUDE - hookify:conversation-analyzer - not analysing transcripts.
EXCLUDE - lisa:architecture-specialist - the issue's Technical Approach already names files and design; Explore covers mapping.
EXCLUDE - lisa:builder - this is a Fix, owned by bug-fixer.
EXCLUDE - lisa:confluence-prd-intake - no PRD intake.
EXCLUDE - lisa:debug-specialist - root cause is already proven in the issue with line citations; bug-fixer reproduces it.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - the needed history (retired-key commits) is cited in the issue and read directly by bug-fixer via git show.
EXCLUDE - lisa:github-agent - lifecycle is run by this lead skill.
EXCLUDE - lisa:github-build-intake - not an intake cycle.
EXCLUDE - lisa:github-prd-intake - no PRD intake.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - invoked only through persist-learning if a candidate arises.
EXCLUDE - lisa:learnings-synthesizer - Debrief-only.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - no PRD intake.
EXCLUDE - lisa:notion-prd-intake - no PRD intake.
EXCLUDE - lisa:performance-specialist - no performance-sensitive path (one CLI list call per apply).
EXCLUDE - lisa:pr-mining-specialist - Debrief-only.
EXCLUDE - lisa:product-specialist - no UI/user-flow surface; acceptance criteria are already Gherkin.
EXCLUDE - lisa:security-specialist - uninstall is scoped to Lisa's own dead-path registrations; quality review covers the scoping check.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the three Gherkin scenarios directly for this small leaf.
EXCLUDE - lisa:test-specialist - bug-fixer writes the red tests under TDD; quality-specialist reviews them.
EXCLUDE - lisa:tracker-mining-specialist - Debrief-only.
EXCLUDE - Plan - Explore + issue Technical Approach suffice.
EXCLUDE - statusline-setup - unrelated.
```

## Tool access preflight
- GitHub (`gh`): needed for PR, tracker sync, evidence. Probe: `gh issue view 4645 --repo CodySwannGT/lisa` — pass (resolver read it).
- `claude` CLI: tests use a stubbed CLI per the issue; no live access required.
- No other external system required. (Maestro is reported missing by the readiness preflight but this item has no mobile surface.)

## Completion condition
In a scratch host seeded with `typescript@lisa` + `lisa-typescript@lisa` enabled and a stub `claude` CLI reporting a dead-path `@lisa` registration, a live-path `@lisa` registration, and another vendor's dead-path registration, running the built `lisa apply` prints the removal of `typescript@lisa` and an uninstall of only the dead-path `@lisa` registration; a second apply prints neither. Constraints: other vendors' and live-path registrations untouched; host-added non-retired keys untouched.

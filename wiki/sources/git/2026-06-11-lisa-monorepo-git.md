---
type: source
created: 2026-06-11
updated: 2026-06-11
related: []
sources: []
source_system: git
project: lisa-monorepo
---

# git history - lisa-monorepo (2026-06-11)

- Repo: `/Users/codysai/.codex/worktrees/058c/lisa`
- HEAD: `f09469adb26fe433abedd62ede613b395e25ec4f`
- Total commits on HEAD: 3083
- New commits since last ingest (`6f6c00cb0462cf2f6e6754e80905771bb6712814`): 12
- Merged PRs since last cursor: `#1234`, `#1236`, `#1238`, `#1241`; latest #1241 "fix: preserve host config during postinstall apply"

## New commits

- 227aa7f0 · 2026-06-10 · docs(wiki): ingest Lisa wiki state
- ef97009d · 2026-06-10 · Merge pull request #1234 from CodySwannGT/wiki/ingest-20260610T000000Z
- 0b6a260d · 2026-06-10 · chore(release): 2.159.4 [skip ci]
- 8acc0c9a · 2026-06-10 · fix: require auditable implement rosters
- 7c6e818a · 2026-06-10 · Merge pull request #1236 from CodySwannGT/codex/1235-roster-decision-gate
- 8621336a · 2026-06-10 · chore(release): 2.159.5 [skip ci]
- 0be769ab · 2026-06-10 · fix(skills): require e2e regression execution proof
- e9776de7 · 2026-06-10 · Merge pull request #1238 from CodySwannGT/codex/1237-e2e-regression-gate
- 7ebf4dd · 2026-06-10 · chore(release): 2.159.6 [skip ci]
- 2429738b · 2026-06-10 · fix: preserve host config during postinstall apply
- 5564545b · 2026-06-10 · Merge pull request #1241 from CodySwannGT/codex/1239-postinstall-preserve-host-config
- f09469ad · 2026-06-11 · chore(release): 2.159.7 [skip ci]

## Merged PRs captured

- #1241 · 2026-06-11T01:11:19Z · `codex/1239-postinstall-preserve-host-config` · fix: preserve host config during postinstall apply
- #1238 · 2026-06-10T12:12:53Z · `codex/1237-e2e-regression-gate` · fix(skills): require e2e regression execution proof
- #1236 · 2026-06-10T11:06:22Z · `codex/1235-roster-decision-gate` · fix: require auditable implement rosters
- #1234 · 2026-06-10T06:56:44Z · `wiki/ingest-20260610T000000Z` · docs(wiki): ingest Lisa wiki state

## Changed surface

- Implement workflow skills now require an auditable roster decision before implementation, including explicit agent-role coverage or documented single-agent rationale.
- TDD implementation and verification lifecycle skills now require executed end-to-end regression proof when a task touches user-facing workflows, while documenting scoped exceptions.
- Package merge, JSON merge, and copy-overwrite strategies now preserve host-owned Lisa config fields during postinstall apply.
- Release automation advanced Lisa through `2.159.7`.

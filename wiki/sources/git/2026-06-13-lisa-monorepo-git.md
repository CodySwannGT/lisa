---
type: source
created: 2026-06-13
updated: 2026-06-13
related: []
sources: []
source_system: git
project: lisa-monorepo
---

# git history - lisa-monorepo (2026-06-13)

- Repo: `.`
- HEAD: `05853e6ce16319386f642adcc8a55fefbb3a0ec2`
- Total commits on HEAD: 3160
- New commits since last ingest (`f4278cbd2b796440fc943970c2c79cfedce3ca14`): 14
- Merged PRs since last cursor: `#1281`, `#1282`, `#1283`, `#1284`; latest #1284 "fix(hooks): allow lint-ignored edit files"

## New commits

- 05853e6c - 2026-06-12 - chore(release): 2.165.4 [skip ci]
- 95293e62 - 2026-06-12 - Merge pull request #1284 from CodySwannGT/codex/issue-1263-lint-ignored-pass
- 8fdb3296 - 2026-06-12 - fix(hooks): allow lint-ignored edit files
- 8cf8e647 - 2026-06-12 - chore(release): 2.165.3 [skip ci]
- 04987e66 - 2026-06-12 - Merge pull request #1283 from CodySwannGT/fix/hook-script-exec-bits
- 47972fb0 - 2026-06-12 - fix(plugins): ship hook scripts with the executable bit set
- df54d8ce - 2026-06-12 - chore(release): 2.165.2 [skip ci]
- 94afcd90 - 2026-06-12 - Merge pull request #1281 from CodySwannGT/codex/issue-1264-commit-msg-errors
- 4338339b - 2026-06-12 - chore(release): 2.165.1 [skip ci]
- ca121ed6 - 2026-06-12 - Merge branch 'main' into codex/issue-1264-commit-msg-errors
- 12ebee86 - 2026-06-12 - Merge pull request #1282 from CodySwannGT/wiki/ingest-20260612T000000Z
- dadad5af - 2026-06-12 - docs(wiki): remove machine-specific worktree path from wiki snapshot
- 60a3d650 - 2026-06-12 - docs(wiki): ingest Lisa wiki state
- 30302581 - 2026-06-12 - fix: improve commit-msg hook diagnostics

## Merged PRs captured

- #1284 - 2026-06-12T18:07:15Z - `codex/issue-1263-lint-ignored-pass` - fix(hooks): allow lint-ignored edit files
- #1283 - 2026-06-12T17:57:59Z - `fix/hook-script-exec-bits` - fix(plugins): ship hook scripts with the executable bit set
- #1282 - 2026-06-12T07:06:46Z - `wiki/ingest-20260612T000000Z` - docs(wiki): ingest Lisa wiki state
- #1281 - 2026-06-12T07:09:15Z - `codex/issue-1264-commit-msg-errors` - fix: improve commit-msg hook diagnostics

## Changed surface

- Lisa advanced from `2.165.0` through `2.165.4`.
- The prior wiki ingestion PR merged, and a follow-up documentation commit removed a machine-specific worktree path from the monorepo snapshot.
- Commit-message hook diagnostics were improved after the `#1264` repair lane.
- Plugin hook scripts now ship with executable bits preserved.
- Edit-time lint handling now allows lint-ignored files to pass without treating the ignore state as a failed edit.

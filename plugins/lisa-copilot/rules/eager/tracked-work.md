# Tracked Work

Before the first durable project mutation (code, tests, config, docs, committed research/plans/findings, commits, or PRs), establish exactly one live tracker leaf through `lisa-track`. Read-only discussion and orientation are exempt only while they produce no durable artifact.

The mandatory order is: live-validate an explicit ref, or conservatively search and create exactly one valid leaf through `lisa-tracker-write` when no unique match exists; idempotently claim it through `lisa-tracker-claim`; then persist and verify the worktree-local binding with `node scripts/lisa-work-item.mjs bind <ref>`. Any tracker, claim, or binding failure blocks durable work.

Carry that canonical ref through the branch, every ordinary commit's `Work-Item:` trailer, the PR, usage/evidence, and `lisa-tracker-sync`. Hooks and CI never create tickets. Keep the binding through interruptions or blocked outcomes; run `node scripts/lisa-work-item.mjs clear` only after merge/deploy/verification, two-way linkage/evidence, and the tracker item have all reached true terminal completion.

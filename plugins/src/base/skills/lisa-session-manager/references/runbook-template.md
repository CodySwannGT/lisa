# Runbook: session-manager

Seeded by `/lisa:setup:session-manager` from the `lisa-session-manager` skill. This file belongs to
the project: edit the prose to match how you run it. The loop follows the
`automation-runbook-contract` rule; it records one outcome per cycle under loop id
`session-manager`.

## Intent

Keeps Ready work moving on this machine: each Ready item gets its own fresh coding session, and the
operator answers that session's questions from their phone.

## Sources of truth

The configured tracker's lanes (the `ready`, `claimed` and `blocked` roles from `.lisa.config.json`),
read through the tracker access layer; the manager's ledger in `.lisa/session-manager/`; the live
session list from `claude agents`; and the project's own Telegram chat.

## Candidate selection

Leaf items in the `ready` role, ordered: assigned to an operator (`sessionManager.operatorIds`),
then to the manager's own tracker identity, then unassigned; within each, by priority, then oldest.
Items assigned to someone else, containers, human-held items and (when configured) items by
untrusted authors are skipped. As many as the machine has capacity for.

## Scope/bounds

Only the repos listed in `sessionManager.repos` (or this repo). It never writes code itself, never
changes the meaning of a lane, never reuses a worker for a new attempt, and never runs more workers
than `capacity` allows.

## Proof

A worker counts as started only when it is visible as a live session. A Blocked→Ready release counts
only after the item is read back in the `ready` role. An answer counts only once it was delivered to
the worker.

## Autonomous-vs-approval boundary

Alone: claim, start workers, retry a stalled item with a fresh session, release a blocked item whose
dependencies are all contained in its base branch. Requires the operator: any question a worker
asks, any item whose repo is unclear, and any item that failed `stall.maxAttempts` times.

## Escalation

A worker's question goes to Telegram. An item that keeps failing moves to the `blocked` role with a
comment that says what happened. When the manager itself cannot proceed it records
`recovery-required` with a one-line reason.

## Recovery

Restore whatever the last `recovery-required` summary names (tracker access, the Telegram token, the
claude CLI), then `/lisa:session-manager stop` and `/lisa:session-manager start`. Items moved to
`blocked` go back to `ready` once a human has dealt with the reason.

## Next-run state

Nothing in memory. The tracker lanes, the ledger in `.lisa/session-manager/` and the recorded cycles
in `.lisa/automations/runs/session-manager.jsonl` are the state. Losing the ledger resets attempt
counts.

## Retirement condition

Propose teardown when BOTH hold: no item entered the `claimed` role in the last 14 days, AND this
cycle found no Ready candidates. The manager files one proposal marked
`[lisa-session-manager-retirement]` and keeps running until someone tears it down or lengthens its
interval. `candidate-proposed` is never recorded by this loop: it files no build candidates.

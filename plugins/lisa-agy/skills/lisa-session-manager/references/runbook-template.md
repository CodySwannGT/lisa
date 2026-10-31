# Runbook: session-manager

Seeded by `/lisa:setup:session-manager` from the `lisa-session-manager` skill. This file belongs to
the project: edit the prose to match how you run it. The loop follows the
`automation-runbook-contract` rule; it records one outcome per cycle under loop id
`session-manager`.

## Intent

Keeps Ready work moving on this machine: each Ready item gets its own fresh coding session, and the
operator answers that session's questions, from their phone when the project has a Telegram bot.

## Sources of truth

The configured tracker's lanes (the `ready`, `claimed` and `blocked` roles from `.lisa.config.json`),
read through the tracker access layer; the manager's ledger in `.lisa/session-manager/`; the live
session list from `claude agents`; and, when `sessionManager.notify.provider` is `telegram`, the
project's own Telegram chat. Telegram is optional: with no channel, questions wait in the ledger.

## Candidate selection

Leaf items in the `ready` role, ordered: assigned to an operator (`sessionManager.operatorIds`),
then to the manager's own tracker identity, then unassigned; within each, by priority, then oldest.
Items assigned to someone else, containers, human-held items, items waiting on a human's answer
in the ledger and (when configured) items by untrusted authors are skipped. As many as the machine has capacity for.

When `sessionManager.backlogPickup` is on and capacity remains after every Ready item, a lowest tier
follows: backlog items (open leaves in no lifecycle role) in the same order, minus those with an
unfinished blocker and those that already failed validation and have not changed since. Each one
must pass the full tracker validation before it is assigned to the first operator, moved to Ready
and dispatched like any other item.

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

When an item needs a human (a worker's question, an unclear repo, an item that failed
`stall.maxAttempts` times, or a design or product decision), the manager marks it with the
configured human-needed marker, posts the question on the item with how to answer it, records it
pending in the ledger, and keeps dispatching other items: one item waiting on a person never stops
the queue. An item that failed `stall.maxAttempts` times also moves to the `blocked` role. With
Telegram the question goes there too; `/lisa:session-manager status` lists every pending question.
The operator answers on the item, on Telegram, or with the CLI `answer` command; the next cycle
delivers the answer, removes the marker and clears the question. No question is ever asked in the
manager's terminal. When the manager itself cannot proceed it records `recovery-required` with a one-line
reason. Having no notification channel is not such a reason; a configured Telegram that is broken
or unpaired is.

## Recovery

Restore whatever the last `recovery-required` summary names (tracker access, the Telegram token or
pairing when Telegram is configured: the token is in the project's secrets provider, or in the
state dir's `.env` with no provider; `store-token` stores or migrates it; the claude CLI), then `/lisa:session-manager stop` and `/lisa:session-manager start`. Items moved to
`blocked` go back to `ready` once a human has dealt with the reason.

## Next-run state

Nothing in memory. The tracker lanes, the ledger in `.lisa/session-manager/` and the recorded cycles
in `.lisa/automations/runs/session-manager.jsonl` are the state. Losing the ledger resets attempt
counts.

## Retirement condition

Propose teardown when BOTH hold: no item entered the `claimed` role in the last 14 days, AND this
cycle found no Ready candidates. The manager files one proposal marked
`[lisa-session-manager-retirement]` and keeps running until someone tears it down or lengthens its
interval. A cycle that marks an item human-needed records `candidate-proposed`, the outcome the
automation-runbook contract assigns to holding an item for a human with its questions.

# Waiting Is Not Blocked

Three failure modes share one root: a session that stops producing while still consuming the human's clock and attention. Each was observed directly.

## 1. Poll; do not wait for a message

An agent dispatches a subagent, a CI run, a deploy, or a long build — and then waits for a notification that never arrives, or arrives long after it mattered. Callbacks are best-effort. Notification channels drop. A background process can exit without anything telling you.

**While the session is active, go and check.** Roughly every five minutes, run the command that answers the question: `gh run list`, `gh pr checks`, a status query, a log tail, a file existence check. Polling is cheap; an idle session is not.

This is not an instruction to busy-wait. It is the opposite: between polls you should be doing other work (see rule 3). The poll is a periodic check, not an occupation.

Two corollaries:

- **An absent result is information.** If a subagent has produced nothing after several polls, investigate whether it is running at all rather than assuming it needs more time.
- **Never claim an outcome you have not observed.** "The tests are probably green by now" is a fabrication; go look. See `falsifiable-checks` and `claim-evidence-mapping`.

## 2. Blocked means you physically cannot proceed

The word is load-bearing and it gets diluted. **Blocked** means there is no action available to you: a credential you cannot obtain, an API that rejects you, a decision whose answer changes what you would build, a dependency that does not exist yet.

These are **not** blocked:

- Waiting for a review, a CI run, a deploy, or a build.
- Waiting for a human to confirm something you could reasonably proceed on and correct later.
- Waiting for a subagent you dispatched.
- Not yet having done the work.

Report those as **waiting**, and say what you are doing in the meantime. Reporting them as blocked misinforms the human twice: it suggests they must act when they need not, and it devalues the word for the times you genuinely cannot proceed.

## 3. Plan phases are parallel unless stated otherwise

A numbered plan is a decomposition, not a dependency graph. Unless a phase's input is another phase's output — or the user said the order matters — the phases run concurrently. An agent that serializes a plan because it is written as a list turns a parallel workload into a queue and multiplies the wall-clock cost by the number of steps.

Practically: when you would otherwise idle waiting on rule 1, start the next independent phase. When you dispatch subagents, dispatch every independent one in the same breath rather than one at a time.

Where a real dependency exists, name it — "phase 3 needs the schema from phase 2" — so the human can see why the order is what it is.

## Scope: sessions, not the tracker

This rule governs **session** stuckness. It does not touch the factory's tracker lifecycle vocabulary — the `blocked` role and the `human_needed` outcome used by `lisa-implement`, `lisa-repair-intake`, and the intake flows. That vocabulary is stricter and deliberately so: an item marked `human_needed` is one an adversarial gate decided a person must resolve, and nothing in this rule permits a session to re-classify it. If you are unsure which vocabulary you are in, ask whether you are describing your own next five minutes (this rule) or the state of a tracked work item (the factory contract).

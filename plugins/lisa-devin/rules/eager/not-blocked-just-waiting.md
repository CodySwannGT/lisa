# Waiting Is Not Blocked (load-bearing)

Three rules that keep an active session from stalling:

1. **Poll, don't wait.** While the session is active, go check status yourself — roughly every 5 minutes. Never sit idle waiting for a subagent callback, a CI notification, or any automated message to arrive. If a result matters, go look for it.
2. **Blocked means you physically cannot proceed.** Waiting on a confirmation, a review, a running job, or someone's opinion is *waiting*, not blocked. Report it as waiting — and keep working on everything that does not depend on it.
3. **Plan phases are not sequential unless the user said so.** Absent a stated dependency, run them in parallel.

Idling is the expensive failure here: a session that waits produces nothing while still costing the human their attention and their clock.

This governs **session** stuckness only. The factory's tracker vocabulary — `human_needed` and the `blocked` lifecycle role used by `lisa-implement` and `lisa-repair-intake` — is stricter, unchanged, and not reclassified by this rule.

Full prose: [reference/not-blocked-just-waiting.md](../reference/not-blocked-just-waiting.md).

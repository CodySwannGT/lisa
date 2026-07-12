---
description: "Inspect the current project's PRD and build queues, summarize lifecycle counts, and surface actionable queue-health signals without mutating work."
---

Use the /lisa-queue-status skill to inspect the current project's configured PRD source and build tracker, report queue-health verdicts, and highlight actionable backlog or stuck-state signals. $ARGUMENTS

Common operator usage:

- `/lisa:queue-status`
- `/lisa:queue-status queue=prd`
- `/lisa:queue-status queue=build`

Use this when you need to answer:

- Is the queue actually idle, or is Lisa misconfigured?
- Which queue item is the most actionable next?
- Should the next command be `/lisa:intake`, `/lisa:repair-intake`, `/lisa:automation-status`, or `/lisa:verify-prd`?

This surface is read-only in v1. Use it to understand whether the repo's PRD and build queues are idle, healthy, attention-needed, or misconfigured before deciding whether to run `/lisa:intake`, `/lisa:repair-intake`, `/lisa:automation-status`, `/lisa:verify-prd`, or deeper tracker-native investigation.

Quick interpretation guide:

- `IDLE`: the queue resolved correctly and nothing actionable is waiting. No immediate Lisa action is required.
- `HEALTHY`: the queue resolved correctly and normal work is present. Follow the highlighted next step, usually `/lisa:intake`.
- `ATTENTION_NEEDED`: blocked, stalled, or aging work needs operator follow-up. Use the highlighted item and remediation hint to choose the next command, usually `/lisa:repair-intake`.
- `MISCONFIGURED`: queue resolution or lifecycle adoption is broken. Fix config, labels/statuses, or scheduler drift before trusting queue state.

Highlighted-item semantics:

- A highlighted item is the single oldest or most actionable queue item for that section, not a full dump of all matching work.
- `ready` highlights usually point to `/lisa:intake`.
- `blocked`, stalled, or long-claimed highlights usually point to `/lisa:repair-intake`.
- Shipped PRD highlights usually point to `/lisa:verify-prd`.
- If queue behavior looks wrong for both PRD and build lanes, inspect `/lisa:automation-status` before assuming the queue itself is the problem.

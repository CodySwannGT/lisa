---
description: "Inspect the current project's PRD and build queues, summarize lifecycle counts, and surface actionable queue-health signals without mutating work."
---

Use the /lisa:queue-status skill to inspect the current project's configured PRD source and build tracker, report queue-health verdicts, and highlight actionable backlog or stuck-state signals. $ARGUMENTS

Common operator usage:

- `/lisa:queue-status`
- `/lisa:queue-status queue=prd`
- `/lisa:queue-status queue=build`

This surface is read-only in v1. Use it to understand whether the repo's PRD and build queues are idle, healthy, attention-needed, or misconfigured before deciding whether to run `/lisa:intake`, `/lisa:repair-intake`, or deeper tracker-native investigation.

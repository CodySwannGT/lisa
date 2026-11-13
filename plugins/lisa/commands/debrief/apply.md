---
description: "Apply the dispositions (accept, reject, defer) marked on a Debrief triage document — by a human, or by the agent under humanGate.mode access-only — routing accepted learnings where they belong. Idempotent."
argument-hint: "<path to triage doc | URL>"
---

Use the /lisa:debrief:apply command (which invokes the `lisa-debrief-apply` skill) to read the triage document at $ARGUMENTS, parse human dispositions, and persist accepted learnings to their categorized destinations.

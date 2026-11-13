---
description: "Apply the dispositions marked in a Debrief triage document (by a human, or by the agent when none are marked under humanGate.mode access-only) — route accepted learnings to their persistence destinations (Edge Case Brainstorm checklist, project rules, memory, tracker tickets). Reads the triage doc produced by /lisa:debrief; deterministic and idempotent."
argument-hint: "<path to triage doc | URL>"
---

Use the /lisa:debrief:apply command (which invokes the `lisa-debrief-apply` skill) to read the triage document at $ARGUMENTS, parse human dispositions, and persist accepted learnings to their categorized destinations.

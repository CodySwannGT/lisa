---
description: "Creates an implementation plan from a ticket URL, file path, or text description"
argument-hint: "<ticket-url | @file-path | description>"
---

Apply the `intent-routing` rule (loaded via the lisa plugin) and execute the **Plan** flow on $ARGUMENTS.

If requirements are ambiguous or no specification exists, suggest running the **Research** flow first.

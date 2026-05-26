---
description: "Inspect one PRD or build item, explain how Lisa classifies it right now, and report the exact intake or repair gate affecting it. Read-only by default."
argument-hint: "<item-ref>"
---

Use the /lisa:intake-explain skill to inspect a single repo-scoped PRD or build item, explain its current lifecycle role, and report whether Lisa would intake it, repair it, hold it, skip it, or leave it product-owned. $ARGUMENTS

Common operator usage:

- `/lisa:intake-explain https://github.com/acme/repo/issues/123`
- `/lisa:intake-explain PRD-456`
- `/lisa:intake-explain https://linear.app/acme/issue/ENG-123/example`

This surface is read-only in v1. Use it when you need a deterministic explanation for why one item is moving, waiting, blocked, skipped, or ignored before deciding whether to run `/lisa:intake`, `/lisa:repair-intake`, `/lisa:queue-status`, or a tracker-native fix.

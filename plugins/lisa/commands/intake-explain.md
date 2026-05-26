---
description: "Inspect one PRD or build item, explain how Lisa classifies it right now, and report the exact intake or repair gate affecting it. Read-only by default."
argument-hint: "<item-ref>"
---

Use the /lisa:intake-explain skill to inspect a single repo-scoped PRD or build item, explain its current lifecycle role, and report whether Lisa would intake it, repair it, hold it, skip it, or leave it product-owned. $ARGUMENTS

Common operator usage:

- `/lisa:intake-explain https://github.com/acme/repo/issues/123`
- `/lisa:intake-explain PRD-456`
- `/lisa:intake-explain https://linear.app/acme/issue/ENG-123/example`

The diagnosis uses stable verdicts:

- `ELIGIBLE_FOR_INTAKE`: run `/lisa:intake <queue>` when normal pickup is the next move.
- `ELIGIBLE_FOR_REPAIR`: run `/lisa:repair-intake <queue>` when Lisa-owned stuck work is actionable.
- `WAITING_ON_STALENESS`: wait and re-check after the configured freshness window.
- `HELD_BY_BLOCKERS`: clear the listed dependency or blocker before rerunning intake.
- `NON_LEAF_CONTAINER`: decompose the item or move build-ready status to leaf work.
- `PRODUCT_OWNED_STATE`: finish product clarification, promotion, or verification first.
- `MISCONFIGURED`: fix lifecycle labels, repo scope, or queue configuration before relying on automation.

Use it for these operator workflows:

- Intake triage: confirm whether one item would be picked up by `/lisa:intake` right now.
- Repair triage: decide whether a blocked or in-progress item is stale enough for `/lisa:repair-intake`.
- Product follow-up: distinguish product-owned draft/shipped/verified states from Lisa-owned work.
- Queue cleanup: identify leaf-only, repo-scope, dependency, or lifecycle-adoption fixes without mutating the item.

This surface is read-only in v1. It never claims, relabels, comments on, repairs, or decomposes the item; it only reports the item facts, verdict, decisive gate, and smallest useful next action before an operator chooses `/lisa:intake`, `/lisa:repair-intake`, `/lisa:queue-status`, or a tracker-native fix.

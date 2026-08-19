---
description: "Design-handoff gate for a work item with a UI surface. Resolves the source of truth per axis (colour, spacing, typography, radius, elevation, motion) by querying the configured design source's published variable collections — never by asking a human — then judges the item against the five objectively checkable block conditions. Values come from design variables where a variable system exists; measurement is the legitimate source where none does. Blocks on unbound, never on unsure. Escalates through the configured tracker to `design.escalation.assignee` with a plain-language comment — an unset assignee is itself a block, never a silent skip — and records every measured value so the gaps in the variable system accumulate on their own."
argument-hint: "[work-item-ref] [design-ref]"
allowed-tools: ["Skill"]
---

Use the /lisa-design-intake skill to run one design-handoff cycle: prove access to the design source, resolve the regime per axis, gather findings, let `scripts/design-intake-gate.mjs` decide, then either escalate the block to the configured assignee with the verbatim plain-language comment or proceed with the derived values recorded on the work item. $ARGUMENTS

---
description: "Check whether a UI work item has every design value bound to the design source's variables; block only on unbound values, escalating to design.escalation.assignee in plain language."
argument-hint: "[work-item-ref] [design-ref]"
allowed-tools: ["Skill"]
---

Use the /lisa-design-intake skill to run one design-handoff cycle: prove access to the design source, resolve the regime per axis, gather findings, let `scripts/design-intake-gate.mjs` decide, then either escalate the block to the configured assignee with the verbatim plain-language comment or proceed with the derived values recorded on the work item. $ARGUMENTS

---
description: "Implement a single work item end-to-end. Vendor-agnostic: given a work-item URL/key (JIRA, Linear, GitHub Issues) or description, reads it, determines work type (Build/Fix/Improve/Investigate), assembles an agent team, runs the full lifecycle through PR + evidence. For batch processing of all Status=Ready tickets in a queue, use /lisa:intake instead."
argument-hint: "<single-work-item-url | key | description>"
---

Use the /lisa:implement skill to take the work item from spec to shipped: read the source, determine work type, assemble an agent team, and run the full lifecycle through PR creation, code review, deploy, and empirical verification. $ARGUMENTS

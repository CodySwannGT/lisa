---
description: "Implement a work item end-to-end. Vendor-agnostic router: given a work-item URL/key (JIRA, Linear, GitHub Issues) or description, reads it, determines work type (Build/Fix/Improve/Investigate), assembles an agent team, runs the full lifecycle through PR + evidence."
argument-hint: "<work-item-url | key | description>"
---

Use the /lisa:implement skill to take a work item from spec to shipped: read the source (whichever tracker it lives in), determine work type, assemble an agent team, and run the full lifecycle through PR creation, code review, deploy, and empirical verification. $ARGUMENTS

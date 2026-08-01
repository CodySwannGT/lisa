---
description: "Implement a single work item end-to-end. Vendor-agnostic: given a work-item URL/key (JIRA, Linear, GitHub Issues) or description, reads it, determines work type (Build/Fix/Improve/Investigate), assembles an agent team, runs the full lifecycle through PR + evidence. Pass executionEnv=codex-cloud to run the work on a remote surface instead of locally — it submits and returns without polling, so the laptop is a launcher rather than the execution substrate. For batch processing of all Status=Ready tickets in a queue, use /lisa:intake instead."
argument-hint: "[executionEnv=local|codex-cloud] <single-work-item-url | key | description>"
---

Use the /lisa-implement skill to take the work item from spec to shipped: read the source, determine work type, assemble an agent team, and run the full lifecycle through PR creation, code review, deploy, and empirical verification.

If `$ARGUMENTS` carries `executionEnv=` with anything other than `local`, route the work to that surface via /lisa-remote-dispatch and report the recorded task identifier instead of running the lifecycle locally. $ARGUMENTS

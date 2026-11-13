---
disable-model-invocation: true
description: "Set up the recurring Lisa automations for this project with the runtime's native scheduler: intake, exploratory QA and ideation, monitoring, and the weekly learnings gardener. Undo with /lisa:tear-down-automations."
argument-hint: "[auto-start-prds=true|false] [auto-start-tickets=true|false]"
---

Use the /lisa-setup-automations skill to create the five recurring Lisa automations via this runtime's native scheduler (Codex automations / Claude /schedule), passing the auto-start-prds / auto-start-tickets flags through to the exploratory automations. $ARGUMENTS

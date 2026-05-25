---
description: "Remove the recurring Lisa automations /setup-automations created for this project (the lisa-auto-<project>-* set) using the runtime's native scheduler (Codex automations / Claude /schedule). A declarative spec — it states which automations to remove; the runtime's native mechanism does the removing. Removes only this project's Lisa automations, never others."
argument-hint: ""
---

Use the /lisa:tear-down-automations skill to remove this project's lisa-auto-<project>-* automations via this runtime's native scheduler (Codex automations / Claude /schedule), leaving other projects' and non-Lisa automations untouched. $ARGUMENTS

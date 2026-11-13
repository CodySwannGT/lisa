---
disable-model-invocation: true
description: "Remove this project's recurring wiki ingest automation using the runtime's native scheduler. Touches nothing else."
argument-hint: ""
---

Use the lisa-wiki-tear-down-automations skill to remove this project's lisa-wiki-auto-<project>-* automation via this runtime's native scheduler (Codex automations / Claude /schedule), leaving the base /lisa:setup-automations set, other projects', and non-Lisa automations untouched. $ARGUMENTS

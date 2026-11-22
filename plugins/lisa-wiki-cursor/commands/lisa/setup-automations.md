---
description: "Schedule the recurring daily wiki ingest for this project using the runtime's native scheduler. Undo with /lisa-wiki:tear-down-automations."
argument-hint: "[cadence=daily|weekly|every-<n>-hours]"
---

Use the lisa-wiki-setup-automations skill to create the recurring wiki-ingest automation via this runtime's native scheduler (Codex automations / Claude /schedule), running a full /lisa-wiki:ingest cycle on the resolved cadence (default daily) and naming it lisa-wiki-auto-<project>-ingest so teardown stays precise. $ARGUMENTS

---
description: "Enable the LLM Wiki kernel (lisa-wiki plugin) in this project so its setup skill becomes discoverable. Edits .claude/settings.json to enable lisa-wiki@lisa and confirm the CodySwannGT/lisa marketplace, then verifies the Codex overlay (.codex/skills/lisa) already carries the wiki kernel. Does NOT scaffold the wiki itself — after install, reload the runtime and run /setup:wiki (Claude) or $lisa-wiki-setup (Codex)."
allowed-tools: ["Skill"]
argument-hint: ""
---

Use the /lisa-wiki-install skill to enable the lisa-wiki plugin in this project. $ARGUMENTS

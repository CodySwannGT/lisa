---
disable-model-invocation: true
description: "Set up GitHub Issues as this project's tracker and/or PRD source: check gh, resolve org/repo, create the status and PRD labels, and write the github settings."
allowed-tools: ["Skill"]
argument-hint: "[--repo=<org/repo>]"
---

Use the /lisa-setup-github skill to configure GitHub as the tracker and/or PRD source: it writes the `github` section of `.lisa.config.json`, can document optional GitHub ProjectV2 coordination, and then offers top-level `tracker: "github"` / `source: "github"`. $ARGUMENTS

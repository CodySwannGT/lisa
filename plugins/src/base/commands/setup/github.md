---
description: "Set up GitHub Issues as the tracker and/or PRD source for this project. Verifies the gh CLI, resolves org/repo, scaffolds the `status:*` (build) and/or `prd-*` (PRD) label namespaces, writes the `github` section of `.lisa.config.json`, and can document optional GitHub ProjectV2 coordination before offering top-level `tracker: \"github\"` / `source: \"github\"`. No /lisa:setup:atlassian prerequisite."
allowed-tools: ["Skill"]
argument-hint: "[--repo=<org/repo>]"
---

Use the /lisa-setup-github skill to configure GitHub as the tracker and/or PRD source. $ARGUMENTS

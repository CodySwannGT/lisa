---
description: "Set up Linear as the tracker and/or PRD source for this project. Verifies Linear access (MCP OAuth or a personal API key in keychain), resolves the workspace slug and team key, scaffolds the `status:*` issue-label (build) and/or `prd-*` project-label (PRD) namespaces, writes the `linear` section of `.lisa.config.json`, and offers to set top-level `tracker: \"linear\"` / `source: \"linear\"`. No /lisa:setup:atlassian prerequisite."
allowed-tools: ["Skill"]
argument-hint: "[--workspace=<slug>] [--team=<KEY>]"
---

Use the /lisa-setup-linear skill to configure Linear as the tracker and/or PRD source. $ARGUMENTS

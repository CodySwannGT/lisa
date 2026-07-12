---
description: "Back-sync an environment branch down the deploy chain (hotfix propagation) on demand"
allowed-tools: ["Skill"]
argument-hint: "[source-env-or-branch]"
---

Use the /lisa-sync-down skill to back-sync an environment branch down the deploy chain — deriving the source→target chain from `.lisa.config.json` `deploy.order` + `deploy.branches`, then merging, resolving conflicts, opening PRs, and enabling auto-merge for each downward hop. $ARGUMENTS

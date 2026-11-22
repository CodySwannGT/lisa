---
description: "Update local Lisa projects canary-first — canary host first and a bounded wait on its required checks, then the rest (worktree per project, PR with auto-merge, auto-fix mergeability blockers), then Lisa self-upgrade; a failing canary halts the rollout"
allowed-tools: ["Skill"]
argument-hint: "(blank for all projects in .lisa.workspaces.json)"
---

Use the /lisa-update-projects skill to update local Lisa projects in batches. $ARGUMENTS

---
description: "Deploys an agent team to research, implement, review and deploy a plan"
argument-hint: "<ticket-url | @file-path | description>"
---

Pass through to `/build` with $ARGUMENTS. The Build command reads `.claude/rules/intent-routing.md` and runs the full Implement → Review → Verify chain, which is what this command historically did.

---
description: "Deploys an agent team to research, implement, review and deploy a plan"
argument-hint: "<ticket-url | @file-path | description>"
---

Pass through to `/build` with $ARGUMENTS. The Build command applies the `intent-routing` rule (loaded via the lisa plugin) and runs the full Implement → Review → Verify chain, which is what this command historically did.

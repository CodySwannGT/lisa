---
description: "Research a problem space and produce a PRD. Investigates codebase, defines user flows, assesses technical feasibility."
argument-hint: "<problem-statement-or-feature-idea>"
---

Apply the `intent-routing` rule (loaded via the lisa plugin) and execute the **Research** flow.

**Orchestration: agent team.** Research is a multi-specialist flow feeding a shared PRD. After echoing the flow and orchestration mode, your FIRST tool call MUST be `TeamCreate`. Do not call `TaskCreate`, `Agent`, or implementation tools before the team exists.

$ARGUMENTS

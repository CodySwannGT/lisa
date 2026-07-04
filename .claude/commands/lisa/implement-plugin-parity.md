---
description: "Execute an APPROVED plugin-parity routing artifact from analyze-plugin — emit MCP/LSP into agent variants via existing generators, enable vendor equivalents, and scaffold synced-from-stamped skills for reimplement cases. Hard-gates on status:approved; never ports plugin code"
allowed-tools: ["Skill"]
argument-hint: "<plugin>@<marketplace> (the approved artifact under parity/plugin-routing/)"
---

Use the /implement-plugin-parity skill to read the approved routing artifact for the given plugin, hard-gate on status:"approved", then perform only its declared deterministic actions by reusing Lisa's existing generators/installers and scaffolding synced-from-stamped skills for reimplement cases — never porting upstream plugin code. $ARGUMENTS

---
description: "Scaffold a domain-expert digital-staff role over the wiki — a dual-runtime subagent (Claude + Codex) plus a staff doc page — from a config.staff[] entry. The plugin only sets the subagent up; running/scheduling it is out of scope."
argument-hint: "<role name, e.g. Legal | Finance | Sales>"
---

Use the lisa-wiki-add-role skill to turn a role into a wiki/staff/<id>.md doc page and brain-pointed subagents on both runtimes (Claude .claude/agents/<id>.md + Codex .codex/agents/<id>.toml), pointed at the role's owned wiki domain. Setup-only — invocation/scheduling/routing is out of scope. $ARGUMENTS

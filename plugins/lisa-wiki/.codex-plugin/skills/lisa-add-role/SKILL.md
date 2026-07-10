---
name: lisa-add-role
description: "Scaffold a domain-expert…"
---
## Lisa Command Compatibility

- Original Claude command: `/lisa:add-role`
- Codex invocation: `$lisa-add-role` or a plain-English request that matches this skill.
- Treat the user's surrounding request as the command arguments.
- Claude argument hint: `<role name, e.g. Legal | Finance | Sales>`

Use the lisa-wiki-add-role skill to turn a role into a wiki/staff/<id>.md doc page and brain-pointed subagents on both runtimes (Claude .claude/agents/<id>.md + Codex .codex/agents/<id>.toml), pointed at the role's owned wiki domain. Setup-only — invocation/scheduling/routing is out of scope. Use the user's surrounding request as this command's arguments.

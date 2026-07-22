---
name: lisa-maestro-mcp-setup
description: "Enable the Maestro CLI's MCP…"
---
## Lisa Command Compatibility

- Original Claude command: `/lisa:maestro-mcp-setup`
- Codex invocation: `$lisa-maestro-mcp-setup` or a plain-English request that matches this skill.
- Treat the user's surrounding request as the command arguments.
- Claude allowed tools: `Skill`. Codex tool access is governed by the active Codex runtime and project policy.

Use the /lisa-expo:maestro-mcp-setup skill to enable the Maestro MCP server for this machine: detect the Maestro CLI and a usable Java runtime, install or guide whatever is missing (preferring the project's version manager), and register `maestro mcp` at local/per-machine scope with an absolute command path plus injected JAVA_HOME/PATH env. Local scope only — never a committed project `.mcp.json`. Use the user's surrounding request as this command's arguments.

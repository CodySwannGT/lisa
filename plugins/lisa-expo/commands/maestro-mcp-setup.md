---
description: "Enable the Maestro CLI's MCP server (maestro mcp, STDIO) for this machine, robustly. Detects the Maestro CLI + a usable Java runtime (honoring mise/asdf/sdkman), installs or guides what is missing, and registers the server at LOCAL/per-machine scope with an absolute command path and injected JAVA_HOME/PATH so the spawn never dies on a non-login PATH. Never registers at committed/project scope, which would reintroduce the fleet-wide -32000 failure."
allowed-tools: ["Skill"]
argument-hint: ""
---

Use the /lisa-expo:maestro-mcp-setup skill to enable the Maestro MCP server for this machine: detect the Maestro CLI and a usable Java runtime, install or guide whatever is missing (preferring the project's version manager), and register `maestro mcp` at local/per-machine scope with an absolute command path plus injected JAVA_HOME/PATH env. Local scope only — never a committed project `.mcp.json`. $ARGUMENTS

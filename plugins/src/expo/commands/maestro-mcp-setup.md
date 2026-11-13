---
disable-model-invocation: true
description: "Enable the Maestro CLI's MCP server on this machine at local scope, with an absolute command path and a working Java runtime. Never registers at project scope."
allowed-tools: ["Skill"]
argument-hint: ""
---

Use the /lisa-expo:maestro-mcp-setup skill to enable the Maestro MCP server for this machine: detect the Maestro CLI and a usable Java runtime, install or guide whatever is missing (preferring the project's version manager), and register `maestro mcp` at local/per-machine scope with an absolute command path plus injected JAVA_HOME/PATH env. Local scope only — never a committed project `.mcp.json`. $ARGUMENTS

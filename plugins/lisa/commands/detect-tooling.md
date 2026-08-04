---
description: "Find the command-line tools this project needs but never declares, and propose pinned manifest entries for them. Reads npm scripts, MCP servers, credential usage notes and quality configuration, subtracts what remoteEnv.tools already covers, and prints proposals with evidence. Writes nothing and installs nothing — a tool reaches a machine only once a human has reviewed a pinned, checksummed entry."
allowed-tools: ["Skill"]
argument-hint: "[--json]"
---

Use the /lisa-detect-tooling skill to find undeclared command-line tooling and propose manifest entries for it. $ARGUMENTS

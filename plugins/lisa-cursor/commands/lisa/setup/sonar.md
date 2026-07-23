---
description: "Wire the official SonarQube plugin + MCP into this project across every supported coding agent. Installs/updates the SonarQube CLI, authenticates (browser login on a dev machine, or SONARQUBE_TOKEN headless), selects the Test Manager target, runs `sonar integrate <agent>` for each supported agent, and writes only non-secret policy to `.lisa.config.json`. Does not touch the separate CI SonarCloud scan gate."
allowed-tools: ["Skill"]
argument-hint: "[--org=<org-key>] [--server-url=<url>] [--global]"
---

Use the /lisa-setup-sonar skill to wire the official SonarQube MCP for this project across every supported agent. $ARGUMENTS

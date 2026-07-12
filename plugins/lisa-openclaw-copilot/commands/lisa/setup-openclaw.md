---
description: "Set up OpenClaw as the chat-surface runtime for this project's staff. Verifies the openclaw CLI, ~/.openclaw/openclaw.json, a secret provider, and required gateway capabilities, then writes a lean `openclaw` section to .lisa.config.json. Run before connect-staff / connect-repo-topic."
argument-hint: "[telegram|slack]"
---

Use the lisa-openclaw-setup skill to verify OpenClaw prerequisites and write the lean `openclaw`
section to .lisa.config.json. If a platform is given, use it as the defaultPlatform. $ARGUMENTS

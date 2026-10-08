---
name: lisa-setup-openclaw
description: "Set up OpenClaw as the…"
---
Set up OpenClaw as the chat-surface runtime for this project's staff. Verifies the openclaw CLI, ~/.openclaw/openclaw.json, a secret provider, and required gateway capabilities, then writes a lean `openclaw` section to .lisa.config.json. Run before connect-staff / connect-repo-topic.

## Lisa Command Compatibility

- Original Claude command: `/lisa:setup-openclaw`
- Codex invocation: `$lisa-setup-openclaw` or a plain-English request that matches this skill.
- Treat the user's surrounding request as the command arguments.
- Claude argument hint: `[telegram|slack]`

Use the lisa-openclaw-setup skill to verify OpenClaw prerequisites and write the lean `openclaw`
section to .lisa.config.json. If a platform is given, use it as the defaultPlatform. Use the user's surrounding request as this command's arguments.

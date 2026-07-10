---
name: lisa-connect-repo-topic
description: "Bind a Telegram forum topic to…"
---
## Lisa Command Compatibility

- Original Claude command: `/lisa:connect-repo-topic`
- Codex invocation: `$lisa-connect-repo-topic` or a plain-English request that matches this skill.
- Treat the user's surrounding request as the command arguments.
- Claude argument hint: `<admin|developer> <single-repo|folder-scoped> <topic name> <workspace path>`

Use the lisa-openclaw-connect-repo-topic skill to provision or update a Telegram repo-coding topic
(dispatcher + worker pair) and wire it in OpenClaw. Use the user's surrounding request as this command's arguments.

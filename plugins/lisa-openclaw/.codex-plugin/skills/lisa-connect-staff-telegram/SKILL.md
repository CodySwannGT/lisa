---
name: lisa-connect-staff-telegram
description: "Connect staff roles to Telegram…"
---
Connect staff roles to Telegram via OpenClaw using a facilitator/specialist hub-and-spoke model — register bots, create/reuse the facilitator topic, wire routes, validate, and run an end-to-end route test. Requires /lisa:setup-openclaw first.

## Lisa Command Compatibility

- Original Claude command: `/lisa:connect-staff-telegram`
- Codex invocation: `$lisa-connect-staff-telegram` or a plain-English request that matches this skill.
- Treat the user's surrounding request as the command arguments.
- Claude argument hint: `<facilitator role + specialists, e.g. Chief of Staff with Legal, Finance, Sales>`

Use the lisa-openclaw-connect-staff skill with platform `telegram`. Connect the named facilitator and
specialists to a Telegram facilitator topic via OpenClaw. Use the user's surrounding request as this command's arguments.

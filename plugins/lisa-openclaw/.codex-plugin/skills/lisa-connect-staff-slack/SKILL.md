---
name: lisa-connect-staff-slack
description: "Connect staff roles to Slack…"
---
Connect staff roles to Slack via OpenClaw using a facilitator/specialist hub-and-spoke model — register the app, create/reuse the facilitator channel, wire routes, validate, and run an end-to-end route test. Requires /lisa:setup-openclaw first.

## Lisa Command Compatibility

- Original Claude command: `/lisa:connect-staff-slack`
- Codex invocation: `$lisa-connect-staff-slack` or a plain-English request that matches this skill.
- Treat the user's surrounding request as the command arguments.
- Claude argument hint: `<facilitator role + specialists, e.g. Chief of Staff with Legal, Finance, Sales>`

Use the lisa-openclaw-connect-staff skill with platform `slack`. Connect the named facilitator and
specialists to a Slack facilitator channel via OpenClaw. Use the user's surrounding request as this command's arguments.

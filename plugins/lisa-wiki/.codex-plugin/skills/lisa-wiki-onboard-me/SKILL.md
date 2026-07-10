---
name: lisa-wiki-onboard-me
description: "Onboard a user to the project…"
---

# lisa-wiki-onboard-me

Bidirectional onboarding: learn who the user is *in relation to this project*, then teach them what
the project is and how to use the wiki. The minimal project README points here.

## Workflow
1. **Interview** (brief): the user's role, goals, and what they intend to do in this project.
2. **Capture** to **project-scoped memory only** — Claude's per-project memory; on Codex only if a
   project-scoped memory store exists. If none exists, keep it session-local. **Never** write the
   capture into global memory and **never** commit PII into the wiki.
3. **Tour:** summarize the project from `wiki/start-here.md` + the wiki's `purpose`, show the folder
   map (categories), and point at the key entry pages.
4. **Sample questions:** offer a handful of `/query` prompts tuned to the user's role to get them
   productive immediately.

## Modes
- Default: **read-mostly, no PR.**
- `--save-memory`: persist the capture to project-scoped memory.
- `--write-audience-note`: write a sanitized, **non-PII** audience/role note into the wiki via the
  normal PR flow — only when `onboarding.allowAudienceNote: true` in config.

## Rules
- Project-scoped only; global Codex memory and the Chronicle store are never used.
- Do not auto-create a staff role; offer `/add-role` only if the user is taking on a durable project
  function (not merely onboarding).

## Related
`lisa-wiki-query`, `lisa-wiki-usage`, `lisa-wiki-add-role`.

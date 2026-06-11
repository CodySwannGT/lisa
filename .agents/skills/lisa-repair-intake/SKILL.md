---
name: lisa-repair-intake
description: Use when running one cron-safe Lisa repair-intake cycle for stuck or half-closed PRD/build queue items. Delegates to the generated Lisa repair-intake contract, typically with arguments like `github intake_mode=both`.
---

# Lisa Repair Intake

Use this skill when the caller asks for `$lisa-repair-intake`, `Lisa: Intake Repair`,
or a cron-safe `/lisa:repair-intake` sweep.

This is the Codex-facing wrapper for Lisa's generated repair-intake skill. The
canonical executable contract lives at:

- `plugins/lisa/skills/repair-intake/SKILL.md`
- `plugins/src/base/skills/repair-intake/SKILL.md`

## Instructions

1. Read `plugins/lisa/skills/repair-intake/SKILL.md`.
2. Run exactly one bounded repair-intake cycle using the caller's arguments.
3. If the caller provides no arguments, invoke with `github intake_mode=both`.
4. Preserve the generated skill's confirmation policy: do not ask whether to
   proceed once a queue is known.
5. Preserve the generated skill's Codex team-orchestration rule where available.

## Default Automation Invocation

```text
/lisa:repair-intake github intake_mode=both
```

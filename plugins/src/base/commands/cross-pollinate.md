---
description: "Detect locally-authored agent definitions and regenerate them in the formats of the other coding agents this project supports (per .lisa.config.json)."
allowed-tools: ["Skill"]
argument-hint: "[path] [--dry-run] [--write]"
---

Use the /lisa-cross-pollinate skill to detect this project's locally-authored
coding-agent definitions (skills, subagents, rules, commands, hooks, MCP) and
make each available in the formats of the other agents the project's
`.lisa.config.json` harness includes. $ARGUMENTS

Provenance is tracked in `.lisa/cross-pollination.lock.json`: the run is
idempotent, garbage-collects orphaned translations, never overwrites a
hand-edited target, and reports any conflict or unsupported translation rather
than guessing.

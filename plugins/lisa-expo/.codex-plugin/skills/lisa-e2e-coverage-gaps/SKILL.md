---
name: lisa-e2e-coverage-gaps
description: "Explore gaps in the automated…"
---
## Lisa Command Compatibility

- Original Claude command: `/lisa:e2e-coverage-gaps`
- Codex invocation: `$lisa-e2e-coverage-gaps` or a plain-English request that matches this skill.
- Treat the user's surrounding request as the command arguments.
- Claude argument hint: `[target-url | env] [ready=true|false]`
- Claude allowed tools: `Skill`. Codex tool access is governed by the active Codex runtime and project policy.

Use the /lisa-expo:e2e-coverage-gaps skill to inventory the app's routes and the existing Playwright suite, find uncovered and happy-path-only paths, confirm each gap in the running app, and file one build-ready missing-test ticket per gap via lisa:tracker-write (build-ready per the ready flag, default true). For human usability/experience findings, use /lisa:exploratory-qa. Use the user's surrounding request as this command's arguments.

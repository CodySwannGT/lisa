---
name: lisa-e2e-coverage-gaps
description: "Explore gaps in the automated…"
---
Explore gaps in the automated Playwright/e2e suite: inventory the app's routes and existing tests, find routes with no coverage or flows tested only on the happy path (missing error, permission, empty, loading, and edge cases), confirm each in the running app, and file bounded build-ready work for worthwhile test gaps via lisa-tracker-write. The optional ready flag (default true) controls build-ready vs backlog. For human usability issues, use exploratory-qa instead.

## Lisa Command Compatibility

- Original Claude command: `/lisa:e2e-coverage-gaps`
- Codex invocation: `$lisa-e2e-coverage-gaps` or a plain-English request that matches this skill.
- Treat the user's surrounding request as the command arguments.
- Claude argument hint: `[target-url | env] [ready=true|false]`
- Claude allowed tools: `Skill`. Codex tool access is governed by the active Codex runtime and project policy.

Use the /lisa-rails:e2e-coverage-gaps skill to inventory the app's routes and the existing Playwright suite, find uncovered and happy-path-only paths, confirm each gap in the running app, and file bounded build-ready work for worthwhile test gaps via lisa-tracker-write (build-ready per the ready flag, default true). For human usability/experience findings, use /lisa:exploratory-qa. Use the user's surrounding request as this command's arguments.

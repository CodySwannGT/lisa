---
description: "Explore gaps in the automated Playwright/e2e suite: inventory the app's routes and existing tests, find routes with no coverage or flows tested only on the happy path (missing error, permission, empty, loading, and edge cases), confirm each in the running app, and file one build-ready missing-test ticket per gap via lisa:tracker-write. The optional ready flag (default true) controls build-ready vs backlog. For human usability issues, use exploratory-qa instead."
allowed-tools: ["Skill"]
argument-hint: "[target-url | env] [ready=true|false]"
---

Use the /lisa-harper-fabric:e2e-coverage-gaps skill to inventory the app's routes and the existing Playwright suite, find uncovered and happy-path-only paths, confirm each gap in the running app, and file one build-ready missing-test ticket per gap via lisa:tracker-write (build-ready per the ready flag, default true). For human usability/experience findings, use /lisa:exploratory-qa. $ARGUMENTS

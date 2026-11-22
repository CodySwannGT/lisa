---
description: "Find end-to-end paths the Playwright suite doesn't cover — untested routes or happy-path-only flows — confirm each in the running app, and file tickets (build-ready by default). For usability problems use exploratory-qa."
allowed-tools: ["Skill"]
argument-hint: "[target-url | env] [ready=true|false]"
---

Use the /lisa-rails:e2e-coverage-gaps skill to inventory the app's routes and the existing Playwright suite, find uncovered and happy-path-only paths, confirm each gap in the running app, and file bounded build-ready work for worthwhile test gaps via lisa-tracker-write (build-ready per the ready flag, default true). For human usability/experience findings, use /lisa:exploratory-qa. $ARGUMENTS

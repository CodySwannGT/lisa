---
description: "Run a first-time-user exploratory QA walkthrough: experience the app like a brand-new human user, clicking through to find anything confusing, broken, or hard to understand (human-facing jargon, contextless extracted data, machine-style labels, slow or unclear loads, cramped or cut-off UI, inconsistent UX, awkward scroll behavior) across all breakpoints, and file each finding (bug or usability issue) as a tracked work item via lisa:tracker-write. The optional ready flag marks tickets build-ready (auto-picked-up by lisa:intake) or leaves them in the backlog for human triage (default). For gaps in the automated Playwright suite, use e2e-coverage-gaps instead."
allowed-tools: ["Skill"]
argument-hint: "[target-url | env] [ready=true|false]"
---

Use the /lisa-harper-fabric:exploratory-qa skill to experience the app like a brand-new first-time user — landing cold on the home page and clicking through to find anything confusing, broken, or hard to understand across all breakpoints — and file each finding (bugs, usability/clarity issues) as a tracked work item via lisa:tracker-write, build-ready or in triage per the ready flag (default: triage). For automated Playwright coverage gaps, use /lisa-harper-fabric:e2e-coverage-gaps. $ARGUMENTS

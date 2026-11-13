---
description: "Use the product like a brand-new user would — any product type — to find what's confusing, broken, or hard to use, and file each finding as a ticket (backlog by default; ready=true makes them build-ready)."
allowed-tools: ["Skill"]
argument-hint: "[target-url | env] [ready=true|false]"
---

Use the lisa-exploratory-qa skill to experience the product the way a brand-new first-time end user would — driving its real consumer-facing interface via the use-the-product core (product-type detection, per-environment mutation policy, and persona-lensed exploration), finding anything confusing, broken, or hard to use, and filing each worthwhile finding (bugs, usability/clarity issues) as a tracked work item via lisa-tracker-write, build-ready or in triage per the ready flag (default: triage). Static scans, HTTP fetches, screenshots alone, or console/network checks alone are not enough. For automated test-coverage gaps, use the e2e-coverage-gaps skill if your stack provides one. $ARGUMENTS

---
description: "Analyze one curated third-party Claude plugin and plan its per-agent parity (Codex/Cursor/agy/Copilot) — writes a proposed routing artifact + human matrix under parity/plugin-routing/, then STOPS for approval (plan-only, no source edits)"
allowed-tools: ["Skill"]
argument-hint: "<plugin>@<marketplace>, e.g. code-simplifier@claude-plugins-official"
---

Use the /analyze-plugin skill to inventory the given curated plugin, classify its components, decide a per-agent routing outcome, write the proposed routing artifact + review matrix under parity/plugin-routing/, and STOP for human approval without editing the source tree. $ARGUMENTS

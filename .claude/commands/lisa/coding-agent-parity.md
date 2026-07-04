---
description: "Research feature parity across the coding agents Lisa installs into (Claude / Codex / Cursor / agy / Copilot). Produces a four-part artifact: (1) universal feature catalog, (2) per-agent support matrix, (3) plugin-distributability matrix, (4) Lisa polyfill designs for the gaps. RESEARCH ONLY — implementation is the sibling skill lisa-coding-agent-parity-implement."
allowed-tools: ["Skill"]
argument-hint: "[optional surface scope, e.g. plugins | hooks | sub-agents | rules | all]"
---

Use the /lisa-coding-agent-parity skill to research feature parity across Claude, Codex, Cursor, agy, and Copilot. The skill produces a research artifact at `/tmp/parity-research.md` containing:

1. Universal feature catalog (every feature any agent supports, from web/docs + CLI queries + agent self-report)
2. Per-agent support matrix (which agents natively support each feature)
3. Plugin-distributability matrix (which supported features can be carried in that agent's plugin format)
4. Lisa polyfill designs for every gap (features absent on an agent, OR present-but-not-plugin-distributable, OR plugin-distributable-but-runtime-broken)

This skill is RESEARCH ONLY. It does not write installer code, build per-agent plugin variants, or modify Lisa's source tree. Implementation lives in the sibling skill `lisa-coding-agent-parity-implement`, which consumes the artifact this skill produces.

If a scope argument is provided (e.g. `plugins`, `hooks`, `sub-agents`), narrow the research pass to that feature subset; otherwise canvass the full universal catalog. $ARGUMENTS

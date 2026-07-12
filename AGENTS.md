# Lisa Agent Instructions

This repository is the Lisa monorepo. It now also contains an in-repository git-native LLM Wiki under `wiki/`.

Before changing wiki structure, ingestion behavior, or setup conventions, read:

- `wiki/schema/llm-wiki-contract.md`
- `wiki/projects/registry.md`
- `README.md`
- `wiki/documentation/overview.md`

Codex skills for Lisa wiki work live under `.agents/skills/`.

## Core Rules

- Treat `wiki/` as a durable source of truth for Lisa project knowledge.
- Keep the wiki inside this existing monorepo; do not create a wrapper repository.
- Treat the monorepo itself as the primary repository ingestion input.
- Treat `docs/wiki-inbox/` and `transcripts/` as ingestion inboxes. After ingestion, preserve reader-safe source notes under `wiki/sources/`.
- Record every ingestion in `wiki/log.md`.
- Update `wiki/index.md` whenever creating or materially changing wiki pages.
- Preserve unrelated working tree changes. In particular, do not stage or modify `.lisa.workspaces.json` unless explicitly requested.
- Do not commit local secrets, MCP OAuth artifacts, tokens, private keys, dependency directories, build outputs, coverage output, or generated distribution files unless the user explicitly requests release artifacts.
- After every successful ingestion, verify, commit only the ingestion changes, push, open a PR targeting `main`, and enable auto-merge. If ingestion started on `main`, create a dedicated ingestion branch before committing.

## Lisa-Specific Notes

- Lisa is a Bun/TypeScript monorepo published as `@codyswann/lisa`.
- The repo includes workspace packages for ESLint plugins and template directories for supported project stacks.
- Whenever adding or changing Lisa features, keep every supported coding agent's implementation in parity — Claude Code, Codex, Cursor, OpenCode, Antigravity (agy), and Copilot — wherever the agent has an equivalent surface. Claude is the reference implementation. If a behavior cannot be represented on some agent, document the gap in code comments, tests, or user-facing guidance instead of silently dropping it.

## Purpose

Lisa is installed into host projects to run **software factories** — agent-operated production lines that build, verify, and ship software with as few humans as possible. There are four factories: **Research, Plan, Implement, Verify**.

Humans are not allowed inside a factory. Every handoff happens outside, at the **gate**: agents, humans, and automations submit inputs to an intake agent, which adversarially evaluates each one — is the input high-quality and unambiguous, and does the factory have the tooling *and provable access to that tooling* to carry it out? The intake agent first tries to discover the answers to gaps itself; what it genuinely cannot resolve it rejects and raises to a human. In Lisa's vocabulary the gate is the ready-role flip (`prd-ready`, `status:ready`) plus intake's adversarial validation gates.

The pipeline: **Research** creates PRDs → **Plan** turns a PRD into work units (epics, stories, tickets, tasks) → **Implement** turns work units into quality software (tests, code, UI, APIs, infrastructure) → **Verify** produces a go/no-go decision by using the software the way a human would, filing any failures as build-ready tickets that flow straight back into the Implement factory. Prompts and ideation are the main entry points to the Research gate.

The factories run on the current runtime's native scheduler (Claude Routines, Codex Automations, or the equivalent), and three loops feed the pipeline continuously at the appropriate stage: **QA** (exploratory bugs), **Product Planning** (ideated PRDs), and **Monitoring** (observability regressions). Autonomy is the default — loop outputs enter the gates build-ready, and the adversarial intake is the quality control. Humans stand only at explicit exterior gates: promoting drafts they choose to hold back, approving protected deployments, and reviewing low-confidence learnings.

Everything else in Lisa — the skills, hooks, quality checks, and guardrails — exists to enforce enterprise-grade quality and verification standards that keep the software maintainable, across every major coding agent platform. When executed properly, end users have zero direct contact with coding agents.
# Lisa Workflow Playbook

Lisa exposes lifecycle commands and quality workflows that route work through repeatable steps.

## Lifecycle Commands

- Research: investigate the codebase and problem, then produce a PRD.
- Plan: decompose a PRD into ordered work items.
- Implement: take a ticket from spec to PR with verification.
- Verify: commit, push, open or update PR, monitor, and verify behavior.
- Debrief: mine shipped work for learnings and follow-up improvements.

## Maintenance Commands

Lisa also supports local review, PR review handling, test coverage improvement, test hardening, code-complexity reduction, max-lines reduction, linter-error cleanup, branch pruning, and security scans.

## Recurring Automations

Codex-hosted Lisa automations should run from durable project automation checkouts, not transient task worktrees. Setup flows create or refresh a stable checkout under the Codex worktree area, verify it is a normal non-bare Git work tree, and require each automation cycle to fetch and rebase or fast-forward against the default remote branch before queue or wiki work begins. If the checkout is dirty, conflicted, stale, or has broken Git metadata, the automation reports the blocker instead of mutating queue or wiki state.

## Query-First Project Answers

Agents should use the Lisa wiki query flow as the primary way to answer project questions from durable repository knowledge. This keeps operational answers grounded in maintained wiki pages and source notes instead of stale session context.

For Lisa wiki work specifically, `wiki/` is the durable knowledge source. Other repository folders such as `docs/`, `research/`, `docs/wiki-inbox/`, and `transcripts/` can still provide ingestion inputs, source evidence, fixtures, or scratch material, but successful ingestions preserve reader-safe evidence under `wiki/sources/` and record the run in `wiki/log.md`.

Wiki setup owns its local ignore hygiene through a managed `.gitignore` block. Setup and repair should merge that block instead of replacing the file, so project-owned ignore rules remain intact.

## Rule Loading

Lisa rules are now organized into eager heads and full reference bodies. Agents should treat the eager heads as the immediate operating contract and use the linked reference body when they need detailed procedure, examples, or edge-case policy.

## Project Ideation Pressure Gate

Project ideation may document new PRD candidates while the build queue is busy, but it should not auto-mark them ready when queue-status reports PRD pressure. The pressure helper keeps ideation throughput from bypassing the one-item build-intake discipline.

## Hook Delivery

Claude receives Lisa plugin hooks through the GitHub marketplace copy of the plugin, which tracks committed generated plugin artifacts on `main`. Codex receives hooks when `lisa apply` installs them into a project's `.codex/hooks.json`; a package update alone is not the delivery mechanism for Codex hooks.

## Exploratory QA

Exploratory QA now separates human-experience findings from e2e coverage gaps. Use the human-experience pass for product-facing behavior, friction, and visible issues; use the e2e-coverage-gaps pass for regression coverage opportunities that should become tests or backlog work.

## Repair Intake

Repair intake treats work as stuck after a two-hour threshold and records PR or deploy blocker diagnosis before moving stale queue items. This makes the smallest next action explicit when a PR, deployment, or status label prevents normal intake progress.

## Quality Gate Habit

Before shipping Lisa changes, expect local hooks and CI to run typecheck, formatting, linting, slow lint, dead-code detection, tests, coverage, security audit, and integration checks depending on the action.

The wiki has a separate lint path. Normal ESLint defaults ignore `wiki/**`, while wiki integrity continues to be checked through the Lisa wiki lint scripts.

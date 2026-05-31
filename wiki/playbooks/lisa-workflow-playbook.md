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

Claude Remote routine setup is now covered by two base commands. `/lisa:analyze-claude-remote` is the read-only cloud-readiness audit for a repository; `/lisa:generate-claude-remote-build-script` consumes that inventory and writes a remote-environment setup script, environment-variable-name template, and network allowlist.

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

Codex plugin-bundled hooks now use the plugin root and hook manifest shape Codex discovers in current releases. Fleet apply paths must include Codex explicitly so `lisa apply --harness fleet` does not silently skip the Codex emitter.

## Per-Agent Stack Variants

Lisa's plugin build now fans out stack and standalone plugins to Cursor, Antigravity, and Copilot variants in addition to the base plugin. `lisa apply` should install the base per-agent variant plus each detected stack variant that exists for the target agent, while Cursor consumes the published variants through its native plugin loader.

Rule delivery should use the same eager-or-flat resolution across agents: prefer `rules/eager/`, fall back to flat `rules/`, and keep `rules/reference/` on demand.

## Exploratory QA

Exploratory QA now separates human-experience findings from e2e coverage gaps. Use the human-experience pass for product-facing behavior, friction, and visible issues; use the e2e-coverage-gaps pass for regression coverage opportunities that should become tests or backlog work.

Exploratory QA evidence must stay grounded in observable page context. Human-language checks should flag human-facing jargon, and extracted facts that lack enough surrounding context should be treated as suspect rather than promoted directly into findings.

## Doctor Readiness

Doctor output includes plugin sync readiness and next-action guidance for plugin drift. Treat drift readiness as an operator-facing diagnostic: it should explain what needs to be synced without performing writes during the readiness check.

## Repair Intake

Repair intake treats work as stuck after a two-hour threshold and records PR or deploy blocker diagnosis before moving stale queue items. This makes the smallest next action explicit when a PR, deployment, or status label prevents normal intake progress.

Build intake distinguishes container issues from leaf issues by both type and child state. Epics and parent Stories remain rollup containers when they have child work, but a childless Story or Spike can be treated as a buildable leaf when it is otherwise ready for a single-repository implementation lane.

## Quality Gate Habit

Before shipping Lisa changes, expect local hooks and CI to run typecheck, formatting, linting, slow lint, dead-code detection, tests, coverage, security audit, and integration checks depending on the action.

The wiki has a separate lint path. Normal ESLint defaults ignore `wiki/**`, while wiki integrity continues to be checked through the Lisa wiki lint scripts.

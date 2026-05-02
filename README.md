# Lisa

Lisa is a governance layer for AI-assisted software development. It ensures that AI agents — whether running on a developer's machine or in CI/CD — follow the same standards, workflows, and quality gates.

## What Lisa Does

### Intent Routing

When a request comes in (from a human, a JIRA ticket, or a scheduled job), Lisa classifies it and routes it to the appropriate **flow**. Flows are ordered sequences of specialized agents, each with a defined role.

A request to fix a bug routes to a different flow than a request to build a feature or reduce code complexity. The routing is automatic based on context, but can be overridden explicitly via slash commands.

### Flows and Agents

A flow is a pipeline. Each step in the pipeline is an **agent** — a scoped AI with specific tools and instructions. One agent investigates git history, another reproduces bugs, another writes code, another verifies the result.

Behind the scenes, agents delegate domain-specific work to reusable instruction sets that are loaded automatically when a command runs. The same logic that triages a JIRA ticket interactively is the same logic invoked by the nightly triage workflow — you don't need to know which one is running.

Flows can nest. A build flow includes a verification sub-flow, which includes a ship sub-flow. This composition keeps each flow focused while enabling complex end-to-end workflows.

### Quality Gates

Lisa enforces quality through layered gates:

- **Rules** are loaded into every AI session automatically. They define coding standards, architectural patterns, and behavioral expectations. The AI follows them because they're part of its context.
- **Git hooks** are hard stops. Pre-commit hooks run linting, formatting, and type checking. Pre-push hooks run tests, coverage checks, security audits, and dead code detection. Nothing ships without passing.
- **Claude hooks** bridge AI actions to project tooling — ensuring that when the AI commits, pushes, or creates a PR, the project's quality infrastructure runs.

### Location Agnostic

The same rules, workflows, and quality gates apply everywhere:

- On a developer's workstation running Claude Code interactively
- In a GitHub Action running a nightly improvement job
- In a CI workflow responding to a PR review comment

The orchestration adapts to context — using MCP integrations locally and REST APIs in CI — but the standards don't change.

### Template Governance

Lisa distributes its standards to downstream projects as templates. When a project installs Lisa, it receives:

- Linting, formatting, and type checking configurations
- Test and coverage infrastructure
- CI/CD workflows
- Git hooks
- AI agent definitions and project rules

Templates follow governance rules: some files are overwritten on every update (enforced standards), some are created once and left alone (project customization), and some are merged (shared defaults with project additions).

## Quick Start

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

> Ask Claude: "I just cloned this repo. Walk me through setup."

## Working With Lisa

Lisa exposes a small set of top-level commands that map to the work lifecycle. Run them in Claude Code; everything underneath — agents, sub-flows, and the supporting libraries that power each step — happens automatically.

### The Lifecycle

A piece of work moves through five stages. Each stage has one command.

| Stage | Command | What it does |
| --- | --- | --- |
| Research | `/lisa:research <problem>` | Investigates the codebase and problem space, then produces a PRD ready for planning. |
| Plan | `/lisa:plan <PRD>` | Decomposes a PRD into ordered work items in your tracker (JIRA, GitHub Issues, or Linear). |
| Implement | `/lisa:implement <ticket>` | Takes one work item from spec to shipped: assembles an agent team, runs the build, opens a PR, handles review, merges. |
| Verify | `/lisa:verify` | Commits, pushes, opens a PR, monitors deploy, and verifies behavior in the target environment. Folded into `/lisa:implement` but available standalone. |
| Debrief | `/lisa:debrief <epic>` | After shipping, mines tickets and PRs to surface edge cases, gotchas, and friction. Produces a triage doc; `/lisa:debrief:apply` persists accepted learnings. |

Most users only ever call `/lisa:research`, `/lisa:plan`, and `/lisa:implement`. The rest run automatically as sub-flows.

### Batch and Scheduled Work

| Command | What it does |
| --- | --- |
| `/lisa:intake <queue-url>` | Scans a Ready queue (Notion PRD database, JIRA project, GitHub repo, Linear team, Confluence space) and dispatches each item through the right lifecycle command. Designed as the cron target for unattended runs. |

### Maintenance and Operations

| Command | What it does |
| --- | --- |
| `/lisa:monitor [environment]` | Checks application health, logs, error rates, and performance for the named environment. |
| `/lisa:product-walkthrough <route>` | Walks the live product through a real browser to ground PRD or ticket reasoning in current behavior. |
| `/lisa:codify-verification <type> <what>` | Converts a passing manual verification into a regression test in the appropriate framework (Playwright, integration test, benchmark). Runs automatically after `/lisa:verify`. |
| `/lisa:review:local` | Reviews local branch changes against `main`. |
| `/lisa:pull-request:review <pr-url>` | Pulls down review comments on a PR and implements the valid ones. |
| `/lisa:security:zap-scan` | Runs an OWASP ZAP baseline scan against the local app. |

### Targeted Improvements

These commands tighten a specific quality threshold and fix every violation in one pass — useful for incremental hardening or nightly jobs.

| Command | What it does |
| --- | --- |
| `/lisa:improve:test-coverage <pct>` | Raises coverage to the target percentage by adding tests for uncovered code. |
| `/lisa:improve:tests <target>` | Strengthens weak, brittle, or poorly-written tests. |
| `/lisa:improve:code-complexity` | Lowers the cognitive-complexity threshold by 2 and fixes resulting violations. |
| `/lisa:improve:max-lines <n>` | Reduces the max-file-lines threshold and fixes violations. |
| `/lisa:improve:max-lines-per-function <n>` | Reduces the max-lines-per-function threshold and fixes violations. |
| `/lisa:fix:linter-error <rule> [...]` | Fixes every violation of one or more ESLint rules across the codebase. |

### Git Helpers

| Command | What it does |
| --- | --- |
| `/lisa:git:commit [hint]` | Creates conventional commits from the current changes. |
| `/lisa:git:submit-pr [hint]` | Pushes and opens or updates a PR. |
| `/lisa:git:prune` | Prunes local branches whose remotes have been deleted. |

### Talking to Lisa in Plain English

You don't have to remember any of this. Tell Claude what you want and the right command will run:

> "I have JIRA ticket PROJ-1234. Research, plan, and implement it."
> "Walk through the checkout flow and tell me what's broken."
> "Get test coverage to 90%."

> Ask Claude: "What commands are available?" for the full list at any time.

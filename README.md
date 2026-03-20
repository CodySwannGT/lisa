# Lisa

Lisa is a governance layer for AI-assisted software development. It ensures that AI agents — whether running on a developer's machine or in CI/CD — follow the same standards, workflows, and quality gates.

## What Lisa Does

### Intent Routing

When a request comes in (from a human, a JIRA ticket, or a scheduled job), Lisa classifies it and routes it to the appropriate **flow**. Flows are ordered sequences of specialized agents, each with a defined role.

A request to fix a bug routes to a different flow than a request to build a feature or reduce code complexity. The routing is automatic based on context, but can be overridden explicitly via slash commands.

### Flows and Agents

A flow is a pipeline. Each step in the pipeline is an **agent** — a scoped AI with specific tools and skills. One agent investigates git history, another reproduces bugs, another writes code, another verifies the result.

Agents delegate domain-specific work to **skills** — reusable instruction sets that can be invoked by agents, by slash commands, or by CI workflows. The same skill that triages a JIRA ticket interactively is the same skill invoked by the nightly triage workflow.

Flows can nest. A build flow includes a verification sub-flow, which includes a ship sub-flow. This composition keeps each flow focused while enabling complex end-to-end workflows.

### Quality Gates

Lisa enforces quality through layered gates:

- **Rules** are loaded into every AI session automatically. They define coding standards, architectural patterns, and behavioral expectations. The AI follows them because they're part of its context.
- **Git hooks** are hard stops. Pre-commit hooks run linting, formatting, and type checking. Pre-push hooks run tests, coverage checks, security audits, and dead code detection. Nothing ships without passing.
- **Claude hooks** bridge AI actions to project tooling — ensuring that when the AI commits, pushes, or creates a PR, the project's quality infrastructure runs.

### Location Agnostic

The same rules, skills, and quality gates apply everywhere:

- On a developer's workstation running Claude Code interactively
- In a GitHub Action running a nightly improvement job
- In a CI workflow responding to a PR review comment

The analytical logic lives in skills. The enforcement lives in hooks and rules. The orchestration adapts to context — using MCP integrations locally and REST APIs in CI — but the standards don't change.

### Template Governance

Lisa distributes its standards to downstream projects as templates. When a project installs Lisa, it receives:

- Linting, formatting, and type-checking configurations
- Test and coverage infrastructure
- CI/CD workflows
- Git hooks
- AI agent definitions, skills, and rules

Templates follow governance rules: some files are overwritten on every update (enforced standards), some are created once and left alone (project customization), and some are merged (shared defaults with project additions).

## Quick Start

```bash
brew install claude-code
```

> Ask Claude: "I just cloned this repo. Walk me through setup."

## Working With Lisa

> Ask Claude: "I have JIRA ticket [TICKET-ID]. Research, plan, and implement it."

Or use slash commands directly:

- `/fix` — route through the bug fix flow
- `/build` — route through the feature build flow
- `/improve` — route through the improvement flow
- `/investigate` — route through the investigation flow
- `/jira:triage <TICKET-ID>` — analytical triage gate: detect ambiguities, edge cases, and verification methodology
- `/plan:improve-tests <target>` — improve test quality by analyzing and strengthening weak or brittle tests

> Ask Claude: "What commands are available?"

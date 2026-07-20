# Lisa

Lisa turns a repository into a set of **software factories** — agent-operated production lines (Research → Plan → Implement → Verify) that build, verify, and ship software with as few humans as possible. Underneath the factories, Lisa is governance-as-code for AI-assisted software development: one set of standards, workflows, and quality gates applies identically whether the work is done by a human, by an AI agent on a laptop, or by a scheduled job — distributed to every project as a versioned dependency, and to every major coding agent platform (Claude Code, Codex, Cursor, OpenCode, Antigravity, Copilot) from one source.

> **How to read this README**
>
> Lisa changes frequently, so this file stays deliberately conceptual. It teaches the mental model, which is stable, and avoids the specifics that drift — exact command names, flags, file paths, supported stacks, and version-dependent behavior. Wherever you need a current, concrete answer, you'll find a **Prompt for your coding agent**: a question to ask Claude Code (or whichever agent you use) that reads the live repository and answers from source.
>
> - **Humans** — paste the prompt into your agent instead of trusting a hard-coded list that may be stale.
> - **Agents** — treat these prompts as instructions. Prefer discovering the current answer from the repository over asserting it from memory, and verify against source before stating it as fact. That habit is the same one Lisa enforces on all work: *prove it, don't assume it.*

## What Lisa is

Lisa wears four faces from a single package:

- **A factory operator.** Scheduled intake agents watch queues of ready work, adversarially gate what enters the pipeline, and run each item through Research → Plan → Implement → Verify without a human in the loop.
- **A standards engine.** It applies a curated set of configs, CI workflows, git hooks, and project rules into a target repository and keeps them current as the package updates.
- **An operating system for coding agents.** It ships the skills, commands, agent roles, rules, and hooks that define *how* an AI agent investigates, builds, reviews, ships, and verifies work — and it delivers that same content to every supported agent runtime from one source.
- **A configuration library.** Projects can consume Lisa's linting, testing, and TypeScript presets directly, per technology stack, without adopting the rest.

All four are versioned together, so "how we build software here" upgrades by bumping one dependency.

> **Prompt for your coding agent**
> "Give me a one-paragraph tour of this repository's top-level layout: where the apply/template engine lives, where the agent plugin content is authored, and where the shared config presets are exported. Read the source and cite paths."

## The factory model

Lisa's purpose is to run four **factories** in your project — production lines operated by agents, not people — so that **non-technical people can create scalable software** by describing outcomes while the factories supply the engineering discipline. **Research** creates PRDs. **Plan** turns a PRD into ordered work units. **Implement** turns work units into quality software — tests, code, UI, APIs, infrastructure. **Verify** issues a go/no-go by using the software the way a human would, and files any failures straight back into Implement as build-ready tickets, so the loop heals itself.

Humans don't work inside a factory. Handoff happens outside, at the **gates**: agents, humans, and automations submit inputs, and an intake agent adversarially evaluates each one — is it high-quality and unambiguous, and does the factory have the tooling *and provable access to that tooling* to execute it? The intake agent tries to resolve gaps itself first; what it genuinely can't resolve, it rejects and raises to a human rather than guessing.

Three loops keep the pipeline fed without anyone asking: **QA** explores the product like a first-time user and files bugs, **Product Planning** ideates PRDs, and **Monitoring** audits observability signals and files regressions. Everything runs on the coding agent's native scheduler, and by default the loops' outputs enter the gates pickup-ready — the adversarial intake is the quality control, not a human triager. Executed properly, end users have zero direct contact with coding agents: they see the tracker, the PRDs, and the shipped software.

> **Prompt for your coding agent**
> "Explain how this project's factory pipeline is wired right now: which automations exist and on what cadence, what each gate checks before admitting work, and where a human is still required. Read the installed automations and intake skills — don't guess."

## Core principles

These are the durable ideas. Everything concrete descends from them.

**Single source, many destinations.** Agent instructions are authored once and compiled into runtime-specific artifacts and into each project. You never hand-edit the generated output — you edit the source and rebuild.

> **Prompt for your coding agent**
> "In this repo, which directory is the source of truth for plugin/agent content, which directories are generated artifacts, and what command rebuilds them? Show me the guard that fails CI if the artifacts drift from source."

**Location-agnostic.** The same rules and gates hold on a developer's workstation, in a scheduled improvement job, and in a CI workflow reacting to a PR. Only the plumbing adapts — local integrations versus REST in CI — the standards do not.

**Layered quality gates.** Rules load into every agent session as context; git hooks are hard stops on commit and push; agent hooks bridge an agent's actions to the project's real tooling so linting, tests, and checks actually run.

> **Prompt for your coding agent**
> "List the quality gates that would run against a change in this project — session rules, git hooks, and agent hooks — and for each, tell me whether it blocks or only warns, and how you can tell from the code."

**Evidence-based verification.** A task is not "done" because an agent says so. Lisa requires work to be proven with reproducible, empirical evidence — the change is exercised, the behavior observed, the proof attached to the ticket and the PR — and it enforces this with gates that are not meant to be bypassed. If you take one idea from Lisa, take this one.

For DOM-web empirical verification, projects may explicitly opt into the guarded
[Kane CLI provider](docs/kane-cli-integration.md). It supplies a normalized live-browser result and
evidence pack while Lisa retains environment policy, the final verdict, durable evidence, and
native Playwright/Maestro regression authority.

> **Prompt for your coding agent**
> "Walk me through how this project verifies that a change actually works before it is considered complete. What evidence is required, where is it recorded, and which gate refuses to let unverified work ship?"

**Governed templates.** Every file Lisa distributes carries a governance intent: some are enforced and overwritten on every update, some are seeded once and then owned by the project, and some are merged so the project and Lisa both contribute. Knowing which is which tells you what you can safely edit.

> **Prompt for your coding agent**
> "For the file I want to change in my project, is it enforced by Lisa (overwritten on update), created-once (mine to edit), or merged? Read the template source and explain what will happen to my edits on the next Lisa update."

**One repository per unit of work.** Planning artifacts may span repositories, but anything actually built and shipped targets exactly one repository. This keeps ownership and review unambiguous.

## Getting started

Install Lisa as a development dependency in each project that uses it:

```bash
bun add --dev --trust @codyswann/lisa
```

Lisa's dependency `postinstall` runs `lisa apply` for that project. A later
`bun update @codyswann/lisa` reapplies the updated project-scoped artifacts.
Lisa does not register user-wide Codex plugins, skills, hooks, rules, MCP
servers, or configuration. Other harnesses retain their existing delivery
behavior. For a new project, run the CLI ephemerally with
`bunx @codyswann/lisa setup-project ...`.

For Codex, apply emits a repository marketplace containing only the base Lisa
plugin plus detected stacks and explicitly configured features. Codex loads
native skills, hooks, and rules directly from those installed plugin bundles.
Skill bodies are not copied into the project and unrelated Lisa stacks are not
loaded. Project settings use `[features].hooks`; the deprecated `codex_hooks`
key is removed during reconciliation.

Remote coding environments use one vendor-neutral AWS bootstrap rather than
repository-specific or agent-specific IAM users. Run `/lisa:setup-remote-aws`
to install the common setup script and native Cursor/Copilot adapters; Claude,
Codex, Cursor, Copilot, and user-managed Antigravity/OpenCode hosts all consume
the same `LISA_AWS_BOOTSTRAP_JSON` bundle. See
[Remote coding-agent AWS access](docs/remote-agent-aws.md).

The supported stacks, setup flags, and exact invocation evolve as the project grows, so ask for the current set rather than copying a list that may have moved on:

> **Prompt for your coding agent**
> "Using this project's `lisa` CLI, show me how to (a) scaffold a new project and (b) apply Lisa to an existing one. List the project types it supports right now and the flags each command accepts — read `lisa --help` and the CLI source, don't guess."

### Brownfield projects: becoming agent-ready

A greenfield project is agent-ready by construction. An existing codebase carries years of tacit knowledge in people's heads, so Lisa converges it before the factories run unattended — in two steps. **Knowledge first**: an onboarding command reads every inventoried source without mutating it, redacts secrets, credentials, and policy-detected sensitive PII, omits or aggregates ordinary person-level user data before wiki persistence, and records each source as complete, partial, or unavailable. Partial and unavailable sources remain open gaps; humans answer gaps inline, a fresh session re-runs the ingest, and convergence requires both every source complete and zero open gaps. **Standards second**: apply Lisa's full rules and thresholds — the project will go red, deliberately — and let agents refactor to conform without changing behavior, proven by the test suite and empirical verification.

> **Prompt for your coding agent**
> "Is this project agent-ready? Run the agent-ready onboarding: inventory every connected source, ingest it read-only with redaction, show me each source's coverage status and the open gaps only I can answer, and tell me exactly what happens after I answer them."

## The work lifecycle

Lisa organizes a piece of work as a pipeline of specialized agent roles — the factories, seen from inside. Conceptually a work item moves through five stages:

1. **Understand** *(the Research factory)* — investigate the codebase and the problem, produce a spec or PRD.
2. **Plan** *(the Plan factory)* — decompose the spec into ordered work items in your tracker.
3. **Build** *(the Implement factory)* — take one item from spec to a merged PR: a team of agents implements, reviews, and ships it.
4. **Prove** *(the Verify factory)* — deploy, verify the behavior in the target environment with real evidence, and turn a passing manual check into a regression test.
5. **Learn** — after shipping, mine the work for edge cases and friction and fold accepted learnings back into the standards.

Most people invoke only the first stages explicitly; the rest run as nested sub-flows. The same logic runs whether you trigger it by hand or a scheduled job triggers it unattended.

> **Prompt for your coding agent**
> "List the current Lisa lifecycle commands for this project — understand, plan, build, prove, learn — with their exact names and arguments, and note any that run automatically as sub-steps. Read the installed commands, don't answer from memory."

### Unattended and batch work

Lisa can watch a queue of ready work and dispatch each item through the lifecycle on its own, which is what makes it usable as a scheduled operator. A standard automation fleet covers the pipeline movers (PRD intake, ticket intake, queue repair) and the three feeding loops (exploratory QA, product ideation, observability monitoring); Lisa can also recover queues that are stuck and report whether the fleet is healthy.

> **Prompt for your coding agent**
> "Which commands let this Lisa scan a work queue, dispatch ready items, repair stuck ones, and report on scheduled-automation health? Show me how I'd point one at my queue and what it expects in configuration."

## Working across trackers and sources

Lisa is deliberately vendor-neutral. The lifecycle runs the same whether your tickets live in one tracker or another and whether your product specs originate in one document tool or another — a thin dispatch layer selects the right integration from configuration, so the workflow you learn transfers.

> **Prompt for your coding agent**
> "Which issue trackers and which PRD/spec sources does this Lisa support today, and which config keys select them? Read the vendor dispatch layer and the setup skills, then show me a minimal configuration for my combination."

## The in-repository knowledge base

Lisa keeps a durable, markdown knowledge base inside the repo as the long-lived memory for architecture, workflows, decisions, and history — separate from the fast-moving code. It can ingest commits, PRs, design docs, and notes into that base and answer questions from it.

> **Prompt for your coding agent**
> "Where is this repo's knowledge base, what should I read first to orient myself, and how do I ask you to ingest recent changes into it? List the current entry points."

A downstream project can add the same knowledge base on demand rather than receiving it by default.

> **Prompt for your coding agent**
> "Does my project have Lisa's knowledge base enabled? If not, walk me through enabling and bootstrapping it using whatever the current install and setup commands are."

## Extending or contributing to Lisa

If you're changing Lisa itself: author agent content and templates at their source, never in generated output, and rebuild so the distributed artifacts regenerate. Lisa applies its own standards to itself, so the same gates that guard downstream projects guard this one — including the requirement to prove your change works.

> **Prompt for your coding agent**
> "I want to add or change a skill, rule, hook, or agent in Lisa. Show me the source location, the build step, what I must commit alongside it, and the CI check that fails if I edit a generated artifact directly. Then check my change against those rules before I commit."

## Just ask

You don't need to memorize any of this. Describe the outcome you want and let Lisa route it:

> "I have a ticket in our tracker — research it, plan it, and implement it."
>
> "Walk the checkout flow in a real browser and tell me what's broken."
>
> "Get test coverage on this module to 90% and prove it."

> **Prompt for your coding agent**
> "What can Lisa do in this project right now? List the available commands grouped by purpose, and flag anything that needs configuration I haven't set up yet."

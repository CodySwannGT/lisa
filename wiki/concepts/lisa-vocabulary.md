# Lisa Vocabulary

## Flow

A flow is an ordered sequence of specialized agents or workflow steps for a category of work.

## Agent

An agent is a scoped AI role with specific tools, instructions, and responsibilities.

## Rule

A rule is always-on project guidance loaded into AI sessions.

## Skill

A skill is reusable, specialized instruction that teaches a pattern or implements a workflow.

## Template Family

A template family is a group of files Lisa installs for a downstream stack such as TypeScript, Expo, NestJS, CDK, or Rails.

## Strategy

A strategy defines how Lisa applies a file to a downstream project: overwrite, create once, merge, copy contents, package metadata update, or tagged merge.

## Quality Gate

A quality gate is an automated check that must pass before a change can progress.

## Installation Readiness

Installation readiness answers: "Is Lisa installed and configured correctly in this project?" It is
the question answered by the shipped `lisa doctor` groups. It does not establish that an unattended
agent fleet can safely own the repository.

## Repository Readiness

Repository readiness answers: "May an agent fleet operate this repository unattended?" It applies
the eight ownership dimensions in the `readiness-rubric` rule. Installation readiness and repository
readiness are orthogonal: a project can pass installation checks while repository evidence still
requires supervised operation.

## Ship Blocker

A ship blocker is one of the readiness rubric's closed B1-B7 conditions that, standing alone, makes
repository readiness `NOT_READY` and requires a narrowed claim describing what operation remains
safe. It is not a `convergent-review` blocking finding (a review result), a `tool-access-gate`
break-out (leaving a flow to obtain access), or a `leaf-only-lifecycle` safe-block (a tracker state
that preserves incomplete work). `NOT_READY` is the overall readiness verdict; a ship blocker is the
repository condition that causes it.

## Automation Checkout

An automation checkout is the durable local Git work tree used by recurring Codex automations for a project. It should be synced to the default remote branch at the start of each run and verified as a non-bare Git work tree before the automation is saved or executed.

## Query-First

Query-first means project questions should be answered through the maintained Lisa wiki query path before relying on ad hoc session memory.

## Wiki Knowledge Source

The wiki knowledge source rule means Lisa wiki pages are the durable home for project knowledge, while non-wiki folders may remain valid ingestion inputs or evidence locations when their contents are synthesized back into `wiki/`.

## Eager Rule

An eager rule is the concise, always-on head of a Lisa rule. It gives agents the immediate operating contract and links to the matching reference rule for full detail.

## Reference Rule

A reference rule is the expanded rule body that holds procedure, examples, and edge-case guidance. Reference rules are paired with eager rules so runtime surfaces can stay concise without dropping detail.

## Ideation Ledger

An ideation ledger is durable automation run metadata for project, PRD, or thread ideation work. It records enough context to make repeated runs idempotent and auditable.

## PRD Pressure

PRD pressure is the queue condition where project ideation should not mark new PRDs ready automatically because existing ready or in-progress build work already needs attention. Lisa's queue-status helper exposes this pressure signal so ideation can document a PRD without overloading the build queue.

## Digital Staff Roster

A digital staff roster is the wiki-owned set of role pages and runtime subagents that represent domain experts for a project. Lisa wiki setup now seeds the standard roster by default when a project has not declared a custom `config.staff[]`.

## Managed Wiki Ignore Block

A managed wiki ignore block is the Lisa wiki-owned section inserted into a project's `.gitignore` during setup or repair. It is merged by marker so wiki-local artifacts can be ignored without overwriting project-owned entries.

## E2E Coverage Gap

An e2e coverage gap is behavior found during exploratory QA that should be represented by an end-to-end regression test rather than only a human-facing bug report.

## Contextless Extracted Data

Contextless extracted data is information gathered during exploratory QA without enough page or workflow context to support a durable finding. Lisa should flag it for review instead of treating it as grounded evidence.

## Plugin Sync Readiness

Plugin sync readiness is the doctor-reported state that tells operators whether generated plugin artifacts are in sync and what drift action, if any, should happen next. The readiness check is read-only.

## Per-Agent Plugin Variant

A per-agent plugin variant is a generated Lisa plugin artifact tailored to one coding agent's plugin shape, hook model, and rule-loading behavior. Pattern B variants are built from shared `plugins/src/` source rather than hand-edited generated directories.

## Eager-Or-Flat Rule Resolution

Eager-or-flat rule resolution means Lisa first loads `rules/eager/` when present and otherwise falls back to flat markdown files directly under `rules/`. `rules/reference/` stays out of startup injection and is loaded only when needed.

## Claude Remote Routine Readiness

Claude Remote routine readiness is the local-vs-cloud audit Lisa runs before a repository is expected to execute inside a Claude Code remote routine. It inventories required CLIs, package managers, environment variable names, startup hook safety, MCP transport/auth boundaries, user-scoped config gaps, and network allowlist needs without collecting secret values.

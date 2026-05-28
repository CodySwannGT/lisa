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

## Automation Checkout

An automation checkout is the durable local Git work tree used by recurring Codex automations for a project. It should be synced to the default remote branch at the start of each run and verified as a non-bare Git work tree before the automation is saved or executed.

## Query-First

Query-first means project questions should be answered through the maintained Lisa wiki query path before relying on ad hoc session memory.

## Wiki Knowledge Source

The wiki knowledge source rule means Lisa wiki pages are the durable home for project knowledge, while non-wiki folders may remain valid ingestion inputs or evidence locations when their contents are synthesized back into `wiki/`.

## Ideation Ledger

An ideation ledger is durable automation run metadata for project, PRD, or thread ideation work. It records enough context to make repeated runs idempotent and auditable.

## PRD Pressure

PRD pressure is the queue condition where project ideation should not mark new PRDs ready automatically because existing ready or in-progress build work already needs attention. Lisa's queue-status helper exposes this pressure signal so ideation can document a PRD without overloading the build queue.

## Digital Staff Roster

A digital staff roster is the wiki-owned set of role pages and runtime subagents that represent domain experts for a project. Lisa wiki setup now seeds the standard roster by default when a project has not declared a custom `config.staff[]`.

## E2E Coverage Gap

An e2e coverage gap is behavior found during exploratory QA that should be represented by an end-to-end regression test rather than only a human-facing bug report.

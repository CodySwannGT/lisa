---
name: lisa-research
description: "Research a problem and create a PRD in the configured PRD source (Notion, Confluence, GitHub, or Linear): investigate the code, define user flows, assess feasibility, and write the spec. Can create it draft or ready."
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep"]
---

# Research

Produce a PRD for the problem in `$ARGUMENTS`, then create it in the configured PRD source.

## Inputs

- The problem statement / feature idea (required) — free text, a feasibility card, or a URL.
- `prd_ready` (optional, default `false`) — `false` creates the PRD in the source's `draft` role for
  human review; `true` creates it in the `ready` role so `lisa-intake` (PRD side) auto-claims it.
- `dedupe_key` / `marker` (optional) — a stable dedupe marker (e.g. supplied by
  `lisa-project-ideation`) embedded in the created PRD so re-runs reference the existing PRD rather
  than creating a duplicate.
- `ideation_ledger_payload` (optional, required when invoked by `lisa-project-ideation`) — a
  structured metadata object to forward unchanged to `lisa-prd-source-write`. It carries the
  selected marker, automation id/path when available, persona names, persona evidence references,
  rejected overlap candidates, repo identity, `prd_ready`, selected idea title/key, and expected
  empirical verification artifact. When supplied, `reproposal_context` contains the dated decline,
  new evidence, changed consequence, and the required machine token and human acknowledgment.
  Include that token and acknowledgment verbatim in the synthesized PRD body before source routing,
  so the justification survives even when the vendor's metadata renderer does not display this field.
  Other metadata may inform the PRD body; forward the complete payload unchanged without renaming
  or vendor-rendering its fields.

## How to work

Do the work yourself, in this session. Delegate to a subagent only when a piece of work is sizeable and genuinely independent, such as a wide codebase or market investigation — and give it the exact result you need back. Do not delegate work you can finish in a handful of tool calls.


## Flow

Execute the **Research** flow as defined in the `intent-routing` reference rule (read on demand). The rule contains the canonical step sequence (gates, sub-flows, deliverables). This skill does NOT restate flow steps — change them in the rule, propagate everywhere.

## Capture learnings

Before returning, list what this run learned the hard way that a later run in this project would otherwise relearn — a misleading source, a tool or access that was missing, a step that failed and why. Route each through `lisa-persist-learning` with `rule`, `why`, `provenance`, and `triggering_issue` set to the PRD this run created (or the input it was given, when no PRD was created). Its judge drops most candidates; that is expected, and zero candidates is a valid result. Never write the ledger or any rule file directly.

## Output

A PRD **created in the configured PRD source** (per the intent-routing rule's Research flow
definition) structured as: problem statement, high-level solution description, links (if needed),
user stories (each with its own functional/non-functional requirements and, only for stories with
new UI/visual work, a design-file pointer), overall acceptance criteria, open questions, and the
"Recommended Tooling for Plan Phase" section. Requirements MUST conform to the
`prd-definition-of-ready` rule: identified atoms (`R1`, `R2`, …), one behavior each in an
EARS-pattern shape, each with a measurable fit criterion, plus the non-functional checklist. For any
story with frontend scope, its user-facing behavior MUST be expressed as — or in a shape directly
convertible to — Given/When/Then scenarios, naming the platforms each behavior must hold on, per the
`bdd-e2e-coverage` rule; narrative-only frontend behavior forces that shape to be invented later,
inconsistently, by whoever picks up the ticket. Where a requirement introduces or changes
**persistent state** — anything the system writes that outlives the process that wrote it, rows being
only one kind — the PRD MUST name that state and the reset policy it is expected to take, per the
`reset-seed-coverage` rule, so the classification is a stated requirement rather than something
discovered when a leaked record breaks a suite; that rule also covers the non-row cases (identity
objects, object storage, search indexes, queues, caches, derived views) a narrative spec routinely
omits. Each scenario stub carries its originating requirement
atom (`R1`, `R2`, …) even though the stable `@BDD-<DOMAIN>-<NNN>` ID is not minted until Plan or
Implement — this is what lets a later stage's provenance tag, and `spec-conformance`'s traceability
check, walk back from a shipped scenario to the PRD requirement it was written to satisfy, instead of
accepting any scenario with a stable ID as proof of this requirement. The final
flow step invokes `lisa-prd-source-write`, which creates the PRD in the configured `source` (Notion
page in the PRD database, Confluence page under the lifecycle parent, GitHub issue, or Linear
project) in the `draft` role by default or `ready` when `prd_ready=true`. **The PRD lives in the
source — there is no loose document artifact.** Before handing the synthesized PRD to
`lisa-prd-source-write`, record the Research run's direct usage on that artifact through
`lisa-usage-accounting` so the PRD body carries the canonical `## Lisa Usage` ledger from creation
time onward. If the runtime does not expose trustworthy usage, the direct entry must still be
written with `source: unavailable` and nullable token/cost fields rather than silently omitting the
Research row. If the call includes `ideation_ledger_payload`, pass that object through in the
`lisa-prd-source-write` spec unchanged alongside `marker`, `dedupe_key`, and `initial_role`; this is
the vendor-neutral handoff that lets the configured writer render an auditable run ledger without
`research` bypassing source selection. A `source` must be configured; if it is not, stop and report
it rather than emitting a document. The Plan flow consumes the created PRD next.

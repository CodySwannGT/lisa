---
name: jira-source-artifacts
description: "Canonical taxonomy and rules for handling source artifacts (Figma, Lovable, Loom, screenshots, design docs, data samples) when generating or evaluating JIRA tickets. Defines: (1) artifact domains, (2) classification rules per tool, (3) source precedence (which artifact is authoritative for which question), (4) inheritance from epic to story to sub-task, (5) cross-axis conflict handling. Invoke this skill from any flow that extracts, attaches, or reasons about external design/UX/data artifacts so the rules don't drift across skills."
allowed-tools: []
---

# JIRA Source Artifact Taxonomy and Rules

This skill is doctrine, not action — it defines the rules. Skills that need to extract, classify, attach, or reason about external artifacts (design files, prototypes, recordings, data samples) invoke this skill to load the taxonomy and apply it.

The reason this lives in one place: silent drift across skills is the failure mode this body of rules exists to prevent. If the rules differ between `lisa:notion-to-tracker`, `lisa:jira-create`, and `lisa:jira-write-ticket`, agents will silently route artifacts wrong and developers will lose source of truth. Edit here, propagate everywhere.

## 1. Domains

Every artifact is classified into exactly one domain. The domain determines what the artifact is the source of truth for, and which tickets inherit it.

| Domain | What it defines | Examples |
|--------|-----------------|----------|
| `ui-design` (mocks) | **Visual treatment only** — layout, spacing, typography, color, iconography | Figma design frames, Framer static frames, bare screenshots, mockup PNGs |
| `ux-flow` (prototypes) | **Interaction and flow only** — navigation, transitions, state changes, timing, empty/error/loading states | Lovable output, Loom walkthroughs, Figma prototype links, annotated screenshots, Miro/Mural flow diagrams, user journey maps |
| `data` | Request/response shape, schema constraints, contracts | Example JSON, SQL schemas, GraphQL snippets, API contracts, sample payloads |
| `ops` | Deployment / runtime context | Runbooks, dashboards, Terraform refs, deployment diagrams |
| `reference` | Cross-cutting context | Confluence, Notion peer pages, Google Docs, related PRDs, RFCs |

## 2. Classification rules per tool

These rules exist because agents consistently misclassify Figma and Lovable artifacts, which are the two most common sources of dropped or misrouted context.

- **Figma**: classify as `ux-flow` if the URL is a prototype share link — it contains `/proto/`, has `starting-point-node-id=` in the query, or the sharing context labels it "prototype" / "play mode". Otherwise classify as `ui-design`. Never assume; inspect the URL.
- **Figma file with both design frames and a prototype**: emit two entries — one `ui-design` for the file, one `ux-flow` for the prototype URL — so both propagate correctly.
- **Lovable output**: always `ux-flow`. Lovable ships working code, but its code, styling, and any embedded business rules are NOT authoritative. Treat strictly as a UX/flow reference. Implementation uses existing project components; business rules come from the PRD body, not from Lovable.
- **Loom / video walkthrough**: `ux-flow` in the vast majority of cases. The rare exception — a video that's purely a static-frame design review with no interaction — is still `ux-flow` for routing purposes (both UX and UI stories benefit).
- **Screenshot**: bare unannotated screenshot → `ui-design`. Screenshot with arrows between frames, flow labels, or numbered steps → `ux-flow`. Side-by-side gallery of state variants (empty/error/loading) → `ui-design` with the state variants noted.
- **Confluence / Notion peer / Google Doc**: `reference` unless it is specifically a runbook (`ops`) or contains canonical API contracts (`data`).
- **Grafana / Datadog / Sentry**: `ops`.
- **Code blocks with example payloads** (JSON, SQL, GraphQL, cURL): `data`.

When an artifact could plausibly fit multiple domains and the rules above don't disambiguate, err on the side of inclusion — emit it under both, or use the broader domain. Misclassification is caught downstream by the preservation gate; underclassification is silent drop.

## 3. Source precedence

When artifacts disagree, silent reconciliation is a known failure mode. The rules below define which source wins which question. **Record this precedence on every ticket that carries design artifacts** (under Technical Approach or a dedicated `## Source Precedence` subsection) so the implementer doesn't reconcile silently.

| Question | Authoritative source |
|----------|---------------------|
| Does this field exist? Is it required? Who can see/edit it? What validation applies? Permission rules, edge cases, data constraints? | **Description / PRD body** (business rules) |
| What does it look like — layout, spacing, typography, color, iconography? | **Mocks (`ui-design`)** |
| How does it flow — navigation, transitions, state changes, timing, empty/error/loading states? | **Prototypes (`ux-flow`)** |
| Where does the data come from, what shape is it, what are the API contracts? | **`data` artifacts** |
| Where does it run, who's on call, what's the dashboard? | **`ops` artifacts** |

## 4. Cross-axis conflict handling

Conflicts MUST be surfaced under `## Open Questions` on the affected ticket — never silently reconciled.

- Mock shows a field the description doesn't mention → BLOCKER: "Figma shows field `X` not in PRD; confirm it exists, and if so add business rules (required/optional, validation, permissions)."
- Description mandates behavior the prototype contradicts → BLOCKER: "PRD says Y, prototype shows Z; which is correct?"
- Prototype shows a flow the mocks don't cover (e.g., an error state) → Note: "Error state flow from prototype; no mock exists. Use existing error component or request mock."
- Multiple artifacts of the same domain disagree (two Figma links showing different layouts) → BLOCKER: list both, ask which is current.
- Lovable output without a description covering business rules → BLOCKER: "Business rules missing. Lovable's embedded logic is not authoritative; PRD must explicitly state required fields, validation, permissions, and edge cases."

## 5. Coverage smells

Incomplete artifact sets are a common root cause of implementation drift. Surface these on the epic when extracting:

- **Zero artifacts on a non-trivial PRD**: almost always an extraction bug, not a design decision. Say so explicitly.
- **`ux-flow` present, `ui-design` absent**: flag "missing UI mocks". UI will be inferred from prototype frames — note that prototype styling is typically placeholder and must NOT be treated as visual source of truth.
- **`ui-design` present, `ux-flow` absent**: flag "missing UX prototype". UX will be inferred from static mock states (empty/error/loading/hover) — any flow not explicitly depicted must be raised as a BLOCKER with recommendation + alternatives, not silently invented.

## 6. Inheritance: epic → story → sub-task

Artifacts attach as Jira remote links and propagate down the hierarchy.

- **Epic**: gets EVERY artifact, regardless of domain. The epic is the canonical hub — anyone working on the epic or its descendants must reach the full set from one place. No filtering.
- **Story**: inherits the artifacts whose domain matches its scope:

  | Story type | Inherits domains |
  |------------|------------------|
  | Frontend / UI | `ui-design`, `ux-flow`, `reference` |
  | Backend / API / data model | `data`, `reference` |
  | Infrastructure | `ops`, `reference` |
  | Mixed / setup ("X.0") | All domains |

  When classification is ambiguous, err on the side of inclusion — a developer can ignore an extra link, but they can't follow one that wasn't attached.

- **Sub-task**: inherits via the parent story link. Do NOT re-attach the same artifacts on every sub-task — that creates noise. Only attach an artifact directly on a sub-task when the sub-task depends on something the parent story doesn't (e.g., a sub-task spec'd from a specific Figma frame the broader story doesn't cite).

## 7. Existing-component reuse (UI-touching tickets)

Mocks define visual *intent*, not implementation shortcut. Every UI-touching ticket description must include:

> Before implementing, identify the closest existing component in the codebase. Prefer reuse even if the mock specifies different styling — flag the design-vs-code divergence as a discussion item on this ticket rather than pixel-matching from scratch.

If no existing component fits, building a new one is an explicit decision that must be recorded in the ticket (with rationale) before implementation. Lovable-generated components are never the reuse target — always use the project's own components.

## 8. Preservation gate (run after creating tickets)

Before declaring done, verify every extracted artifact is reachable from the created tickets.

1. Build a preservation matrix: `artifact URL → [ticket keys that reference it]`.
2. For every artifact:
   - It MUST appear on the epic it belongs to (no exceptions).
   - It SHOULD appear on at least one story whose scope matches its domain (except `reference`-domain artifacts, which may be epic-only if no story is domain-matched).
3. Any artifact with zero references anywhere, or missing from its epic: FAIL LOUDLY — list the dropped artifacts with domain, title, and source page; surface to the human; re-attach before continuing.
4. If classification looks misrouted (e.g., a Figma link landed on a backend story and nowhere else), surface the misroute and offer to re-propagate.

Skipping this gate is the most common cause of silent artifact loss. Do not skip it.

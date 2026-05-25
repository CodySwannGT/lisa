---
name: project-ideation
description: "Generate practical, verifiable product ideas for the current host project FROM EVIDENCE-DERIVED PERSONAS, then turn the selected build-ready ideas into real PRDs via lisa:research. First derives the personas the project actually serves by mining its docs, code, data model, and releases (never invented — each persona cites its evidence), then ideates per persona. Every build-ready idea must pass a practicality gate (an obtainable data/source path) and an empirical verification gate (a user-observable outcome the agent can verify). Selected ideas are handed to lisa:research, which creates each PRD in the configured source (Notion / Confluence / GitHub / Linear) — in the draft state by default, or prd-ready (auto-picked-up by lisa:intake) when prd_ready=true. Defaults to creating one PRD (the top-ranked idea); max_prds widens the batch. Invoke for 'generate feature ideas for this project', 'what should we build next for <persona>?', 'looking at <external product>, what should we add here?'. Vendor- and stack-agnostic."
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep", "WebFetch", "WebSearch"]
---

# Project Ideation

Generate persona-grounded, verifiable ideas for the host project in `$ARGUMENTS` (or the current
working directory), then create PRDs for the selected build-ready ideas via `lisa:research`.

The value of this skill is **grounding + filtering**, not brainstorm volume. Ideas come from
personas the project demonstrably serves, and an idea you cannot ground in obtainable data and
cannot verify yourself is noise — demote it honestly.

## Parameters

- **`target`** (first positional, optional) — a target project path, or an external product/site to
  draw inspiration from. Defaults to the current working directory.
- **`prd_ready=true|false`** (default **false**) — the PRD-lifecycle state for the PRDs this run
  creates. `false` → created in the source's **draft** state for human review. `true` → created
  **prd-ready** so the PRD side of `lisa:intake` auto-claims them. Passed straight through to
  `lisa:research` (which maps it to `lisa:prd-source-write`'s `initial_role`).
- **`max_prds=<n>|all`** (default **1**) — how many build-ready ideas become PRDs this run. Default
  creates **one** PRD (the single top-ranked idea), because `lisa:research` is a heavy full flow.
  `max_prds=3` creates the top three; `max_prds=all` creates one per build-ready idea. Discovery
  Spikes and Rejected ideas are never turned into PRDs regardless of `max_prds`.

## When to use

- "generate feature ideas for this project" / "what should this app do next?"
- "what should we build next for <persona / user type>?"
- "looking at <external product / website>, what should we add here?"
- "suggest practical improvements we can verify ourselves"

This skill **does** create PRDs (via `lisa:research`) for the selected ideas. It does **not** create
tracker tickets (that is `lisa:plan`) and does **not** change code (that is `lisa:implement`).

## Two gates every build-ready idea must pass

An idea may only become a **Practical Idea** (and thus a PRD candidate) if it passes BOTH gates.
Otherwise demote it.

1. **Practicality gate.** The project can plausibly implement the idea from sources that actually
   exist: existing code, a data model, a route/command/UI surface, a public or integrated API, a
   scrapeable public page, an existing user input, a local database, or documented integrations. Name
   the specific source and how the data is obtained. "We could probably get the data somehow" fails.
2. **Empirical verification gate.** You can personally confirm the resulting behavior by using the
   software (running the CLI, hitting the API, loading the page, querying the DB, inspecting an
   artifact) and capture a concrete evidence artifact. "Tests could be written later" does NOT
   satisfy this gate — quality gates are prerequisites, never proof an idea works.

Failing the practicality gate → **Rejected / Not Practical Yet** (or **Discovery Spike** if a bounded
probe could make it practical), naming the missing data/source/access. Failing only the verification
gate → **Discovery Spike** (define the missing proof), never a build-ready recommendation.

## Step 1 — Establish host-project context (always first)

Never propose ideas before you understand what exists. Inspect the host project and record:

- **Project type and package manager** — manifests (`package.json`, `pyproject.toml`, `go.mod`,
  `Cargo.toml`, `Gemfile`, …) and any `.lisa.config.json`.
- **Docs and specs** — `README`, `docs/`, `wiki/`, architecture notes, ADRs, marketing/landing copy.
- **Current product surfaces or commands** — routes, screens, CLI subcommands, API endpoints,
  scheduled jobs, generated artifacts.
- **Data model and existing user inputs** — schemas, migrations, forms, config the user supplies.
- **Available data sources and ingestion/scraping paths** — integrated APIs, public datasets,
  scrapeable pages, local databases, event streams.
- **Existing verification tooling** — how a human currently observes the software works.

Use Lisa's existing methodology rather than inventing a parallel flow. Route each evidence source
through the matching established practice before any idea is promoted to **Practical Ideas**:

- **Host-code inspection** uses `/lisa:codebase-research` concepts: trace data flow from entry point
  to output, identify modification points, map dependencies, and find reusable code or patterns.
- **Public, no-login comparison** uses web/browser research when those tools are available: inspect
  the public surface, preserve source URLs, and separate observed behavior from inference.
- **UI-facing recommendations** use `/lisa:product-walkthrough` methodology first: inspect the
  current product surface, note existing-component reuse candidates, capture coverage smells or
  behavioral surprises, and only then list a UI idea as build-ready.

## Step 2 — Derive the personas (evidence-gated, never invented)

Ideation is **persona-driven**, and the personas must be gleaned from the project itself — not
assumed. Mine the Step 1 evidence for who the project actually serves:

- **Docs / README / release notes / CHANGELOG** — stated audiences, "for <role>" framing, who each
  shipped feature was for.
- **Code** — auth roles / RBAC / permission checks, account-type or user-type enums, route guards,
  feature flags scoped to a cohort, role-specific UI branches.
- **Data model** — user / role / tenant / org tables, profile fields, subscription tiers.
- **Tests & product walkthrough** — the real user journeys exercised.
- **External inspiration** (Step 3, if used) — comparable products' user segments, as inspiration
  only.

Anti-fabrication rule (mechanical): **no evidence citation → no persona.** Generic roles
("admin", "analyst", "end user", "power user") are **banned unless the project has specific evidence
for them**. Each persona requires at least **two grounded signals** from different source classes
where available; if only one strong signal exists, emit a single **low-confidence "Primary
documented user"** persona named as such — never fabricate a full set from thin evidence.

Cap the set at **3–6 personas** (merge adjacent personas by goal/workflow; more than six is taxonomy
noise). Each persona records:

- `name` — concrete and project-specific.
- `goals` — what this persona is trying to accomplish.
- `pains` — current friction for this persona, grounded in observed behavior/gaps.
- `evidence` — the specific files / doc sections / tables / releases that justify the persona.
- `confidence` — high | medium | low, with the reason.

Always emit a **Personas Derived From Evidence** section, even when no PRDs are created. Spikes and
rejected ideas are still tagged with the persona they would serve (or `cross-persona`).

## Step 3 — Optional external / public-source inspection

Only when the user references an external product, website, public dataset, or competitor:

- Inspect **public, no-login** surfaces only. Preserve every **source URL** so informed ideas cite
  it. The external source is **inspiration, not a domain you bake in** — keep the workflow reusable.
- If the runtime has no browser/web capability, mark that source **unavailable** and proceed with
  host-project-only ideas (document the fallback rather than fabricating findings).

## Step 4 — Ideate per persona, then filter through the gates

For each derived persona, brainstorm ideas that serve that persona's goals/pains, **tag each idea
with the persona(s) it serves**, then run every idea through BOTH gates. For each surviving idea,
build a **feasibility card**:

- **Persona(s) served** — which derived persona(s), and why this matters to them.
- **Existing fit** — the current route / API / CLI / model / doc / surface it builds on (this is also
  the idea's stable "existing-fit anchor" used in the dedupe key).
- **Data/source required** + **how it is obtained** — the concrete accessible path.
- **Known source limitations** — rate limits, robots/ToS, staleness, missing fields.
- **Smallest practical slice** — the minimal useful version.
- **Empirical verification steps** — what you (the agent) will do against the running software.
- **Evidence artifact** — the screenshot, curl/CLI output, DB row, or generated file the verifier
  captures.
- **Confidence** — high | medium | low, with the reason.

## Step 5 — Rank and select the PRD creation set

Rank Practical Ideas by **persona value, feasibility, verification clarity, and project fit**. Then
select the creation set by `max_prds` (default **1** → the single top-ranked idea; `<n>` → top n;
`all` → every Practical Idea). Spikes and Rejected ideas are reported but never selected.

## Step 6 — Create a PRD per selected idea (via lisa:research)

For each idea in the creation set, invoke `/lisa:research` with:

- the feasibility card and persona evidence as the problem statement (so the PRD inherits the
  grounding and the empirical verification plan),
- `prd_ready` (this run's flag — `lisa:research` maps it to draft vs prd-ready),
- a stable **dedupe marker** (see below) so a re-run references the existing PRD instead of creating
  a duplicate.

`lisa:research` synthesizes the PRD and creates it in the configured source via
`lisa:prd-source-write`. `project-ideation` never writes to the source directly — it delegates, so
the PRD source stays switchable per project. Capture each returned PRD ref / URL / role / outcome.

### Dedupe marker (stable, never title-based)

Each created PRD carries the marker `[lisa-project-ideation] idea=<stable-key>`. Compute
`<stable-key>` deterministically from: repo identity (configured repo or git remote + repo-root
basename) + a normalized slug of the idea name + the normalized persona key(s) + the existing-fit
anchor. **Do not** include rank, date, confidence, or the generated PRD title (they change across
runs). `lisa:prd-source-write` searches the source for an open PRD carrying this marker before
creating — matching by marker, never by title — so re-running ideation updates/references the
existing PRD rather than duplicating it.

## Step 7 — Output (no report file)

Emit two distinct in-session sections (do not write a report file):

1. **Idea report** (the audit trail):
   ```markdown
   ## Personas Derived From Evidence
   - <name> — goals; pains; evidence (files/docs/tables/releases); confidence

   ## What Already Exists
   - <current surfaces, data, commands, workflows — so duplicates aren't re-proposed>

   ## Practical Ideas
   ### 1. <Idea name>  (persona: <persona(s)>)
   - Persona value · Existing fit · Data/source path · Practical slice · Empirical verification ·
     Evidence · Confidence

   ## Discovery Spikes
   - <ideas needing proof of data/access/verification — name the missing proof — tagged by persona>

   ## Rejected / Not Practical Yet
   - <attractive ideas rejected for missing data/access/legality/verification — name what's missing>
   ```
2. **PRDs Created** (the creation summary): for each selected idea — the created/reused PRD ref +
   URL, its lifecycle role (`draft` or `ready`), its dedupe marker, and `created | reused`. List the
   Practical Ideas that were **not** created this run and why (e.g. "below the `max_prds=1` cut").

Always include the **Personas**, **What Already Exists**, **Discovery Spikes**, and **Rejected**
sections (even if empty) so the user sees what was considered and filtered out.

## Out of scope (hard rules)

- **No fabricated personas.** No evidence citation → no persona; generic roles banned without
  evidence (Step 2).
- **No sign-in-only ideas** unless the host project already supports sign-in *and* credentials are
  available. **No private-data assumptions.** **No manual-data-only** requirements unless the user
  accepts manual curation. **No paid-API / non-scrapeable-source ideas** in the build-ready list —
  demote with the blocker named.
- **Tests, lint, typecheck, and build are not the empirical verification plan** — they are
  prerequisites; verification must observe user-facing behavior.
- **Do not create tracker tickets or mutate the host project's code.** PRD creation (via
  `lisa:research`) is the only write this skill performs; ticket planning (`lisa:plan`) and
  implementation (`lisa:implement`) are separate, user-invoked flows.
- **Do not write PRDs to the source directly** — always go through `lisa:research` →
  `lisa:prd-source-write` so the source stays switchable.
- **Do not add a new verification/browser-automation framework** when one already exists — reuse it.
- **Do not overfit to a source example.** Keep the workflow project-agnostic.

## Handing off

The created PRDs flow straight into the lifecycle:

- A `draft` PRD → a human reviews it, then promotes it to `ready` (or re-run with `prd_ready=true`).
- A `prd-ready` PRD → `/lisa:intake` (PRD side) auto-claims it → `/lisa:plan` decomposes it →
  `/lisa:implement` builds each item → `/lisa:codify-verification` locks in the verification.

## Example outputs

Use the markdown examples in `examples/` as shape references for the idea report:

- `host-project-only.md` — ideas grounded only in the current repository.
- `public-external-inspiration.md` — public, no-login external sources as inspiration, not hidden
  requirements.
- `unavailable-data-rejection.md` — naming missing private/paid/unavailable sources when demoting.
- `evidence-card-format.md` — the required evidence fields every Practical Idea card must carry.

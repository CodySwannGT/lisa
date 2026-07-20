---
name: lisa-project-ideation
description: "Generate practical, verifiable product ideas for the current host project FROM EVIDENCE-DERIVED PERSONAS, then turn the selected build-ready ideas into real PRDs via lisa-research. First derives the personas the project actually serves by mining its docs, code, data model, and releases (never invented — each persona cites its evidence), then ideates per persona. Every build-ready idea must pass a practicality gate (an obtainable data/source path) and an empirical verification gate (a user-observable outcome the agent can verify). Selected ideas are handed to lisa-research, which creates each PRD in the configured source (Notion / Confluence / GitHub / Linear) — in the draft state by default, or prd-ready (auto-picked-up by lisa-intake) when prd_ready=true. Defaults to creating one PRD (the top-ranked idea); max_prds widens the batch. Invoke for 'generate feature ideas for this project', 'what should we build next for <persona>?', 'looking at <external product>, what should we add here?'."
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep", "WebFetch", "WebSearch"]
---

# Project Ideation

Generate persona-grounded, verifiable ideas for the host project in `$ARGUMENTS` (or the current
working directory), then create PRDs for the selected build-ready ideas via `lisa-research`.

The value of this skill is **grounding + filtering**, not brainstorm volume. Ideas come from
personas the project demonstrably serves, and an idea you cannot ground in obtainable data and
cannot verify yourself is noise — demote it honestly.

## Parameters

- **`target`** (first positional, optional) — a target project path, or an external product/site to
  draw inspiration from. Defaults to the current working directory.
- **`prd_ready=true|false`** (default **false**) — the PRD-lifecycle state for the PRDs this run
  creates. `false` → created in the source's **draft** state for human review. `true` → created
  **prd-ready** so the PRD side of `lisa-intake` auto-claims them. Passed straight through to
  `lisa-research` (which maps it to `lisa-prd-source-write`'s `initial_role`) only after the PRD queue
  pressure gate allows auto-ready writes.
- **`max_prds=<n>|all`** (default **1**) — how many build-ready ideas become PRDs this run. Default
  creates **one** PRD (the single top-ranked idea), because `lisa-research` is a heavy full flow.
  `max_prds=3` creates the top three; `max_prds=all` creates one per build-ready idea. Discovery
  Spikes and Rejected ideas are never turned into PRDs regardless of `max_prds`.
- **`fixture=<path>`** (optional, verification-only) — a deterministic host-project fixture used
  for idempotency verification. When present, read the fixture before ranking and honor its declared
  single persona, single idea, existing-fit anchor, and expected dedupe marker. Do not use this
  parameter for normal ideation runs.

## When to use

- "generate feature ideas for this project" / "what should this app do next?"
- "what should we build next for <persona / user type>?"
- "looking at <external product / website>, what should we add here?"
- "suggest practical improvements we can verify ourselves"

This skill **does** create PRDs (via `lisa-research`) for the selected ideas. It does **not** create
tracker tickets (that is `lisa-plan`) and does **not** change code (that is `lisa-implement`).

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

## Step 5.5 — Block auto-ready writes when the PRD queue has pressure

This step runs **only** when `prd_ready=true`. A draft run (`prd_ready=false`) skips this gate and
continues to Step 6, because draft PRDs do not create immediate PRD-intake pickup pressure.

Before invoking `lisa-research` for any selected idea, inspect the configured PRD source queue with
the same PRD reader contract used by `/lisa:queue-status` and evaluate it with
`evaluatePrdQueuePressure` from `plugins/lisa/scripts/queue-status-prd-readers.mjs` (source:
`plugins/src/base/scripts/queue-status-prd-readers.mjs`). Resolve the queue from `.lisa.config.json`
the same way `lisa-intake` resolves the PRD side, and pass the matching queue argument in the
blocked outcome (for example, `github intake_mode=prd`).

Queue pressure is any unresolved PRD lifecycle work that would make another auto-ready PRD compete
with existing intake work. Treat at least these roles as pressure when the helper reports them:
`prd-ready`, `prd-in-review`, `prd-blocked`, unresolved `prd-ticketed`, and source-reader failures or
misconfiguration snapshots. `prd-shipped` / `prd-verified` terminal history is not pressure unless the
reader helper explicitly reports it as unresolved.

If the helper returns `allowed: false`, stop before any `lisa-research`, `lisa-prd-source-write`, or
vendor PRD writer invocation. Emit **PRDs Created** as a blocked outcome, not as an empty success or a
silent idle run. The blocked outcome must include:

- `source` and `tracker` from `.lisa.config.json`;
- the decisive PRD lifecycle `role`;
- the blocking PRD item `ref` and `url`, when the snapshot supplies them;
- the smallest next action, preferring the helper's `nextStep` and otherwise using
  `/lisa:intake <PRD queue>`;
- a clear statement that no research or PRD source write was invoked.

Use this output shape so recurring automations can surface a useful next step without digging through
debug logs:

```text
## PRDs Created

Blocked: PRD queue pressure prevents auto-ready creation.
- source: <source>
- tracker: <tracker>
- role: <decisive role>
- item: <ref or "unavailable"> <url when available>
- next action: <helper nextStep or /lisa:intake <PRD queue>>
- write invoked: no
```

If the helper returns `allowed: true`, continue to Step 6 normally and keep the existing draft/ready
creation behavior unchanged.

## Step 6 — Create a PRD per selected idea (via lisa-research)

For each idea in the creation set, invoke `/lisa:research` with:

- the feasibility card and persona evidence as the problem statement (so the PRD inherits the
  grounding and the empirical verification plan),
- `prd_ready` (this run's flag — `lisa-research` maps it to draft vs prd-ready),
- a stable **dedupe marker** (see below) so a re-run references the existing PRD instead of creating
  a duplicate,
- a structured `ideation_ledger_payload` handoff containing the selected marker, automation id and
  memory path when available, persona names, persona evidence references, rejected overlap
  candidates, repo identity, `prd_ready`, selected idea title/key, and the expected empirical
  verification artifact. This payload is the only ideation-run metadata channel between
  `project-ideation`, `research`, `prd-source-write`, and the vendor writer; keep GitHub-specific
  rendering out of this skill.

`lisa-research` synthesizes the PRD and creates it in the configured source via
`lisa-prd-source-write`. `project-ideation` never writes to the source directly — it delegates, so
the PRD source stays switchable per project. Capture each returned PRD ref / URL / role / outcome.

### Optional Codex automation memory

When the run has a Codex automation id or memory path, maintain a concise local advisory ledger after
the PRD source write returns. Resolve the memory path in this order:

1. explicit `memory_file=<path>` or `automation_memory=<path>` argument, when supplied;
2. `$CODEX_AUTOMATION_MEMORY`, when set;
3. `$CODEX_HOME/automations/<automation_id>/memory.md`, when `automation_id=<id>` or
   `$CODEX_AUTOMATION_ID` is available.

Create the parent directory and `memory.md` if missing. Write one concise run entry keyed by the
dedupe marker and run timestamp. The entry must include the marker, PRD URL/ref, outcome
(`created | reused | updated | blocked`), lifecycle role (`draft | ready | blocked` or the returned
source role), and `source_agreement` (`github-source-wins`, `memory-created`, `memory-updated`, or
`memory-missing-runtime`). If memory says one thing but the PRD source search finds a matching open
PRD, GitHub/source truth wins: reuse the source PRD and update memory rather than creating a
duplicate. Keep memory advisory only; never use it to override lifecycle labels, source marker
matches, or the PRD source writer's returned role. Do not store secrets, tokens, full PRD bodies, or
private source excerpts in memory.

### Dedupe marker (stable, never title-based)

Each created PRD carries the marker `[lisa-project-ideation] idea=<stable-key>`. Compute
`<stable-key>` deterministically from: repo identity (configured repo or git remote + repo-root
basename) + a normalized slug of the idea name + the normalized persona key(s) + the existing-fit
anchor. **Do not** include rank, date, confidence, or the generated PRD title (they change across
runs). `lisa-prd-source-write` searches the source for a PRD carrying this marker before
creating — matching by marker, never by title — so re-running ideation updates/references the
existing PRD rather than duplicating it.

Per the `rejection-detection` rule's **Proposal rejection memory** section, that marker search MUST
cover **open AND closed** PRDs (with a body-enumeration fallback on search-index lag), and a PRD
**closed as _not planned_** (GitHub `stateReason == "not_planned"`; the config-resolved won't-do/
canceled equivalent on JIRA/Linear — never a hardcoded lane string) is a **durable human decline**
that **suppresses** re-proposing that idea. Re-propose only with evidence that **postdates the
decline**, and state it in the new PRD as BOTH the machine token (`declined <date>; recurred <date>
in <ref>`) and a human acknowledgment sentence (`You declined this on <date>. It has recurred
(<date>, <ref>), so we're raising it once more for your review.`). A PRD closed as _completed_ is
not a decline. This is tracker-side memory; the advisory ideation memory ledger stays advisory and
never overrides it.

Every created PRD MUST carry the `rejection-detection` **operator footer** as a visible prose line
so the operator knows which close-reason silences it:

> To stop this from being raised again, close it as **Not planned**. Close it as **Completed** if it was fixed — a later recurrence may be re-filed as a regression.

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

## Run outcome

As the registered `exploratory-prds` automation loop, this run conforms to the
`automation-runbook-contract` rule: it ends in **exactly one** of the six run outcomes and records it,
so a quiet ideation run and a broken one are never confused.

| This run's exit path | Run outcome |
|---|---|
| PRD(s) created or reused this run (Step 6/7 **PRDs Created**) | `candidate-proposed` |
| Nothing to ideate — no Practical Idea cleared the bar; nothing created — **or** every idea was suppressed by a prior decline (`rejection-detection` **Proposal rejection memory**): the summary MUST name the suppression count | `nothing-needed` |
| The Step 5.5 **PRD-queue-pressure gate** blocked auto-ready creation — a human must drain the queue before another auto-ready PRD is added | `approval-requested` |
| The loop itself could not run — the PRD source reader failed or the queue is misconfigured (a source-reader failure snapshot, not queue pressure) — **or** the open-and-closed rejection-memory marker search could not read the source: a memory check that could not run is a broken loop, never a silent `nothing-needed` | `recovery-required` |
| The runbook's **Retirement condition** tripped — the trailing quiet window is empty AND this run proposed nothing AND no unresolved PRD pressure exists while no new surface has shipped — this row supersedes the `nothing-needed` row when it applies | `policy-obsolete` |
| A degradation that still let ideation run (optional Codex automation memory unavailable, an inspiration source unreachable) | the outcome it actually reached above, with the summary **leading with the degradation** — degradation never mints a seventh token |

The pressure gate is `approval-requested`, **not** `recovery-required`: the loop ran fine and
correctly declined to add queue pressure — it is asking a human to drain the queue, not reporting a
broken machine. `recovery-required` is reserved for the loop failing to run at all.

Before invoking the run-record CLI, evaluate the **Retirement condition** first. If it applies,
select `policy-obsolete` as the sole outcome and do not record a prior `nothing-needed` result;
otherwise select the ordinary outcome from the table.

Record **exactly one** outcome per invocation through the run-record CLI, naming this loop's runbook
(the `--summary` is the operator-readable one-liner in the contract's exemplar voice — plain,
specific, actionable, e.g. `Reviewed evidence; no practical idea cleared the bar — nothing to
propose.` for `nothing-needed`; and for a `recovery-required` from an unreadable decline check,
`Tracker unreachable during the decline check — restore credentials; nothing was filed this run.`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/automation-run-record.mjs" \
  --loop-id exploratory-prds --outcome candidate-proposed \
  --summary "Created PRD #1810 for offline export; awaiting your flip to ready." \
  --runbook .lisa/automations/exploratory-prds.runbook.md [--ref <prd-url>]...
```

If `${CLAUDE_PLUGIN_ROOT}` is unset, resolve the plugin scripts directory directly — the built copy
`plugins/lisa/scripts/automation-run-record.mjs` or the source
`plugins/src/base/scripts/automation-run-record.mjs`. If recording still fails, **degrade, never
abort** (per `automation-runbook-contract`): note the recording failure in the run output and finish
the run — a recording failure is a degradation to report, never a reason to block the loop.

**Retirement evaluation (every run).** Evaluate this loop's runbook **Retirement condition** on
every run, exactly as the `automation-runbook-contract` rule's Retirement section defines it — this
skill conforms to that text and never restates or diverges from it. On top of the contract's two
conditions the runbook seeds a third **domain conjunct** — no unresolved PRD pressure exists and the
project has shipped no new surface to ideate against — which only tightens the test and never
replaces it: a quiet month because the queue was full is the loop working, not the loop being
obsolete. Evaluate all three. When all three hold, record `policy-obsolete` and file **exactly ONE**
marker-deduped teardown proposal through `lisa-tracker-write` (per `tracked-work` +
`integration-access-layer`):

- **Marker** `<!-- [lisa-automation-retire] key=exploratory-prds -->` plus a visible prose line;
  matched on the marker, never the title; searched **open AND closed** per `rejection-detection`'s
  **Proposal rejection memory**. Treat matches by close state: **open** suppresses another proposal;
  **Not planned** suppresses another proposal unless new evidence postdates the rejection;
  **Completed** means the prior approved action happened, so a later recurrence may be re-filed.
  When an existing proposal suppresses filing, **the run still records `policy-obsolete` and files
  nothing** — the outcome describes this run, while the ticket is filed exactly once.
- **Labels** `status:blocked` + `human-needed`, carrying the contract's decision-ready packet. The
  `human-needed` label marks the proposal human-owned: `lisa-repair-intake` recognizes it and never
  re-dispatches it as stalled work.
- **Evidence** the date-filtered search result, this run's summary, **the loop's current cadence**
  (the baseline an operator needs to choose a longer one), and a one-line summary of recent runs
  read from `.lisa/automations/runs/exploratory-prds.jsonl`. Fill the rest of the packet the same
  way every time: *Work already attempted* is the searches this run ran, and *Risk of inaction* is
  that the loop keeps consuming schedule slots and tokens for nothing.
- **How to answer** names the three operator responses: **approve** — run
  `/lisa:tear-down-automations exploratory-prds` and only that loop registration goes away;
  **decline** — close the proposal as
  **Not planned** (closing it as **Completed** leaves a later re-file open) and the loop simply
  continues; **re-cadence** — pick a longer cadence off that evidence and re-register with
  `/lisa:setup-automations` instead of tearing down.
- **Operator footer**, verbatim, as on every loop-filed proposal (`rejection-detection`):
  > To stop this from being raised again, close it as **Not planned**. Close it as **Completed** if it was fixed — a later recurrence may be re-filed as a regression.

The loop **keeps running at its normal cadence** until a human acts, and never deletes its own
registration.

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
  `lisa-research`) is the only normal write this skill performs; the only tracker-ticket exception is
  the exactly-one marker-deduped `policy-obsolete` teardown proposal described above. Ticket planning
  (`lisa-plan`) and implementation (`lisa-implement`) are separate, user-invoked flows.
- **Do not write PRDs to the source directly** — always go through `lisa-research` →
  `lisa-prd-source-write` so the source stays switchable.
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
- `idempotency-verification-harness.md` — deterministic fixture and script procedure proving that
  repeated `prd_ready=true` ideation keeps the open GitHub marker count at one, including the
  missing-memory rerun variant.

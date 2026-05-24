---
name: project-ideation
description: "Generate practical, verifiable product or workflow ideas for the current host project. Inspects the host project (code, docs, scripts, data sources, current surfaces), optionally compares against external public products, and returns a prioritized idea report. Every build-ready idea must pass a practicality gate (an obtainable data/source path the project can plausibly implement) and an empirical verification gate (a user-observable outcome the agent can verify itself). Ideas that fail either gate are demoted to Discovery Spikes or Rejected / Not Practical Yet. Invoke for prompts like 'generate feature ideas for this project', 'looking at <external product>, what should we add here?', 'suggest practical improvements we can verify ourselves', or 'what should this app do next given the data we can get?'. Vendor- and stack-agnostic: works for web apps, APIs, CLIs, wiki systems, data pipelines, and internal tools. Does not create tickets or mutate the project — it produces a decision-ready report the user can later hand to a Research, Plan, or Implement flow."
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep", "WebFetch", "WebSearch"]
---

# Project Ideation

Produce a decision-ready idea report for the host project described in `$ARGUMENTS` (or the current working directory if no target is given). The report separates ideas that are **build-ready now** from ideas that need a **discovery spike** and ideas that are **rejected / not practical yet**.

The value of this skill is **filtering**, not brainstorming volume. An attractive idea you cannot ground in obtainable data and cannot verify yourself is not a recommendation — it is noise. Demote it honestly.

## When to use

Trigger this skill on prompts such as:

- "generate feature ideas for this project"
- "looking at <external product / website>, what should we add here?"
- "suggest practical improvements we can verify ourselves"
- "what should this app do next given the data we can get?"
- "what high-value features could we add to <repo>?"

Do **not** use this skill to create tickets, write a PRD, or change code. It stops at a report. The user can then ask Lisa to turn one or more ideas into a PRD (`/lisa:research`), a plan (`/lisa:plan`), or an implementation (`/lisa:implement`).

## Two gates every build-ready idea must pass

An idea may only appear under **Practical Ideas** if it passes BOTH gates. Otherwise demote it.

1. **Practicality gate.** The project can plausibly implement the idea from sources that are actually available: existing code, an existing data model, a route/command/UI surface, a public or already-integrated API, a scrapeable public page, an existing user input, a local database, or documented integrations. You must be able to name the specific source and how the data is obtained. "We could probably get the data somehow" fails the gate.
2. **Empirical verification gate.** You can personally confirm the resulting behavior by using the software or workflow — running the CLI, hitting the API, loading the page, querying the database, or inspecting a generated artifact — and capture a concrete evidence artifact. Saying "tests could be written later" does **not** satisfy this gate. Quality gates (tests, lint, typecheck, build) are prerequisites, never proof that an idea works.

If an idea fails the practicality gate → it goes under **Rejected / Not Practical Yet** (or **Discovery Spikes** if a bounded probe could make it practical), with the missing data/source/access named explicitly.

If an idea fails only the empirical verification gate → it goes under **Discovery Spikes** (define the missing proof) or stays as a strategic note, never as a build-ready recommendation.

## Step 1 — Establish host-project context (always first)

Never propose ideas before you understand what exists. Inspect the host project and record:

- **Project type and package manager** — read the manifests (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`, etc.) and any `.lisa.config.json`.
- **Docs and specs** — `README`, `docs/`, `wiki/`, architecture notes, ADRs.
- **Current product surfaces or commands** — routes, screens, CLI subcommands, API endpoints, scheduled jobs, generated artifacts.
- **Data model and existing user inputs** — schemas, migrations, forms, config the user already supplies.
- **Available data sources and ingestion/scraping paths** — integrated APIs, public datasets, scrapeable public pages, local databases, event streams.
- **Existing verification tooling and empirical paths** — how a human currently observes that the software works (a local dev server, a CLI you can run, a seedable DB, a dry-run mode).

Use Lisa's existing methodology rather than inventing a parallel flow. Read the host code through the same lens as `/lisa:codebase-research` (trace data flow, find reusable code, identify modification points). When the request references an external product, use web/browser research; when the ideas would touch a live UI, use `/lisa:product-walkthrough` to ground the analysis in what exists today.

## Step 2 — Optional external / public-source inspection

Only when the user references an external product, website, public dataset, competitor, or example:

- Inspect **public, no-login** surfaces only. Do not assume sign-in, credentials, or paid access.
- Preserve every **source URL** you used so each informed idea can cite it.
- If the runtime has no browser or web capability, mark that research source as **unavailable** and proceed with host-project-only ideas (document the fallback rather than fabricating findings).

The external source is **inspiration, not a domain you bake in**. Keep the workflow reusable across any Lisa-managed repository.

## Step 3 — Generate ideas, then filter through the gates

Brainstorm broadly, then run every idea through both gates from the top of this skill. For each surviving idea, build a **feasibility card** containing at least:

- **User/persona value** — why the host project's user would care.
- **Existing fit** — the current route / API / CLI / model / doc / surface it builds on.
- **Data/source required** — the specific data the idea consumes.
- **How the data can be obtained or scraped** — the concrete accessible path (endpoint, query, public page, existing input).
- **Known source limitations or terms constraints** — rate limits, robots/ToS, staleness, missing fields.
- **Smallest practical implementation slice** — the minimal useful version.
- **Empirical verification steps** — what you (the agent) will do against the running app / API / CLI / DB / artifact to confirm it works.
- **Evidence artifact** — the screenshot, curl output, CLI output, DB row, or generated file the verifier captures.
- **Confidence** — high | medium | low, with the reason.

## Step 4 — Rank and assemble the report

Rank build-ready ideas by **user value, feasibility, verification clarity, and project fit**. Emit the report in this shape:

```markdown
## What Already Exists
- <current surfaces, data, commands, or workflows discovered — so duplicates are not re-proposed>

## Practical Ideas
### 1. <Idea name>
- User value: <why the host project's user would care>
- Existing fit: <current route/API/CLI/model/doc/surface it builds on>
- Data/source path: <specific accessible source or scrape/API path>
- Practical slice: <smallest useful version>
- Empirical verification: <steps the agent can perform against the running software>
- Evidence: <screenshot, curl output, CLI output, DB row, generated file, etc.>
- Confidence: high|medium|low with reason

## Discovery Spikes
- <ideas that need proof of data, access, or verification before they can be build-ready — name the missing proof>

## Rejected / Not Practical Yet
- <attractive ideas rejected because data, access, legality, or verification is not available — name what is missing>
```

Always include the **What Already Exists** section so the user can tell genuinely new ideas from duplicates, and so the report records existing capabilities. Always include both the **Discovery Spikes** and **Rejected / Not Practical Yet** sections (even if empty) so the user can see what was deliberately filtered out and why.

## Out of scope (hard rules)

- **No sign-in-only ideas** unless the host project already supports sign-in *and* credentials are available.
- **No private-data assumptions** — do not premise an idea on data the project cannot legitimately obtain.
- **No manual-data-only requirements** unless the user explicitly accepts manual curation.
- **No paid-API or non-scrapeable-source ideas** in the build-ready list — demote them with the blocker named.
- **Tests, lint, typecheck, and build are not the empirical verification plan.** They are prerequisites; the verification plan must observe user-facing behavior.
- **Do not auto-create tracker tickets or mutate the host project.** Produce the report only; planning and implementation are separate, user-invoked flows.
- **Do not add a new verification or browser-automation framework** when the host project already has one — reuse it.
- **Do not overfit to a source example.** Keep the workflow project-agnostic and reusable.

## Handing off

When the user wants to act on an idea, preserve its feasibility and verification card as the source artifact so downstream flows inherit the evidence:

- Turn an idea into a PRD → `/lisa:research`
- Turn a PRD into tickets → `/lisa:plan`
- Build a ticket end-to-end → `/lisa:implement`
- Lock in the verification so it never regresses → `/lisa:codify-verification`

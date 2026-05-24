---
name: project-ideation
description: Generate practical, verifiable product or workflow ideas for the current host project by grounding recommendations in available code, data sources, public evidence, and empirical verification paths.
---

# Project Ideation

Use this skill when the user asks for practical feature ideas, product improvements, workflow ideas, or a comparison against an external product or public source. The goal is a decision-ready idea report, not tickets or implementation.

## Required Workflow

1. Identify the host project context before proposing ideas:
   - project type, package manager, scripts, and relevant manifests;
   - important docs, README files, and existing issue or PRD context;
   - current user-facing surfaces, APIs, commands, jobs, data pipelines, or wiki workflows;
   - available data sources, ingestion paths, scraping paths, local fixtures, or documented integrations;
   - verification tooling plus empirical verification paths the agent can personally run.
2. When the prompt references an external product, website, dataset, competitor, or public example, inspect only public or no-login surfaces unless the user provides credentials or explicit access. Preserve source URLs or observed public surfaces in the output.
3. When ideas affect an existing UI or user journey, run or request the Lisa product-walkthrough methodology before recommending UI changes. If the current product cannot be run, say what evidence is missing and keep UI ideas as discovery until verified.
4. Filter ideas through both gates before presenting them as build-ready:
   - Practicality gate: the host project can plausibly implement the idea from available code, APIs, public data, scrapeable sources, existing user inputs, documented integrations, or explicitly accepted manual curation.
   - Empirical verification gate: the resulting behavior can be verified by using the software or source workflow directly. Tests, lint, typecheck, and build are prerequisites, not proof that the idea works.
5. Move ideas that fail either gate to `Discovery Spikes` or `Rejected / Not Practical Yet`. Do not list unavailable-data or unverifiable ideas as practical recommendations.

## Output Contract

Return this structure:

```markdown
## What Already Exists
- <current surfaces, data, commands, or workflows discovered>

## Practical Ideas
### 1. <Idea name>
- User value: <why the host project's user would care>
- Existing fit: <current route/API/CLI/model/doc/surface it builds on>
- Data/source path: <specific accessible source, API, scrape path, local file, or user input>
- Source limitations: <known access, legality, freshness, or terms constraints>
- Practical slice: <smallest useful implementation>
- Empirical verification: <steps the agent can perform directly>
- Evidence: <screenshot, curl output, CLI output, database row, generated file, etc.>
- Confidence: high|medium|low with reason

## Discovery Spikes
- <ideas needing proof of data, access, implementation fit, or verification>

## Rejected / Not Practical Yet
- <attractive ideas rejected because data, access, legality, or verification is unavailable>
```

## Rules

- Keep the skill project-agnostic. Do not bake in one domain, company, or data provider.
- Do not require sign-in-only, paid, private, or blocked data unless the host project already supports that source and the user provides usable access.
- Do not rely on unstated manual curation. If manual data entry is the only path, mark it as a discovery or product decision unless the user explicitly accepts it.
- Do not recommend duplicates. If the host project already has a similar capability, record it under `What Already Exists`.
- Do not create tickets, PRDs, branches, or code changes from this skill. The output can feed later planning or implementation only after the user asks for that next step.

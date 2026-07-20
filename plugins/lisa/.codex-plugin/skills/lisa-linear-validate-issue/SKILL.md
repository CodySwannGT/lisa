---
name: lisa-linear-validate-issue
description: "Validates a proposed Linear…"
allowed-tools: ["Skill", "Bash"]
---

# Validate Linear Work Item: $ARGUMENTS

Run all organizational quality gates against a Linear work item spec OR an existing Linear item. **This skill is read-only — it never writes to Linear.** The output is a structured report consumed by callers (`lisa-linear-write-issue` for pre-write gating, `lisa-linear-to-tracker` for PRD dry-run, `lisa-linear-verify` for post-write checks).

## Configuration

Reads `linear.workspace`, `linear.teamKey` from `.lisa.config.json` (with `.local` override) for any feasibility lookups.

## Input

`$ARGUMENTS` is one of:

1. **An existing Linear identifier** (e.g. `ENG-123` for an Issue, or `<workspace>/project/<slug>-<id>` for a Project): fetch and validate the live state.
2. **A proposed item spec** (YAML block, see schema below): validate as-is without touching Linear.

### Spec schema

```yaml
issue_type: Story          # Epic | Story | Task | Bug | Spike | Sub-task | Improvement
team_key: ENG
summary: "[CU-1.2] Upload contract PDF from settings"
priority: 3                # Linear native: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low
parent_project_id: <uuid>  # Required for Story/Task/Improvement when in Epic context
parent_issue_id: <uuid>    # Required for Sub-task (the Story Issue)
description: |             # Full description text — every required section
  ## Context / Business Value
  ...

  ## Technical Approach
  ...

  ## Acceptance Criteria
  1. Given <precondition>
     When <action>
     Then <observable outcome>

  ## Out of Scope
  ...

  ## Target Backend Environment
  dev

  ## Sign-in Required
  Account: ...

  ## Repository
  backend-api

  ## Validation Journey
  ...

# Behavioral flags — caller asserts these so the validator picks the right gates
runtime_behavior_change: true     # → requires Target Backend Environment + Validation Journey
authenticated_surface: true       # → requires Sign-in Required
artifacts_attached: true          # → requires Source Precedence section
relations: [{ id: "ENG-99", type: "blocked_by" }]   # known issue relations (may be empty)
remote_links: [{ url: "https://github.com/...", title: "PR #42" }]
build_ready: true                 # caller asserts the build-ready role (status:ready) is/would be applied — see S15
child_refs: ["ENG-601", "ENG-602"]   # known child work (sub-issues / project-member issues / blocked_by parentage) — see S15
prd_source: "https://notion.so/..."    # set when the Issue was generated from a PRD — requires the Source Requirement section, see S16
```

If the caller passes only an identifier, fetch the item via `lisa-linear-access operation: get-issue` (Issue) or `lisa-linear-access operation: get-project` (Project), derive the same fields from the fetched data — including `build_ready` (label set contains `status:ready`) and `child_refs` (sub-issues, project-member issues, plus `blocked_by` parentage, resolved as in `lisa-linear-read-issue`) so S15 can classify the item — then run gates.

## Gates

Gates are grouped into **Specification** (spec-only checks, no Linear lookups) and **Feasibility** (requires Linear lookups). The dry-run path may opt to run Specification gates only; the write path runs both.

Each gate is tagged with a fixed `category` and a `product_relevant` boolean. Categories drive how downstream callers (notably `lisa-linear-prd-intake`) translate failures into product-facing comments; `product_relevant=false` failures indicate internal data-quality problems the agent should fix itself rather than ask product to clarify.

| Gate | Category | Product-relevant |
|------|----------|------------------|
| S1 Required core fields | `structural` | false |
| S2 Summary format | `structural` | false |
| S3 Description three audiences | `product-clarity` | true |
| S4 Acceptance criteria in Gherkin | `acceptance-criteria` | true |
| S5 Bug-specific content | `product-clarity` | true |
| S6 Spike-specific content | `scope` | true |
| S7 Project parent declared | `structural` | false |
| S8 Target Backend Environment | `technical` | false |
| S9 Sign-in Required | `technical` | false |
| S10 Single-repo scope | `scope` | false |
| S11 Validation Journey | `acceptance-criteria` | true |
| S12 Source Precedence | `design-ux` | true |
| S13 Relationship Search | `dependency` | true |
| S14 Evidence manifest binding (leaf work units) | `acceptance-criteria` | true |
| S15 Leaf-only build-ready | `structural` | false |
| S16 Source Requirement traceability | `product-clarity` | true |
| F1 Issue type valid in team | `structural` | false |
| F2 Project parent exists and is in same team | `structural` | false |
| F3 Linked items exist | `structural` | false |
| F4 Required labels exist (or can be created) | `structural` | false |
| F5 Required external access provable | `technical` | true |

Category values are the same fixed set as `lisa-jira-validate-ticket`:

- `product-clarity` — feature behavior or user intent unclear in the PRD
- `acceptance-criteria` — pass/fail conditions missing or ambiguous
- `design-ux` — visual or interaction spec missing
- `scope` — boundary unclear, items overlap, split needed
- `dependency` — blocked by another team / system / decision
- `data` — data source / shape / volume unspecified
- `technical` — engineering decision required
- `structural` — internal data-quality problem the agent must fix itself, not surface to product

### Specification Gates

#### S1 — Required core fields

`team_key`, `issue_type`, `summary`, `priority`, `description` must all be present and non-empty.

#### S2 — Summary format

- Single line, ≤ 100 characters
- Imperative voice ("Add X", "Fix Y", not "Adding X" or "X is broken")
- Bug / Task / Sub-task summaries SHOULD start with a `[repo-name]` prefix when the project convention uses one

#### S3 — Description has all three audiences

Description text must include all of these sections (case-insensitive `##` markdown headings):
- `Context / Business Value` — stakeholder-facing
- `Technical Approach` — developer-facing
- `Acceptance Criteria` — coding-assistant-facing
- `Out of Scope` — explicit non-coverage list

Missing any → FAIL with name of missing section.

#### S4 — Acceptance criteria in Gherkin

Applies when `issue_type ∈ {Story, Task, Bug, Sub-task, Improvement}`.

The `Acceptance Criteria` section must contain at least one criterion in `Given / When / Then` form. Reject prose-only criteria, "should work" language, or numbered lists without Given/When/Then verbs.

#### S5 — Bug-specific content

When `issue_type = Bug`, description must additionally include:
- Reproduction steps
- Expected vs. actual behavior
- Environment where reproduced

#### S6 — Spike-specific content

When `issue_type = Spike`, description must include:
- The question being answered
- Definition of done (decision doc / prototype / findings deliverable)

#### S7 — Project parent declared

When `issue_type ∈ {Story, Task, Improvement}` AND the item is part of an Epic context, `parent_project_id` must be set. When `issue_type = Sub-task`, `parent_issue_id` must be set. (Validity of the IDs is checked in feasibility gates.)

For top-level Bug / Spike not under an Epic, this gate is N/A.

A **build-ready leaf work unit** that is not part of an Epic context stands alone: a flat `Task` / `Improvement`, or a childless `Story` / `Spike` (no open child work) with `build_ready = true`, is an independently claimable leaf per `leaf-only-lifecycle` ("must not be stranded"), so a missing `parent_project_id` is `N/A`, not a FAIL. A `Sub-task` is exempt from this exception — it always requires `parent_issue_id`. This mirrors the leaf carve-out already in S10/S15.

#### S8 — Target Backend Environment

When `runtime_behavior_change = true`, the description must contain `## Target Backend Environment`. Read accepted environments from the exact configured keys of `.lisa.config.json` `deploy.branches`, never from a hardcoded list. Accept a human-confirmed bare exact configured key or `Confirmed: <env>`, automated `Inferred: <env> — evidence: <title|body|reproduction|hostname>`, automated `Assumption: <env> — remote default branch <branch>` for a unique reverse-map, or `Assumption: remote default branch <branch>` when no unique reverse-map exists. Human confirmation replaces an automated annotation with the bare key or `Confirmed: <env>`. For legacy bare values, use managed draft markers and current ticket content only; provider edit history is not required. A marker proves automation and requires re-annotation; otherwise unknown provenance plus conflicting evidence fails for confirmation. Validate the annotation shape/source and remote-default branch; validate `<env>` as an exact configured key whenever present. A valid branch-only assumption must not fail solely because its reverse-map is absent or ambiguous. Normalize built-in `prod` ↔ `production` only when exactly one of those keys is configured. No other aliases are valid. Skipped for doc-only / config-only / type-only / Epic.

#### S9 — Sign-in Required

When `authenticated_surface = true`, description must contain `## Sign-in Required` naming the account/role and credential source.

If the spec doesn't set `authenticated_surface`, infer it: scan the description and AC for sign-in / login / "as a {role} user" / authenticated route signals. If signals present and no `Sign-in Required` section: FAIL.

#### S10 — Repository section, single-repo scope

When `issue_type ∈ {Bug, Task, Sub-task, Improvement}` — or a **build-ready childless Story/Spike** (a claimable leaf per `leaf-only-lifecycle`) — description must contain `## Repository` naming exactly one repo. Multiple repos OR cross-repo references in AC: FAIL with recommendation `"Split into per-repo work units under a shared parent Story (see lisa-task-decomposition step 1.5)"`.

An **Epic** (a Linear Project), or a **Story/Spike that still holds child work** (or is not build-ready): skipped (may span repos — coordination containers, not claimable leaf work units).

This gate is `product_relevant: false` because cross-repo work units are not a product question — they are a decomposition error. Callers (`lisa-linear-to-tracker`, `lisa-notion-to-tracker`, etc.) MUST pre-split cross-repo work into per-repo work units during the decomposition phase per `lisa-task-decomposition` step 1.5; an S10 failure here indicates the agent skipped that step and must auto-split + revalidate before writing, not surface a clarifying comment to product.

#### S11 — Validation Journey present

When `runtime_behavior_change = true`, description must contain `## Validation Journey`. Skipped for doc-only / config-only / type-only / Epic.

The caller controls strictness via `journey_followup: "auto"` or `"none"`:
- `auto` (default): missing section returns `FAIL` with remediation `"Invoke lisa-linear-add-journey to append the section after create"`. The write path auto-fixes; dry-run path leaves it as a FAIL the caller must address.
- `none`: missing section is a `FAIL` the caller will not auto-fix.

#### S12 — Source Precedence (when artifacts attached)

When `artifacts_attached = true`, description must include source-precedence guidance covering: business rules → PRD body, visual treatment → mocks, flow → prototypes, API/data → data artifacts. Cross-axis conflicts surfaced under `## Open Questions`.

Accept either placement:
- A dedicated `## Source Precedence` subsection, OR
- A "Source Precedence" / "authoritative source" paragraph under `Technical Approach` covering the four axes.

Detect by scanning for the phrase `Source Precedence` (case-insensitive) anywhere in the description AND verifying the four axes are each named. Missing the phrase OR any axis: FAIL with remediation naming the missing axes.

#### S13 — Relationship Search documented

The item must EITHER have at least one entry in `relations`, OR the description / a comment must contain a `## Relationship Search` block listing the git history queries and Linear MCP queries that were run with their outcomes.

An item with zero relations and no documented search: FAIL.

#### S14 — Evidence manifest binding (leaf work units)

When `issue_type ∈ {Bug, Task, Sub-task, Improvement}` AND `runtime_behavior_change = true`, the `## Validation Journey` must declare at least one **typed** `[EVIDENCE: <artifact-type>: <name>]` marker. These markers are the work unit's **evidence manifest** — the exact, enumerated set of artifacts that must be captured and attached before the item may be closed (see the "Per-Work-Unit Evidence Contract" section of the `verification` rule, the Definition of Done in `verification-lifecycle`, and the evidence-manifest gate in `tracker-evidence`).

Each marker must satisfy ALL of:

- `<artifact-type>` is one of the fixed taxonomy: `screenshot`, `recording`, `http-transcript`, `cli-output`, `log-snippet`, `db-query-output`, `perf-trace`, `test-run-log`, `deploy-log`, `state-dump`. (The legacy `[SCREENSHOT: name]` form is accepted as `screenshot`.)
- `<name>` is kebab-case and unique within the item.

**A marker names an artifact, not an assertion.** An untyped marker (`[EVIDENCE: load-failure-handled-gracefully]`) is an assertion label with nothing to capture and must FAIL, with a remediation that shows the typed transformation (e.g. → `[EVIDENCE: screenshot: load-failure-error-state]`, `[EVIDENCE: perf-trace: pipeline-load-tti]`).

FAIL when the Validation Journey is present but declares zero binding `[EVIDENCE: ...]` markers, when any binding marker is untyped or uses a type outside the taxonomy, or when any binding name is empty, duplicated, or not kebab-case. A behavior-changing work unit SHOULD declare both a success marker and an error/edge marker; a journey with only one binding marker passes but the remediation should recommend adding the error/edge case.

Parse claiming markers by the exact `[EVIDENCE:` prefix. A cross-work-item pointer in the canonical form `[EVIDENCE-REF: <work-item-ref> | <artifact-type>: <kebab-case-name>]` is non-claiming. The Lisa 2.223.0 form `[EVIDENCE-REF: <tracker-ref>: <artifact-type>: <kebab-case-name>]` is also accepted as a legacy non-claiming alias; parse it from the right so the final two fields are type/name and a tracker URL may contain `:`. Exclude both forms from the manifest, S14's minimum-marker count, local marker type/name validation, and duplicate-name checks. Independently validate every `EVIDENCE-REF`: the native work-item reference must be non-empty and unambiguous, the artifact type must use the fixed taxonomy, and the name must be non-empty kebab-case. A malformed reference FAILs S14 as an invalid pointer but never becomes a local evidence obligation. A valid canonical or legacy reference may point to a sibling's artifact, but it never satisfies S14 for this item. Therefore a runtime-changing leaf whose journey contains only `EVIDENCE-REF` entries FAILs S14 for zero local claiming markers, not because a valid legacy reference is malformed. Quoting or code-formatting another item's `[EVIDENCE: ...]` marker does not make it a reference; writers must convert it to the canonical pipe form.

This gate depends on S11. It is `N/A` for containers — a **Project** (the Epic equivalent), or any item with open child work (coordination containers, not work units) — and for leaf units with `runtime_behavior_change = false` (doc-only / config-only / type-only). If S11 fails because the Validation Journey is absent, S14 also FAILs (there is no manifest to bind) with remediation pointing back to `lisa-linear-add-journey`.

#### S15 — Leaf-only build-ready

Enforces the build-side of the vendor-neutral `leaf-only-lifecycle` rule: **only a leaf work unit may carry the build-ready role.** This is the symmetric write-side guard for the Linear validator — a stale or hand-applied `status:ready` label on a container is a lifecycle error and must FAIL here, regardless of how the item was produced. (Mirrors the "Build-ready label is leaf-only" rule that `lisa-linear-write-issue` applies at write time.)

**When the gate applies.** Run S15 whenever the item is build-ready — i.e. `build_ready = true`, or the spec/live labels include `status:ready`. If the item is not build-ready, S15 is `N/A` (nothing claims a non-ready item, so the invariant is vacuous).

**Resolve container vs. leaf — structural first, then nominal.** Per `leaf-only-lifecycle` the classification is structural: an item is a **container** if it has child work, whatever its declared type; otherwise the **issue type** decides. Determine child work from (in order) `child_refs`, native sub-issues, project-member issues (an Epic is modeled as a Linear Project), and `blocked_by` / parent references — the same hierarchy resolution `lisa-linear-read-issue` uses. When validating a live identifier, query sub-issues / project members alongside the item fetch.

Apply this decision and FAIL the two invariant-violating cases:

1. **Container with child work + build-ready** — child work is present (any type that has open children), AND build-ready. FAIL. A parent organizes work; it is never claimed and implemented directly. Its lifecycle state rolls up from its children.
2. **Childless Epic/Project + build-ready** — `issue_type = Epic` (a Linear Project) with **no** child work, AND build-ready. Still FAIL: an Epic/Project is a pure rollup container by design, and a childless one is an incomplete decomposition or a mis-applied role, not an implementable unit. (A childless Story or Spike is **not** failed here — the childless-parent exception in `leaf-only-lifecycle` promotes every childless non-Epic type to a build-ready leaf.)

PASS (the childless-parent exception) when the item is build-ready and is a **leaf work unit**: it has **no** open child work and `issue_type ≠ Epic` (i.e. `Bug, Task, Sub-task, Improvement`, or a childless `Story` / `Spike`). A flat Task/Bug, or a childless Story/Spike with no sub-issues, is a valid build-ready leaf and must not be stranded.

| issue_type | has child work | build-ready | S15 |
|---|---|---|---|
| Bug / Task / Sub-task / Improvement / Story / Spike | no | yes | **PASS** (leaf) |
| any type | yes | yes | **FAIL** (structurally a container) |
| Epic (Project) | no | yes | **FAIL** (childless Epic/Project — pure rollup container, exception does not apply) |
| any | any | no | **N/A** (not build-ready) |

Remediation: `"Build-ready (status:ready) is leaf-only per leaf-only-lifecycle. Move status:ready off this container onto its leaf children (or, for a childless Epic, decompose it into leaf children or reclassify it to a leaf type); a parent's lifecycle state rolls up from its children and is never set to ready directly."`

`product_relevant: false` — a build-ready container is a lifecycle/decomposition error for the caller to repair, not a product question.

#### S16 — Source Requirement traceability (PRD-sourced Issues)

Answers "why was this done?": every Issue generated from a PRD must carry
the requirement it exists to satisfy, quoted verbatim, at every level of
the hierarchy — sub-issues included, so a leaf claimed by build-intake in
isolation is self-explanatory.

**When the gate applies.** Run S16 whenever the spec declares `prd_source`
(all `*-to-tracker` decomposition paths set it). Without `prd_source`
(ad-hoc issues with no PRD lineage) the gate is `N/A` — but if a
`Source Requirement` section is present anyway, still validate its shape
so a malformed section never passes silently.

**What must be present.** a `Source Requirement` section (`##` markdown heading) containing:

1. A link to the source PRD (the `**PRD**:` line), and
2. At least one `**Requirement` line with **verbatim quoted text**, or the
   explicit derived-work form (`Derived work supporting R3, R7 — no single
   PRD section.`).

Missing section, missing PRD link, empty/paraphrased requirement text
(quotes shorter than a few words, or prose with no quotation), or a bare
R-id with no quote: FAIL with remediation
`"Add a Source Requirement section citing the PRD link and quoting the requirement(s) this issue satisfies verbatim (see the Source Requirement shared format in the *-to-tracker skills). Derived work must name the requirements it supports."`

`product_relevant: true` — a issue whose requirement cannot be traced is
a product-clarity problem: nobody can tell why the work exists.

### Feasibility Gates (require Linear lookups; skip in dry-run if requested)

#### F1 — Issue type valid in team

For Issue types: confirm the team supports the issue type via `lisa-linear-access operation: get-team`. Linear issue types are typically per-team; check that the requested type exists.

For Epic (Project): confirm the team allows projects.

#### F2 — Project parent exists and is in same team

When `parent_project_id` is set: fetch via `lisa-linear-access operation: get-project`, confirm it exists and belongs to the configured team.

When `parent_issue_id` is set (Sub-task case): fetch via `lisa-linear-access operation: get-issue`, confirm the issue is non-Sub-task and in the same team / project.

#### F3 — Linked items exist

For each entry in `relations`, call `lisa-linear-access operation: get-issue` to confirm the identifier resolves. Flag broken identifiers.

#### F4 — Required labels exist (or can be created)

For each label referenced (`status:*`, `component:<name>`, `prd-*`), confirm via `lisa-linear-access operation: list-issue-labels` (or `lisa-linear-access operation: list-project-labels` for Project labels) that it exists OR is creatable. Linear labels are team-scoped or workspace-scoped; flag if the requested scope is wrong.

#### F5 — Required external access provable

The factory-gate rule: an input must not enter the pipeline unless the current runtime can actually
reach every external surface the work requires. Enumerate the surfaces this item depends on:

- artifact links in the body (documents, designs, dashboards, spreadsheets, recordings),
- systems named by the description, acceptance criteria, or Validation Journey ("read the CloudWatch
  alarms", "pull the copy from the Google Doc", "check the Sentry issues"),
- tooling the work plainly implies (a deploy target, a database, a third-party API).

For each surface, prove **read** access from the current runtime with a target-resource-specific,
read-only probe through its sanctioned access layer: the matching MCP tool or `lisa-*-access` skill,
or an authenticated fetch using environment-injected authentication. Identity-only commands such as
`aws sts get-caller-identity`, `gh auth status`, and vendor equivalents are preflight checks only;
they never satisfy F5 by themselves. A successful probe for one surface does not cover another:
reading the named GitHub repository, CloudWatch log group, Sentry project, or linked document must
each succeed separately when that surface is required.

Attempt to resolve a gap before failing, but only through another configured brokered access layer
or environment-injected authentication. A sanctioned broker may use its own credential store
internally; the validator must never autonomously inspect, read, copy, print, or export raw
credentials, keychains, credential files, or token stores, and must never invoke low-level secret
tools to recover them. This preserves the intake agent's discover-first duty without exposing
credential material.

- `PASS` — every required surface has its own successful target-resource read probe or authenticated
  fetch through the sanctioned access layer.
- `N/A` — the item needs nothing beyond the repository and the tracker itself.
- `FAIL` — a required surface is unreachable after the resolution attempt. Name the exact surface
  and what was probed. Intake callers must route this to `blocked` + human escalation with the
  missing access spelled out — an input the factory cannot execute never enters the factory.

Probes are read-only and bounded (seconds, not minutes, per surface); never mutate the external
system, and never invent or ask for credentials inline.

## Execution

1. Parse `$ARGUMENTS`. If it's an identifier, fetch the item and derive the spec from the fetched fields — including `build_ready` (label set contains `status:ready`) and `child_refs` (sub-issues, project-member issues, plus `blocked_by` parentage, resolved as in `lisa-linear-read-issue`) so S15 can classify the item. Otherwise parse the YAML spec.
2. Resolve team ID via `lisa-linear-access operation: list-teams({query: <teamKey>})` if any feasibility gate will run.
3. Run every Specification gate in order. Collect PASS / FAIL / N/A with a one-line reason.
4. Unless the caller passed `--spec-only` (dry-run), run every Feasibility gate. Collect results.
5. Emit the report below.

## Output

Output is a single fenced text block. Callers parse it; do not add free-form prose around it.

```text
## linear-validate-issue: <IDENTIFIER-or-SUMMARY>

### Specification Gates
- [PASS|FAIL|N/A] S1 Required core fields — <one-line reason>
- [PASS|FAIL|N/A] S2 Summary format — <one-line reason>
- [PASS|FAIL|N/A] S3 Description three audiences — <one-line reason>
- [PASS|FAIL|N/A] S4 Acceptance criteria in Gherkin — <one-line reason>
- [PASS|FAIL|N/A] S5 Bug-specific content — <one-line reason>
- [PASS|FAIL|N/A] S6 Spike-specific content — <one-line reason>
- [PASS|FAIL|N/A] S7 Project parent declared — <one-line reason>
- [PASS|FAIL|N/A] S8 Target Backend Environment — <one-line reason>
- [PASS|FAIL|N/A] S9 Sign-in Required — <one-line reason>
- [PASS|FAIL|N/A] S10 Single-repo scope — <one-line reason>
- [PASS|FAIL|N/A] S11 Validation Journey — <one-line reason>
- [PASS|FAIL|N/A] S12 Source Precedence — <one-line reason>
- [PASS|FAIL|N/A] S13 Relationship Search — <one-line reason>
- [PASS|FAIL|N/A] S14 Evidence manifest binding — <one-line reason>
- [PASS|FAIL|N/A] S15 Leaf-only build-ready — <one-line reason>
- [PASS|FAIL|N/A] S16 Source Requirement traceability — <one-line reason>

### Feasibility Gates  (omit when --spec-only)
- [PASS|FAIL|N/A] F1 Issue type valid in team — <one-line reason>
- [PASS|FAIL|N/A] F2 Project parent exists and is in same team — <one-line reason>
- [PASS|FAIL|N/A] F3 Linked items exist — <one-line reason>
- [PASS|FAIL|N/A] F4 Required labels exist (or can be created) — <one-line reason>
- [PASS|FAIL|N/A] F5 Required external access provable — <one-line reason>

### Verdict: PASS | FAIL
### Failures: <count>
### Failure details
- gate: <gate-id>
  category: <category>
  product_relevant: <true|false>
  what: <plain-language description, no gate-IDs, no Linear jargon>
  recommendation: <1–3 concrete options>
- gate: ...
```

The verdict is `PASS` if and only if every applicable gate is `PASS`. Any `FAIL` makes the verdict `FAIL`. `N/A` does not affect the verdict.

## Rules

- Never write to Linear. The `allowed-tools` list intentionally excludes any `save_*` tool.
- Never auto-fix the spec. This skill reports gaps; callers decide what to do.
- Never silently skip a gate. If a gate genuinely doesn't apply, return `N/A` with the reason.
- The `what` and `recommendation` fields must be concrete and product-readable — the dry-run path turns each failure into a Linear comment. Vague guidance is useless; always give 1–3 candidate resolutions.
- Never emit a category outside the fixed set.
- `product_relevant` is determined by the gate, not by the failure context.

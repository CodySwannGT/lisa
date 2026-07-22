---
name: lisa-github-validate-issue
description: "Validates a proposed GitHub Issue spec (or an existing issue) against the organizational quality gates without writing anything. Returns a structured PASS/FAIL report per gate with concrete remediation. The GitHub counterpart of lisa-jira-validate-ticket — same gate definitions, translated to the GitHub Issues data model. Single source of truth for what makes a valid GitHub Issue. Both the write path (github-write-issue runs it pre-write) and the dry-run path (github-to-tracker runs it during PRD intake) call this skill."
allowed-tools: ["Bash", "Read"]
---

# Validate GitHub Issue: $ARGUMENTS

Run all organizational quality gates against an issue spec OR an existing issue. **This skill is read-only — it never writes to GitHub.** The output is a structured report consumed by callers (`lisa-github-write-issue` for pre-write gating, `lisa-github-to-tracker` for PRD dry-run, `lisa-github-verify` for post-write checks).

## Input

`$ARGUMENTS` is one of:

1. **An existing issue ref** (`org/repo#<number>` or `https://github.com/<org>/<repo>/issues/<number>`): fetch it and validate the live state. Use this for post-write checks.
2. **A proposed issue spec** (YAML block, see schema below): validate as-is without touching GitHub. Use this for pre-write and dry-run checks.

### Spec schema

Specs are passed as a fenced YAML block. Required keys depend on `issue_type`.

```yaml
issue_type: Story          # Story | Task | Bug | Epic | Spike | Sub-task | Improvement
org: my-org
repo: my-repo
summary: "[CU-1.2] Upload contract PDF from settings"
priority: medium
parent_ref: "my-org/my-repo#1234"   # Parent Epic for ordinary children; PRD for an Epic only in the same-repo GitHub self-host shape; Story/etc. for Sub-task
body: |
  ## Context / Business Value
  ...

  ## Technical Approach
  ...

  ## Acceptance Criteria
  ```gherkin
  Scenario: <name>
    Given <precondition>
    When <action>
    Then <observable outcome>
  ```

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

# Behavioral flags — caller asserts these so the validator can pick the right gates
runtime_behavior_change: true     # → requires Target Backend Environment + Validation Journey
authenticated_surface: true       # → requires Sign-in Required
artifacts_attached: true          # → requires Source Precedence section
links: [{ ref: "my-org/my-repo#99", type: "is blocked by" }]   # known issue links (may be empty)
remote_links: [{ url: "https://github.com/.../pull/42", title: "PR #42" }]
journey_followup: auto            # auto | none — see S11
build_ready: true                 # caller asserts the configured build-ready role (github.labels.build.ready, default status:ready) is/would be applied — see S15
child_refs: ["my-org/my-repo#601", "my-org/my-repo#602"]   # known child work (sub-issues / task-list / "Blocked by" parentage) — see S15
prd_source: "https://notion.so/..."    # set when the issue was generated from a PRD — requires the Source Requirement section, see S16
```

If the caller passes only an issue ref, fetch via `gh issue view <number> --repo <org>/<repo> --json number,title,body,labels,state,milestone,assignees`, parse the body sections, derive the spec fields, then run gates. The parser lives in `lisa-github-read-issue` (composition).

## Gates

Gates are grouped into **Specification** (spec-only checks, no GitHub lookups) and **Feasibility** (requires GitHub lookups). The dry-run path may opt to run Specification gates only via `--spec-only`; the write path runs both.

Each gate is tagged with a fixed `category` and a `product_relevant` boolean. Categories are the same fixed set used by `lisa-jira-validate-ticket` so downstream PRD-intake comment-formatting policy is shared across vendors.

| Gate | Category | Product-relevant |
|------|----------|------------------|
| S1 Required core fields | `structural` | false |
| S2 Summary format | `structural` | false |
| S3 Description three audiences | `product-clarity` | true |
| S4 Acceptance criteria in Gherkin | `acceptance-criteria` | true |
| S5 Bug-specific content | `product-clarity` | true |
| S6 Spike-specific content | `scope` | true |
| S7 Parent sub-issue declared | `structural` | false |
| S8 Target Backend Environment | `technical` | false |
| S9 Sign-in Required | `technical` | false |
| S10 Single-repo scope | `scope` | false |
| S11 Validation Journey | `acceptance-criteria` | true |
| S12 Source Precedence | `design-ux` | true |
| S13 Relationship Search | `dependency` | true |
| S14 Evidence manifest binding (leaf work units) | `acceptance-criteria` | true |
| S15 Leaf-only build-ready | `structural` | false |
| S16 Source Requirement traceability | `product-clarity` | true |
| F1 Issue type label exists in repo | `structural` | false |
| F2 Parent sub-issue exists and is the right type | `structural` | false |
| F3 Linked issues exist | `structural` | false |
| F4 Required labels populated | `structural` | false |
| F5 Required external access provable | `technical` | true |

Category values are the same fixed set as `lisa-jira-validate-ticket`:

- `product-clarity`, `acceptance-criteria`, `design-ux`, `scope`, `dependency`, `data`, `technical`, `structural`.

### Specification Gates

#### S1 — Required core fields

`org`, `repo`, `issue_type`, `summary`, `priority`, `body` must all be present and non-empty.

#### S2 — Summary format

- Single line, ≤ 100 characters.
- Imperative voice ("Add X", "Fix Y", not "Adding X" or "X is broken").
- Bug / Task / Sub-task summaries SHOULD start with a `[repo-name]` prefix when the project convention uses one.

#### S3 — Description has all three audiences

Body must include all of these sections (case-insensitive `## ` headings):

- `Context / Business Value` — stakeholder-facing
- `Technical Approach` — developer-facing
- `Acceptance Criteria` — coding-assistant-facing
- `Out of Scope` — explicit non-coverage list

Missing any → FAIL with name of missing section.

#### S4 — Acceptance criteria in Gherkin

Applies when `issue_type ∈ {Story, Task, Bug, Sub-task, Improvement}`.

The `## Acceptance Criteria` section must contain at least one `Scenario:` block with `Given / When / Then` form, ideally inside a ` ```gherkin ` code fence. Reject prose-only criteria, "should work" language, or numbered lists without Given/When/Then verbs.

#### S5 — Bug-specific content

When `issue_type = Bug`, body must additionally include:

- Reproduction steps
- Expected vs. actual behavior
- Environment where reproduced

#### S6 — Spike-specific content

When `issue_type = Spike`, body must include:

- The question being answered
- Definition of done (decision doc / prototype / findings deliverable)

#### S7 — Parent sub-issue declared

When `issue_type ∉ {Bug, Epic}`, `parent_ref` must be set — **except for a build-ready leaf work unit**, which may stand alone. A flat `Task` / `Improvement`, or a childless `Story` / `Spike` (no open child work) with `build_ready = true`, is an independently claimable leaf per `leaf-only-lifecycle`, which states such leaves "must not be stranded"; for these a missing parent is `N/A`, not a FAIL. This mirrors the leaf carve-out already in S10/S15. A `Sub-task` is exempt from this exception — it always requires a parent. When a parent IS declared, the native sub-issue link is set by `lisa-github-write-issue` Phase 6 step 3. (Validity of a declared parent is checked in feasibility gate F2.)

#### S8 — Target Backend Environment

When `runtime_behavior_change = true`, the body must contain `## Target Backend Environment`. Read accepted environments from the exact configured keys of `.lisa.config.json` `deploy.branches`, never from a hardcoded list. Accept a human-confirmed bare exact configured key or `Confirmed: <env>`, automated `Inferred: <env> — evidence: <title|body|reproduction|hostname>`, automated `Assumption: <env> — remote default branch <branch>` for a unique reverse-map, or `Assumption: remote default branch <branch>` when no unique reverse-map exists. Human confirmation replaces an automated annotation with the bare key or `Confirmed: <env>`. For legacy bare values, use managed draft markers and current ticket content only; provider edit history is not required. A marker proves automation and requires re-annotation; otherwise unknown provenance plus conflicting evidence fails for confirmation. Validate the annotation shape/source and remote-default branch; validate `<env>` as an exact configured key whenever present. A valid branch-only assumption must not fail solely because its reverse-map is absent or ambiguous. Normalize built-in `prod` ↔ `production` only when exactly one of those keys is configured. No other aliases are valid. Skipped for doc-only / config-only / type-only / Epic.

#### S9 — Sign-in Required

When `authenticated_surface = true`, body must contain `## Sign-in Required` naming the account/role and credential source.

If the spec doesn't set `authenticated_surface`, infer it: scan the body and AC for sign-in / login / "as a {role} user" / authenticated route signals. If signals present and no `Sign-in Required` section: FAIL.

#### S10 — Repository section, single-repo scope

When `issue_type ∈ {Bug, Task, Sub-task, Improvement}` — or a **build-ready childless Story/Spike** (a claimable leaf per `leaf-only-lifecycle`) — body must contain `## Repository` naming exactly one repo. Multiple repos OR cross-repo references in AC: FAIL with recommendation `"Split into per-repo work units under a shared parent Story (see lisa-task-decomposition step 1.5)"`.

(GitHub Issues live in one repo by definition, so the `## Repository` section is technically redundant — keep it for parity with the JIRA path so downstream tooling sees the same shape. Cross-repo references in AC are still possible and still fail this gate.)

An **Epic**, or a **Story/Spike that still holds child work** (or is not build-ready): skipped (may span repos — coordination containers, not claimable leaf work units).

This gate is `product_relevant: false` because cross-repo work units are not a product question — they are a decomposition error. Callers (`lisa-github-to-tracker`, `lisa-notion-to-tracker`, etc.) MUST pre-split cross-repo work into per-repo work units during the decomposition phase per `lisa-task-decomposition` step 1.5; an S10 failure here indicates the agent skipped that step and must auto-split + revalidate before writing, not surface a clarifying comment to product.

#### S11 — Validation Journey present

When `runtime_behavior_change = true`, body must contain `## Validation Journey`. Skipped for doc-only / config-only / type-only / Epic.

The caller controls strictness via `journey_followup`:
- `auto` (default): missing section is FAIL with remediation `"Invoke lisa-github-add-journey to append the section after create"`. Callers like `lisa-github-write-issue` know to chain the followup automatically.
- `none`: missing section is FAIL the caller will not auto-fix (used by dry-run paths).

#### S12 — Source Precedence (when artifacts attached)

When `artifacts_attached = true`, body must include source-precedence guidance covering: business rules → PRD body, visual treatment → mocks, flow → prototypes, API/data → data artifacts. Cross-axis conflicts surfaced under `## Open Questions`.

Accept either placement:
- A dedicated `## Source Precedence` subsection, OR
- A "Source Precedence" / "authoritative source" paragraph under `## Technical Approach`.

Detect by scanning for the phrase `Source Precedence` (case-insensitive) AND verifying the four axes (business rules, visual, flow, data) are each named.

#### S13 — Relationship Search documented

The issue must EITHER have at least one entry in `links`, OR the body must contain a `## Relationship Search` block listing the git history queries and `gh issue list` queries that were run with their outcomes. ("Searched git history for `<keywords>` and `gh issue list` for label `component:X`; no related work found.")

An issue with zero links and no documented search: FAIL.

#### S14 — Evidence manifest binding (leaf work units)

When `issue_type ∈ {Bug, Task, Sub-task, Improvement}` AND `runtime_behavior_change = true`, the `## Validation Journey` must declare at least one **typed** `[EVIDENCE: <artifact-type>: <name>]` marker. These markers are the work unit's **evidence manifest** — the exact, enumerated set of artifacts that must be captured and attached before the issue may be closed (see the "Per-Work-Unit Evidence Contract" section of the `verification` rule, the Definition of Done in `verification-lifecycle`, and the evidence-manifest gate in `tracker-evidence`).

Each marker must satisfy ALL of:

- `<artifact-type>` is one of the fixed taxonomy: `screenshot`, `recording`, `http-transcript`, `cli-output`, `log-snippet`, `db-query-output`, `perf-trace`, `test-run-log`, `deploy-log`, `state-dump`. (The legacy `[SCREENSHOT: name]` form is accepted as `screenshot`.)
- `<name>` is kebab-case and unique within the issue.

**A marker names an artifact, not an assertion.** An untyped marker (`[EVIDENCE: load-failure-handled-gracefully]`) is an assertion label with nothing to capture and must FAIL, with a remediation that shows the typed transformation (e.g. → `[EVIDENCE: screenshot: load-failure-error-state]`, `[EVIDENCE: perf-trace: pipeline-load-tti]`).

FAIL when the Validation Journey is present but declares zero binding `[EVIDENCE: ...]` markers, when any binding marker is untyped or uses a type outside the taxonomy, or when any binding name is empty, duplicated, or not kebab-case. A behavior-changing work unit SHOULD declare both a success marker and an error/edge marker; a journey with only one binding marker passes but the remediation should recommend adding the error/edge case.

Parse claiming markers by the exact `[EVIDENCE:` prefix. A cross-work-item pointer in the canonical form `[EVIDENCE-REF: <work-item-ref> | <artifact-type>: <kebab-case-name>]` is non-claiming. The Lisa 2.223.0 form `[EVIDENCE-REF: <tracker-ref>: <artifact-type>: <kebab-case-name>]` is also accepted as a legacy non-claiming alias; parse it from the right so the final two fields are type/name and a tracker URL may contain `:`. Exclude both forms from the manifest, S14's minimum-marker count, local marker type/name validation, and duplicate-name checks. Independently validate every `EVIDENCE-REF`: the native work-item reference must be non-empty and unambiguous, the artifact type must use the fixed taxonomy, and the name must be non-empty kebab-case. A malformed reference FAILs S14 as an invalid pointer but never becomes a local evidence obligation. A valid canonical or legacy reference may point to a sibling's artifact, but it never satisfies S14 for this issue. Therefore a runtime-changing leaf whose journey contains only `EVIDENCE-REF` entries FAILs S14 for zero local claiming markers, not because a valid legacy reference is malformed. Quoting or code-formatting another issue's `[EVIDENCE: ...]` marker does not make it a reference; writers must convert it to the canonical pipe form.

This gate depends on S11. It is `N/A` for containers — an **Epic**, or any item with open child work (coordination containers, not work units) — and for leaf units with `runtime_behavior_change = false` (doc-only / config-only / type-only). If S11 fails because the Validation Journey is absent, S14 also FAILs (there is no manifest to bind) with remediation pointing back to `lisa-github-add-journey`.

#### S15 — Leaf-only build-ready

Enforces the build-side of the vendor-neutral `leaf-only-lifecycle` rule: **only a leaf work unit may carry the build-ready role.** Before evaluating this gate, resolve `READY_ROLE` from merged project config (`.lisa.config.local.json` over `.lisa.config.json`) at `github.labels.build.ready`, defaulting to `status:ready` per `config-resolution`. Use that resolved value everywhere this validator interprets build readiness; a project-specific label is not an alias for the literal default.

This is the symmetric write-side guard for the GitHub validator — a stale or hand-applied `READY_ROLE` on a container is a lifecycle error and must FAIL here, regardless of how the issue was produced. (Mirrors the "Build-ready label is leaf-only" rule that `lisa-github-write-issue` applies at write time.)

**When the gate applies.** Run S15 whenever the issue is build-ready — i.e. `build_ready = true`, or the spec/live labels include the resolved `READY_ROLE`. If the issue is not build-ready, S15 is `N/A` (nothing claims a non-ready issue, so the invariant is vacuous). For example, if `github.labels.build.ready = "queue:approved"`, a container carrying `queue:approved` FAILs S15 even when it does not carry the literal `status:ready` default.

**Resolve container vs. leaf — structural first, then nominal.** Per `leaf-only-lifecycle` the classification is structural: an item is a **container** if it has child work, whatever its declared type; otherwise the **type label** decides. Determine child work from (in order) `child_refs`, native sub-issues, body task-list checkboxes, and `Blocked by #<n>` / parent references — the same hierarchy resolution `lisa-github-read-issue` uses. When validating a live ref, query sub-issues alongside the issue fetch.

Apply this decision and FAIL the two invariant-violating cases:

1. **Container with child work + build-ready** — child work is present (any type that has open children), AND build-ready. FAIL. A parent organizes work; it is never claimed and implemented directly. Its lifecycle state rolls up from its children.
2. **Childless Epic + build-ready** — `issue_type = Epic` with **no** child work, AND build-ready. Still FAIL: an Epic is a pure rollup container by design, and a childless one is an incomplete decomposition or a mis-applied role, not an implementable unit. (A childless Story or Spike is **not** failed here — the childless-parent exception in `leaf-only-lifecycle` promotes every childless non-Epic type to a build-ready leaf.)

PASS (the childless-parent exception) when the issue is build-ready and is a **leaf work unit**: it has **no** open child work and `issue_type ≠ Epic` (i.e. `Bug, Task, Sub-task, Improvement`, or a childless `Story` / `Spike`). A flat Task/Bug, or a childless Story/Spike with no sub-issues, is a valid build-ready leaf and must not be stranded.

| issue_type | has child work | build-ready | S15 |
|---|---|---|---|
| Bug / Task / Sub-task / Improvement / Story / Spike | no | yes | **PASS** (leaf) |
| any type | yes | yes | **FAIL** (structurally a container) |
| Epic | no | yes | **FAIL** (childless Epic — pure rollup container, exception does not apply) |
| any | any | no | **N/A** (not build-ready) |

Remediation (render `<READY_ROLE>` as the resolved configured label, never as a hard-coded default): `"Build-ready (<READY_ROLE>; status:ready by default) is leaf-only per leaf-only-lifecycle. Move <READY_ROLE> off this container onto its leaf children (or, for a childless Epic, decompose it into leaf children or reclassify it to a leaf type); a parent's lifecycle state rolls up from its children and is never set to ready directly."`

`product_relevant: false` — a build-ready container is a lifecycle/decomposition error for the caller to repair, not a product question.

#### S16 — Source Requirement traceability (PRD-sourced issues)

Answers "why was this done?": every issue generated from a PRD must carry
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

### Feasibility Gates (require GitHub lookups; skip in `--spec-only`)

#### F1 — Issue type label exists in repo

```bash
gh label list --repo <org>/<repo> --json name --jq '.[].name'
```

Confirm `type:<issue_type>` exists. Missing labels can be auto-created by `lisa-github-write-issue` Phase 5 — flag the absence as a structural FAIL with remediation "Run `gh label create type:<issue_type>` or let the write path auto-create."

#### F2 — Parent sub-issue exists and is the right type

When `parent_ref` is set:

```bash
gh issue view <number> --repo <org>/<repo> --json number,labels,state
```

Confirm the parent issue exists and:

- For an `Epic` child, first resolve whether the validator can prove the native PRD-parent shape
  allowed by `prd-lifecycle-rollup`: merged project config has `source = github` and
  `tracker = github`; the spec/live child's `org` and `repo` match configured `github.org` and
  `github.repo`; and `parent_ref` names that same `org/repo`. These facts are available from the
  existing spec/live ref plus project config; do not infer the exception from label spelling alone.
  Only in that proven same-repository GitHub self-host shape may the parent qualify by having one of
  the configured PRD lifecycle labels from
  `github.labels.prd` (`draft`, `ready`, `in_review`, `blocked`, `ticketed`, `shipped`, or
  `verified`; defaults use the `prd-*` namespace). Resolve the configured values from
  `.lisa.config.local.json` over `.lisa.config.json`, using the defaults from `config-resolution`.
  The `sentinel` label is not a lifecycle role and does not qualify. This is the native
  PRD→generated-Epic hierarchy used when GitHub is both source and tracker in one repository; the
  PRD parent does **not** need `type:Epic`. If any self-host/same-repository predicate is false, a
  PRD label does not grant the exception: native hierarchy cannot cross repositories or source
  systems, so a PRD-labelled parent alone FAILs F2.
- For a `Sub-task` child: the parent has `type:Story`, `type:Task`, `type:Bug`, or
  `type:Improvement` (anything that can host sub-tasks). This allowlist is unchanged; a PRD
  lifecycle label or `type:Epic` alone does not qualify.
- For every other non-Sub-task child: the parent has `type:Epic`. A PRD lifecycle label alone does
  not qualify, so the Epic→Story (and Epic→ordinary-leaf) hierarchy remains enforced.

| child type | relationship shape | qualifying parent label | F2 |
|---|---|---|---|
| `Epic` | source GitHub + tracker GitHub + configured child repo = parent repo | configured PRD lifecycle label | **PASS** |
| `Epic` | cross-repository or source/tracker is not same-repo GitHub | PRD lifecycle label only | **FAIL** |
| `Epic` | permitted self-host shape | unconfigured `prd-*` lookalike or `prd-intake-feedback` sentinel only | **FAIL** |
| `Sub-task` | any | `type:Story`, `type:Task`, `type:Bug`, or `type:Improvement` | **PASS** |
| `Sub-task` | any | PRD lifecycle label or `type:Epic` only | **FAIL** |
| any other non-Sub-task | any | `type:Epic` | **PASS** |
| any other non-Sub-task | any | PRD lifecycle label only | **FAIL** |

#### F3 — Linked issues exist

For each entry in `links`, run `gh issue view <number> --repo <link-org>/<link-repo>` to confirm the ref resolves. Flag broken refs.

#### F4 — Required labels populated

Per `Phase 5` of `lisa-github-write-issue`, every issue MUST carry
`type:<issue_type>` and `priority:<priority>`. These two labels are unconditional: if either is
missing from the proposed spec or live issue, FAIL with the missing label name.

The `status:*` requirement uses this validator's S15 leaf/container classification while preserving
the writer's documented `build_ready` control-input defaults:

1. Classify the issue structurally using the S15 child-resolution rules. A container (any issue
   with child work, plus a childless `Epic`) may omit `status:*`; its state rolls up rather than
   being assigned directly.
2. For a proposed leaf spec, normalize omitted `build_ready` to `true`, preserving the writer's
   backward-compatible default-ready behavior. Explicit `build_ready: false` means backlog mode.
3. For a live issue ref, derive `build_ready` from the labels (`true` exactly when the S15-resolved
   `READY_ROLE` from `github.labels.build.ready`, default `status:ready`, is present). A live backlog leaf without a status label
   therefore validates as `build_ready: false`; live data cannot distinguish an explicit false from
   a historical write that omitted the label.
4. A leaf with normalized `build_ready: true` MUST carry that same resolved `READY_ROLE`. A leaf with `build_ready: false` may omit
   `status:*`.

| classification | normalized build_ready | status label | F4 |
|---|---:|---|---|
| container | any | omitted | **PASS** |
| leaf | `false` | omitted | **PASS** |
| leaf | `true` | configured build-ready role (`status:ready` by default) | **PASS** |
| leaf | `true` | omitted or a different `status:*` label | **FAIL** |

F4 does not make a container build-ready. S15 remains the independent lifecycle prohibition: any
container carrying the build-ready role still FAILs S15, even though F4's status-presence check is
not applicable to containers.

#### F5 — Required external access provable

The factory-gate rule: an input must not enter the pipeline unless the current runtime can actually
reach every external surface the work requires. Enumerate the surfaces this issue depends on:

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
- `N/A` — the issue needs nothing beyond the repository and the tracker itself.
- `FAIL` — a required surface is unreachable after the resolution attempt. Name the exact surface
  and what was probed. Intake callers must route this to `blocked` + human escalation with the
  missing access spelled out — an input the factory cannot execute never enters the factory.

Probes are read-only and bounded (seconds, not minutes, per surface); never mutate the external
system, and never invent or ask for credentials inline.

## Execution

1. Parse `$ARGUMENTS`. Resolve `READY_ROLE` from merged `github.labels.build.ready` config (default `status:ready`). If the input is an issue ref, fetch via `gh issue view --json` and derive the spec fields — including `build_ready` (label set contains the resolved `READY_ROLE`, not a hard-coded label) and `child_refs` (native sub-issues plus body task-list / `Blocked by #<n>` parentage, resolved as in `lisa-github-read-issue`) so S15 can classify the issue. Otherwise parse the YAML spec and preserve the proposed `build_ready` value for S15/F4 normalization.
2. Confirm `gh auth status` succeeds before any feasibility gate runs.
3. Run every Specification gate in order. Collect PASS / FAIL / N/A with a one-line reason.
4. Unless the caller passed `--spec-only`, run every Feasibility gate.
5. Emit the report below.

## Output

Output is a single fenced text block. Callers parse it; do not add free-form prose around it.

```text
## github-validate-issue: <ISSUE-REF-or-SUMMARY>

### Specification Gates
- [PASS|FAIL|N/A] S1 Required core fields — <one-line reason>
- [PASS|FAIL|N/A] S2 Summary format — <one-line reason>
- [PASS|FAIL|N/A] S3 Description three audiences — <one-line reason>
- [PASS|FAIL|N/A] S4 Acceptance criteria in Gherkin — <one-line reason>
- [PASS|FAIL|N/A] S5 Bug-specific content — <one-line reason>
- [PASS|FAIL|N/A] S6 Spike-specific content — <one-line reason>
- [PASS|FAIL|N/A] S7 Parent sub-issue declared — <one-line reason>
- [PASS|FAIL|N/A] S8 Target Backend Environment — <one-line reason>
- [PASS|FAIL|N/A] S9 Sign-in Required — <one-line reason>
- [PASS|FAIL|N/A] S10 Single-repo scope — <one-line reason>
- [PASS|FAIL|N/A] S11 Validation Journey — <one-line reason>
- [PASS|FAIL|N/A] S12 Source Precedence — <one-line reason>
- [PASS|FAIL|N/A] S13 Relationship Search — <one-line reason>
- [PASS|FAIL|N/A] S14 Evidence manifest binding — <one-line reason>
- [PASS|FAIL|N/A] S15 Leaf-only build-ready — <one-line reason>
- [PASS|FAIL|N/A] S16 Source Requirement traceability — <one-line reason>

### Feasibility Gates  (omit this section when --spec-only)
- [PASS|FAIL|N/A] F1 Issue type label exists in repo — <one-line reason>
- [PASS|FAIL|N/A] F2 Parent sub-issue exists and is the right type — <one-line reason>
- [PASS|FAIL|N/A] F3 Linked issues exist — <one-line reason>
- [PASS|FAIL|N/A] F4 Required labels populated — <one-line reason>
- [PASS|FAIL|N/A] F5 Required external access provable — <one-line reason>

### Verdict: PASS | FAIL
### Failures: <count>
### Failure details
- gate: <gate-id>
  category: <product-clarity|acceptance-criteria|design-ux|scope|dependency|data|technical|structural>
  product_relevant: <true|false>
  what: <plain-language description, no gate IDs, no GitHub jargon — written for a non-engineer product owner>
  recommendation: <1–3 concrete options the caller (or downstream product team) can pick from. Never "clarify this".>
- gate: <gate-id>
  ...
```

The verdict is `PASS` if every applicable gate is `PASS`. Any `FAIL` makes the verdict `FAIL`. `N/A` does not affect the verdict.

### Failure-detail fields

Same shape and meaning as `lisa-jira-validate-ticket` so downstream PRD-intake skills (Notion, Confluence, Linear, GitHub) can format comments uniformly:

- **gate**: the gate ID (`S1`–`S15`, `F1`–`F5`).
- **category**: the gate's fixed category from the table.
- **product_relevant**: matches the gate's table entry. `false` means the failure is an internal data-quality problem the caller should fix without bothering product.
- **what**: plain-language, product-readable.
- **recommendation**: 1–3 concrete options.

## Rules

- Never write to GitHub. The `allowed-tools` list intentionally excludes any `gh issue create / edit / comment / close` invocation.
- Never auto-fix the spec. This skill reports gaps; callers decide what to do.
- Never silently skip a gate. Return `N/A` with the reason if a gate genuinely doesn't apply; never omit it.
- The `what` and `recommendation` must be concrete and product-readable — vague guidance ("clarify this") is useless.
- Never emit a category outside the fixed set.
- `product_relevant` is determined by the gate, not by the failure context.
- When validating an existing issue ref, parse the body via the same logic as `lisa-github-read-issue` so the two skills agree on what they see.

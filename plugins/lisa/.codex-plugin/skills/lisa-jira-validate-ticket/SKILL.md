---
name: lisa-jira-validate-ticket
description: "Validates a proposed JIRA…"
allowed-tools: ["Bash", "Skill"]
---

# Validate JIRA Ticket: $ARGUMENTS

All Atlassian operations in this skill go through `lisa-atlassian-access`. Do not call MCP tools or `acli` directly.

Run all organizational quality gates against a ticket spec OR an existing ticket. **This skill is read-only — it never writes to JIRA.** The output is a structured report consumed by callers (`lisa-jira-write-ticket` for pre-write gating, `lisa-notion-to-tracker` for PRD dry-run, `lisa-jira-verify` for post-write checks).

## Input

`$ARGUMENTS` is one of:

1. **An existing ticket key** (e.g. `PROJ-1234`): fetch it and validate the live state. Use this for post-write checks.
2. **A proposed ticket spec** (YAML block, see schema below): validate as-is without touching JIRA. Use this for pre-write and dry-run checks.

### Spec schema

Specs are passed as a fenced YAML block. Required keys depend on `issue_type`.

```yaml
issue_type: Story          # Story | Task | Bug | Epic | Spike | Sub-task | Improvement
project_key: SE
summary: "[CU-1.2] Upload contract PDF from settings"
priority: Medium
parent_key: SE-1234        # Epic key for non-Bug/non-Epic; Story key for Sub-task
description: |             # Full description text — every required section
  h2. Context / Business Value
  ...

  h2. Technical Approach
  ...

  h2. Acceptance Criteria
  # Given <precondition>
    When <action>
    Then <observable outcome>

  h2. Out of Scope
  ...

  h2. Target Backend Environment
  dev

  h2. Sign-in Required
  Account: ...

  h2. Repository
  backend-api

  h2. Validation Journey
  ...

# Behavioral flags — caller asserts these so the validator can pick the right gates
# (on a LIVE item `runtime_behavior_change` is DERIVED from the stored declaration, not taken on assertion — S8)
runtime_behavior_change: true     # → requires Target Backend Environment + Validation Journey; LIVE items derive it from the stored declaration instead (S8)
authenticated_surface: true       # → requires Sign-in Required
artifacts_attached: true          # → requires Source Precedence section
links: [{ key: "PROJ-99", type: "is blocked by" }]   # known issue links (may be empty)
remote_links: [{ url: "https://github.com/...", title: "PR #42" }]
build_ready: true                 # caller asserts the build-ready role (status:ready) is/would be applied — see S15
child_refs: ["PROJ-601", "PROJ-602"]   # known child work (sub-tasks / "is blocked by" parentage) — see S15
prd_source: "https://notion.so/..."    # set when the ticket was generated from a PRD — requires the Source Requirement section, see S16
```

If the caller passes only a ticket key, fetch the ticket via `lisa-atlassian-access` `operation: read-ticket key: <KEY>`, derive the same fields from the fetched data — including `runtime_behavior_change` (derived from the `Target Backend Environment` declaration per `derived-branch-plan`, and authoritative over any caller assertion), `build_ready` (label set contains the resolved `READY_ROLE` — merged `jira.workflow.ready`, default `status:ready` — never a hard-coded label) and `child_refs` (sub-tasks plus `is blocked by` parentage, resolved as in `lisa-jira-read-ticket`) so S15 can classify the ticket — then run gates.

## Gates

Gates are grouped into **Specification** (spec-only checks, no JIRA lookups) and **Feasibility** (requires JIRA lookups). The dry-run path may opt to run Specification gates only; the write path runs both.

Each gate is tagged with a fixed `category` and a `product_relevant` boolean. Categories drive how downstream callers (notably `lisa-notion-prd-intake`) translate failures into product-facing comments; `product_relevant=false` failures indicate internal data-quality problems (broken parent links, missing core fields) that the agent should fix itself rather than ask product to clarify.

Per-type content requirements are defined once in the vendor-neutral `work-item-definition-of-ready` rule (eager + reference); gates S4–S6 and S17 enforce them, and S18 enforces the stateless-pickup property directly.

| Gate | Category | Product-relevant |
|------|----------|------------------|
| S1 Required core fields | `structural` | false |
| S2 Summary format | `structural` | false |
| S3 Description three audiences | `product-clarity` | true |
| S4 Acceptance criteria in Gherkin | `acceptance-criteria` | true |
| S5 Bug-specific content | `product-clarity` | true |
| S6 Spike-specific content | `scope` | true |
| S7 Epic parent declared | `structural` | false |
| S8 Target Backend Environment | `technical` | false |
| S9 Sign-in Required | `technical` | false |
| S10 Single-repo scope | `scope` | false |
| S11 Validation Journey | `acceptance-criteria` | true |
| S12 Source Precedence | `design-ux` | true |
| S13 Relationship Search | `dependency` | true |
| S14 Evidence manifest binding (leaf work units) | `acceptance-criteria` | true |
| S15 Leaf-only build-ready | `structural` | false |
| S16 Source Requirement traceability | `product-clarity` | true |
| S17 Improvement measurability | `acceptance-criteria` | true |
| S18 Stateless-pickup dry-run | `product-clarity` | true |
| S19 Branch Plan derivation | `technical` | false |
| S20 Named-control reachability | `acceptance-criteria` | true |
| F1 Issue type valid in project | `structural` | false |
| F2 Epic parent exists and is an Epic | `structural` | false |
| F3 Linked tickets exist | `structural` | false |
| F4 Required custom fields populated | `structural` | false |
| F5 Required external access provable | `technical` | true |

Category values are drawn from this fixed set:

- `product-clarity` — feature behavior or user intent unclear in the PRD
- `acceptance-criteria` — pass/fail conditions missing or ambiguous
- `design-ux` — visual or interaction spec missing
- `scope` — boundary unclear, items overlap, split needed
- `dependency` — blocked by another team / system / decision
- `data` — data source / shape / volume unspecified
- `technical` — engineering decision required (rare from PRD path; mostly internal)
- `structural` — internal data-quality problem the agent must fix itself, not surface to product

### Specification Gates

#### S1 — Required core fields

`project_key`, `issue_type`, `summary`, `priority`, `description` must all be present and non-empty.

#### S2 — Summary format

- Single line, ≤ 100 characters
- Imperative voice ("Add X", "Fix Y", not "Adding X" or "X is broken")
- Bug / Task / Sub-task summaries SHOULD start with a `[repo-name]` prefix when the project convention uses one

#### S3 — Description has all three audiences

Description text must include all of these sections. For proposed specs, detect case-insensitive Markdown/wiki headings (`##` or `h2.`). For live JIRA tickets, extract section headings from ADF `heading` nodes first and fail if the description is one literal Markdown/wiki paragraph instead of structured ADF heading nodes:
- `Context / Business Value` — stakeholder-facing
- `Technical Approach` — developer-facing
- `Acceptance Criteria` — coding-assistant-facing
- `Out of Scope` — explicit non-coverage list

Missing any → FAIL with name of missing section.

#### S4 — Acceptance criteria in Gherkin

Applies when `issue_type ∈ {Story, Task, Bug, Sub-task, Improvement}`.

The `Acceptance Criteria` section must contain at least one criterion in `Given / When / Then` form. Reject prose-only criteria, "should work" language, or numbered lists without Given/When/Then verbs.

#### S5 — Bug-specific content

When `issue_type = Bug`, description must additionally include the full bug anatomy from the `work-item-definition-of-ready` rule:

- **Agent-executable reproduction** — numbered steps a stateless agent can run mechanically: exact entry point, named account/role (consistent with Sign-in Required when authenticated), concrete data state, exact actions. Human-followable-only prose ("click around until it breaks") FAILs. A linked failing test satisfies this outright and is the preferred form.
- **Expected vs. actual behavior**, naming or linking the *source* of "expected" (spec, PRD requirement, prior release behavior) — a fix target is a fact, not an opinion.
- **Environment + version** — where reproduced and the build/commit observed; last-known-good when known (`unknown` must be stated, not omitted).
- **Reproducibility rate** — always, or intermittent with observed frequency; intermittent invalidates run-once verification.
- **Occurrence evidence** — at least one link/attachment: error-tracker issue, log excerpt, stack trace, screenshot/recording.

A Bug's terminal state is its reproduction: the same steps (or test) fail before the fix and pass after — capture both as evidence: under the S14 manifest when `runtime_behavior_change = true`, or attached directly to the item for non-runtime Bugs (doc/config fixes), where S14 is N/A.

#### S6 — Spike-specific content

When `issue_type = Spike`, description must include:

- The **question** being answered
- The **decision** the answer enables, and the options being weighed
- A **timebox**
- **Deliverable format and location** — decision doc / prototype / findings page, and where it will live, so the terminal state — a deliverable at that location that actually answers the question, with findings, decision and options — is checkable

Gherkin AC is intentionally N/A for Spikes (S4).

#### S7 — Epic parent declared

When `issue_type ∉ {Bug, Epic}`, `parent_key` must be set — **except for a build-ready leaf work unit**, which may stand alone. A flat `Task` / `Improvement`, or a childless `Story` / `Spike` (no open child work) with `build_ready = true`, is an independently claimable leaf per `leaf-only-lifecycle`, which states such leaves "must not be stranded"; for these a missing parent is `N/A`, not a FAIL. This mirrors the leaf carve-out already in S10/S15. A `Sub-task` is exempt from this exception — it always requires a parent. (Validity of a declared parent key is checked in feasibility gates.)

#### S8 — Target Backend Environment

Every leaf work unit carries a `Target Backend Environment` section in the description (`h2.` / `##` in proposed text, or an ADF heading in live JIRA). The section is where `runtime_behavior_change` is persisted, so it is rendered for exempt work too — see the declaration grammar at the end of this gate. Read accepted environments from the exact configured keys of `.lisa.config.json` `deploy.branches`, never from a hardcoded list. Accept a human-confirmed bare exact configured key or `Confirmed: <env>`, automated `Inferred: <env> — evidence: <title|body|reproduction|hostname>`, automated `Assumption: <env> — remote default branch <branch>` for a unique reverse-map, or `Assumption: remote default branch <branch>` when no unique reverse-map exists. Human confirmation replaces an automated annotation with the bare key or `Confirmed: <env>`. For legacy bare values, use managed draft markers and current ticket content only; provider edit history is not required. A marker proves automation and requires re-annotation; otherwise unknown provenance plus conflicting evidence fails for confirmation. Validate the annotation shape/source and remote-default branch; validate `<env>` as an exact configured key whenever present. A valid branch-only assumption must not fail solely because its reverse-map is absent or ambiguous. Normalize built-in `prod` ↔ `production` only when exactly one of those keys is configured. No other aliases are valid.

**The section persists `runtime_behavior_change`, so it is never simply skipped.** Work that changes no runtime behavior declares the exemption in place of an environment: `None — no runtime behavior change: doc-only` (or `config-only` / `type-only`). A container (an Epic, or any ticket holding child work) declares `None — container: state rolls up from children`. The `None —` prefix is the machine discriminator; the words after it are for the human reading the ticket.

Derive the flag from the stored content, never from a caller's word about a live ticket: an exact configured environment key means `true`, a `None —` declaration means `false`, and an **absent section means underivable** — never `false`. On a live ticket the stored declaration is authoritative, so a caller asserting a `runtime_behavior_change` that contradicts it **FAILs** this gate naming both values rather than silently preferring either; one of the two is wrong, and picking one quietly is how an unauditable gate gets built. A **proposed spec** with no section **FAILs** — `lisa-jira-write-ticket` must render it before the write. A **live legacy ticket** with no section is `N/A` with a repair note routed to claim time: the same asymmetry S19 uses, for the same reason, because failing every existing ticket would turn a legacy queue red for a section no human had a way to add.

#### S9 — Sign-in Required

When `authenticated_surface = true`, description must contain `h2. Sign-in Required` naming the account/role and credential source (1Password item, env var, seeded fixture).

If the spec doesn't set `authenticated_surface`, infer it: scan the description and AC for sign-in / login / "as a {role} user" / authenticated route signals. If signals present and no `Sign-in Required` section: FAIL.

#### S10 — Repository section, single-repo scope

When `issue_type ∈ {Bug, Task, Sub-task, Improvement}` — or a **build-ready childless Story/Spike** (a claimable leaf per `leaf-only-lifecycle`) — description must contain a `Repository` section (`h2.` / `##` in proposed text, or an ADF heading in live JIRA) naming exactly one repo. Multiple repos OR cross-repo references in AC: FAIL with recommendation `"Split into per-repo work units under a shared parent Story (see lisa-task-decomposition step 1.5)"`.

An **Epic**, or a **Story/Spike that still holds child work** (or is not build-ready): skipped (may span repos — coordination containers, not claimable leaf work units).

This gate is `product_relevant: false` because cross-repo work units are not a product question — they are a decomposition error. Callers (`lisa-notion-to-tracker`, `lisa-confluence-to-tracker`, `lisa-linear-to-tracker`, `lisa-github-to-tracker`) MUST pre-split cross-repo work into per-repo work units during the decomposition phase per `lisa-task-decomposition` step 1.5; an S10 failure here indicates the agent skipped that step and must auto-split + revalidate before writing, not surface a clarifying comment to product.

#### S11 — Validation Journey present

When `runtime_behavior_change = true`, description must contain a `Validation Journey` section (`h2.` / `##` in proposed text, or an ADF heading in live JIRA). Skipped for doc-only / config-only / type-only / Epic. When `runtime_behavior_change` is **underivable** — a live legacy ticket whose description carries no Target Backend Environment declaration (S8) — this gate is `N/A` with the same repair note rather than `PASS`, because a requirement conditioned on a flag nobody recorded cannot be asserted either way.

The caller controls the strictness by passing `journey_followup: "auto"` or `journey_followup: "none"` in the spec:
- `auto` (default): if the section is absent, return `FAIL` with remediation `"Invoke lisa-jira-add-journey to append the section after create"`. Callers like `lisa-jira-write-ticket` know to chain `lisa-jira-add-journey` automatically, so this counts as a fixable failure they can resolve in-line — they re-run validation after appending.
- `none`: missing section is a `FAIL` that the caller will not auto-fix, so the verdict gates progress (used by dry-run paths like `lisa-notion-to-tracker` PRD intake, where there's no agent standing by to add the journey).

Either way the gate emits `FAIL`, not a third state. Strictness is the caller's policy, not the validator's.

#### S12 — Source Precedence (when artifacts attached)

When `artifacts_attached = true`, description must include source-precedence guidance covering: business rules → PRD body, visual treatment → mocks, flow → prototypes, API/data → data artifacts. Cross-axis conflicts surfaced under `## Open Questions`.

Accept either placement — both are valid per `lisa-tracker-source-artifacts`:
- A dedicated `## Source Precedence` (or `h2. Source Precedence`) subsection, OR
- A "Source Precedence" / "source precedence" / "authoritative source" paragraph under `Technical Approach` that covers the four axes above.

Detect by scanning for the phrase `Source Precedence` (case-insensitive) anywhere in the description, AND verifying the four axes (business rules, visual, flow, data) are each named. Missing the phrase OR missing one or more axes: FAIL with a remediation that names the missing axes.

If the spec doesn't set `artifacts_attached`, infer it the same way S9 infers sign-in: scan the description for design/mock/prototype/data-artifact references (design-tool links, "mock", "prototype", spreadsheet or API artifacts). If such artifacts are referenced and no source-precedence guidance exists: FAIL.

#### S13 — Relationship Search documented

The ticket must EITHER have at least one issue link in `links`, OR the description / a comment must contain a `## Relationship Search` block listing the git history queries and JQL queries that were run with their outcomes ("Searched git history for `<keywords>` and JQL for component=`X`; no related work found.").

A ticket with zero links and no documented search: FAIL.

#### S14 — Evidence manifest binding (leaf work units)

When `issue_type ∈ {Bug, Task, Sub-task, Improvement}` AND `runtime_behavior_change = true`, the `h2. Validation Journey` must declare at least one **typed** `[EVIDENCE: <artifact-type>: <name>]` marker. These markers are the work unit's **evidence manifest** — the exact, enumerated set of artifacts that must be captured and attached before the ticket may be marked complete (see the "Per-Work-Unit Evidence Contract" section of the `verification` rule, the Definition of Done in `verification-lifecycle`, and the evidence-manifest gate in `tracker-evidence`).

Each marker must satisfy ALL of:

- `<artifact-type>` is one of the fixed taxonomy: `screenshot`, `recording`, `http-transcript`, `cli-output`, `log-snippet`, `db-query-output`, `perf-trace`, `test-run-log`, `deploy-log`, `state-dump`. (The legacy `[SCREENSHOT: name]` form is accepted as `screenshot`.)
- `<name>` is kebab-case and unique within the ticket.

**A marker names an artifact, not an assertion.** An untyped marker (`[EVIDENCE: load-failure-handled-gracefully]`) is an assertion label with nothing to capture and must FAIL, with a remediation that shows the typed transformation (e.g. → `[EVIDENCE: screenshot: load-failure-error-state]`, `[EVIDENCE: perf-trace: pipeline-load-tti]`).

FAIL when the Validation Journey is present but declares zero binding `[EVIDENCE: ...]` markers, when any binding marker is untyped or uses a type outside the taxonomy, or when any binding name is empty, duplicated, or not kebab-case. A behavior-changing work unit SHOULD declare both a success marker and an error/edge marker; a journey with only one binding marker passes but the remediation should recommend adding the error/edge case.

Parse claiming markers by the exact `[EVIDENCE:` prefix. A cross-work-item pointer in the canonical form `[EVIDENCE-REF: <work-item-ref> | <artifact-type>: <kebab-case-name>]` is non-claiming. The Lisa 2.223.0 form `[EVIDENCE-REF: <tracker-ref>: <artifact-type>: <kebab-case-name>]` is also accepted as a legacy non-claiming alias; parse it from the right so the final two fields are type/name and a tracker URL may contain `:`. Exclude both forms from the manifest, S14's minimum-marker count, local marker type/name validation, and duplicate-name checks. Independently validate every `EVIDENCE-REF`: the native work-item reference must be non-empty and unambiguous, the artifact type must use the fixed taxonomy, and the name must be non-empty kebab-case. A malformed reference FAILs S14 as an invalid pointer but never becomes a local evidence obligation. A valid canonical or legacy reference may point to a sibling's artifact, but it never satisfies S14 for this ticket. Therefore a runtime-changing leaf whose journey contains only `EVIDENCE-REF` entries FAILs S14 for zero local claiming markers, not because a valid legacy reference is malformed. Quoting or code-formatting another ticket's `[EVIDENCE: ...]` marker does not make it a reference; writers must convert it to the canonical pipe form.

This gate depends on S11. It is `N/A` for containers — an **Epic**, or any item with open child work (coordination containers, not work units) — and for leaf units with `runtime_behavior_change = false` (doc-only / config-only / type-only). If S11 fails because the Validation Journey is absent, S14 also FAILs (there is no manifest to bind) with remediation pointing back to `lisa-jira-add-journey`. It is likewise `N/A` with a repair note when `runtime_behavior_change` is **underivable** under S8 — reading an absent declaration as `false` is exactly the silent assumption that made this gate unauditable on a live ticket.

#### S15 — Leaf-only build-ready

Enforces the build-side of the vendor-neutral `leaf-only-lifecycle` rule: **only a leaf work unit may carry the build-ready role.** This is the symmetric write-side guard for the JIRA validator — a stale or hand-applied `status:ready` label on a container is a lifecycle error and must FAIL here, regardless of how the ticket was produced. (Mirrors the "Build-ready label is leaf-only" rule that `lisa-jira-write-ticket` applies at write time.)

**When the gate applies.** Run S15 whenever the ticket is build-ready — i.e. `build_ready = true`, or the spec/live labels include `status:ready`. If the ticket is not build-ready, S15 is `N/A` (nothing claims a non-ready ticket, so the invariant is vacuous).

**Resolve container vs. leaf — structural first, then nominal.** Per `leaf-only-lifecycle` the classification is structural: an item is a **container** if it has child work, whatever its declared type; otherwise the **issue type** decides. Determine child work from (in order) `child_refs`, native sub-tasks, and `is blocked by` / parent references — the same hierarchy resolution `lisa-jira-read-ticket` uses. When validating a live key, query sub-tasks alongside the ticket fetch.

Apply this decision and FAIL the two invariant-violating cases:

1. **Container with child work + build-ready** — child work is present (any type that has open children), AND build-ready. FAIL. A parent organizes work; it is never claimed and implemented directly. Its lifecycle state rolls up from its children.
2. **Childless Epic + build-ready** — `issue_type = Epic` with **no** child work, AND build-ready. Still FAIL: an Epic is a pure rollup container by design, and a childless one is an incomplete decomposition or a mis-applied role, not an implementable unit. (A childless Story or Spike is **not** failed here — the childless-parent exception in `leaf-only-lifecycle` promotes every childless non-Epic type to a build-ready leaf.)

PASS (the childless-parent exception) when the ticket is build-ready and is a **leaf work unit**: it has **no** open child work and `issue_type ≠ Epic` (i.e. `Bug, Task, Sub-task, Improvement`, or a childless `Story` / `Spike`). A flat Task/Bug, or a childless Story/Spike with no sub-tasks, is a valid build-ready leaf and must not be stranded.

| issue_type | has child work | build-ready | S15 |
|---|---|---|---|
| Bug / Task / Sub-task / Improvement / Story / Spike | no | yes | **PASS** (leaf) |
| any type | yes | yes | **FAIL** (structurally a container) |
| Epic | no | yes | **FAIL** (childless Epic — pure rollup container, exception does not apply) |
| any | any | no | **N/A** (not build-ready) |

Remediation: `"Build-ready is leaf-only per leaf-only-lifecycle. Move the build-ready role off this container onto its leaf children (or, for a childless Epic, decompose it into leaf children or reclassify it to a leaf type); a parent's lifecycle state rolls up from its children and is never set to ready directly."`

`product_relevant: false` — a build-ready container is a lifecycle/decomposition error for the caller to repair, not a product question.

#### S16 — Source Requirement traceability (PRD-sourced tickets)

Answers "why was this done?": every ticket generated from a PRD must carry
the requirement it exists to satisfy, quoted verbatim, at every level of
the hierarchy — sub-tasks included, so a leaf claimed by build-intake in
isolation is self-explanatory.

**When the gate applies.** Run S16 whenever the spec declares `prd_source`
(all `*-to-tracker` decomposition paths set it). Without `prd_source`
(ad-hoc tickets with no PRD lineage) the gate is `N/A` — but if a
`Source Requirement` section is present anyway, still validate its shape
so a malformed section never passes silently.

**What must be present.** A `Source Requirement` section (`h2.` / `##` in
proposed text, or an ADF heading in live JIRA) containing:

1. A link to the source PRD (the `**PRD**:` line), and
2. At least one `**Requirement` line with **verbatim quoted text**, or the
   explicit derived-work form (`Derived work supporting R3, R7 — no single
   PRD section.`).

Missing section, missing PRD link, empty/paraphrased requirement text
(quotes shorter than a few words, or prose with no quotation), or a bare
R-id with no quote: FAIL with remediation
`"Add a Source Requirement section citing the PRD link and quoting the requirement(s) this ticket satisfies verbatim (see the Source Requirement shared format in the *-to-tracker skills). Derived work must name the requirements it supports."`

`product_relevant: true` — a ticket whose requirement cannot be traced is
a product-clarity problem: nobody can tell why the work exists.

#### S17 — Improvement measurability

When `issue_type = Improvement`, the description must define the improvement as a measured delta per `work-item-definition-of-ready`:

- **Metric + measurement method** the agent can run (command, query, dashboard export)
- **Baseline** — the current measured value (a number, not an adjective)
- **Target** — the numeric value or bound that defines done

Without a baseline and a target an Improvement has no verifiable terminal state and can never be autonomously closed. FAIL names the missing pieces; when no baseline exists yet, the remediation is to file measuring it as the first step. `N/A` for every other type.

#### S18 — Stateless-pickup dry-run

The autonomy gate, run last, on every build-ready leaf (use the S15 classification; `N/A` for containers and non-build-ready items). Simulate a stateless agent reading only this item and the links it can resolve — session knowledge about the codebase does not count, because the next claimant will not have it. List every question that agent would have to ask a human before starting work, before choosing between materially different implementations, or before declaring the work done.

Zero questions → PASS. Any question → FAIL, with each question listed verbatim as its own remediation line — these are exactly the clarifying comments the caller posts to the source. The structure gates are proxies; this gate checks the readiness property itself: `ready` means a stateless agent can drive this item to its terminal state with zero human clarification (see `work-item-definition-of-ready`).

#### S19 — Branch Plan derivation

Enforces the `derived-branch-plan` rule: the `Branch Plan` section (`h2.` / `##` in proposed text, or an ADF heading in live JIRA) is **derived only** — recompute it from current config and compare; never trust the rendered branches or read them as input. Resolve the environment under the S8 grammar, map that exact configured key forward through `.lisa.config.json` `deploy.branches`, and require the mapped branch on the remote.

| Case | Verdict |
|---|---|
| `runtime_behavior_change = false` (doc-only / config-only / type-only) or an Epic/container, with no plan | `N/A` — absence is correct; never demand one |
| Exempt work **carrying** a `Branch Plan` | **FAIL** — hand-authored branches on work that declared no runtime target |
| `runtime_behavior_change` **underivable** (live legacy item, no Target Backend Environment declaration) | `N/A` with a repair note — absence is never read as `false` |
| Plan matches the recomputed plan | PASS |
| Plan conflicts with the recomputed plan | **FAIL** |
| Plan missing the `Derived from:` provenance line and disagreeing | **FAIL** — treated as hand-authored |
| `Branch from` and `PR into` name two different branches | **FAIL** — malformed; they are the same branch by construction |
| Derivation hits a stop condition (env absent from `deploy.branches`, ambiguous / non-unique mapping, branch missing on the remote) | **FAIL** — the same stop `lisa-implement` takes; never default to `main` or the remote default |
| Proposed spec (pre-write) for applicable work with no plan | **FAIL** — `lisa-jira-write-ticket` must render it before the write |
| Live **legacy** ticket for applicable work with no plan | `N/A` with a repair note — routed to claim time, where `lisa-implement` writes the derived assumption as a comment and proceeds |

Failing a proposed spec is free; failing every existing ticket would turn a legacy queue red for a section no human had a way to add, so legacy absence is repaired at claim time instead.

FAIL names both plans (rendered and recomputed) and points the remediation at **the environment, never the branch** — e.g. `"Branch Plan conflicts with the environment mapping. Rendered 'Branch from: release/staging'; recomputed from Target Backend Environment 'production' via deploy.branches → 'main'. Correct the environment, not the branch — the branches are derived. Then re-render."` Never silently choose between the two plans.

#### S20 — Named-control reachability

Enforces the vendor-neutral `control-reachability` rule: **a work item that names an existing test as a red-before-green control must say what makes that test reach the code the change touches.** A control whose reachability cannot be stated is not a control — its green tells the implementer nothing, and the ticket's own stopping rule then instructs a revert of a correct fix.

**When the gate applies.** Run S20 when the body — `Acceptance Criteria`, `Technical Approach`, or `Validation Journey` — names an **existing** test AND predicts a state change for it when the work lands. Signals: "must go red", "currently passes and must fail", "fails before the fix and passes after", "if it still passes the fix did nothing", or any equivalent stopping rule.

**When it must stay silent.** `N/A` otherwise. A ticket that introduces a **new** test rather than pinning an existing one carries no reachability obligation and must never be reported as incomplete on this basis. This half is load-bearing: a gate that fires on every work item is one callers learn to route around.

**What must be present.** One marker per named control, inside `h2. Validation Journey`:

```text
[CONTROL: <test-identifier> | reaches: <input-or-field>]
```

Parse by the exact `[CONTROL:` prefix and split on the single `|`.

- `<test-identifier>` — non-empty; the test file path, the test name, or both. It must be enough to run the test.
- `reaches:` — the literal key, then a non-empty description of the **input, field, fixture key, argument, or state** that carries execution into the changed code.

FAIL when a named existing-test control has no marker, when a marker is malformed (missing the `|`, an empty identifier, a missing or empty `reaches:` half), or when the `reaches:` half restates the assertion instead of naming an input (`reaches: the fix`, `reaches: the changed code path`). Naming the code is not enough; the marker answers "what in this fixture gets execution there".

Remediation: `"Name the input or field that makes <test> reach the code this work changes, as [CONTROL: <test> | reaches: <field>]. If the fixture does not reach it, the test cannot observe this change — extend the fixture or specify a new test instead."`

`product_relevant: true` — an unfalsifiable stopping rule is a specification defect, and whoever wrote the ticket is who can repair it. `lisa-jira-write-ticket` renders the marker; `control-reachability` carries the implementer-side counterpart, which forbids acting on the stopping rule before the cause of an unmoved control is established.

### Feasibility Gates (require JIRA lookups; skip in dry-run if requested)

#### F1 — Issue type valid in project

Invoke `lisa-atlassian-access` to fetch issue-type metadata for `project_key` and confirm `issue_type` exists.

#### F2 — Epic parent exists and is an Epic

When `parent_key` is set for non-Sub-task: fetch via `lisa-atlassian-access` `operation: read-ticket key: <parent_key>`, confirm the issue type is `Epic`. For Sub-task, confirm the parent is a non-Sub-task in the same project.

#### F3 — Linked tickets exist

For each entry in `links`, invoke `lisa-atlassian-access` `operation: read-ticket key: <link.key>` to confirm the key resolves. Flag broken keys.

#### F4 — Required custom fields populated

Use the same project-issue-type-metadata lookup from F1 (via `lisa-atlassian-access`) to learn required custom fields for the issue type. Any required custom field not provided in the spec: FAIL.

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

1. Parse `$ARGUMENTS`. If it's a ticket key, fetch the ticket via `lisa-atlassian-access` `operation: read-ticket` and derive the spec from the fetched fields — including `runtime_behavior_change` (from the `Target Backend Environment` declaration: an exact configured environment key → `true`, a `None —` declaration → `false`, an absent section → **underivable**, never `false`), `build_ready` (label set contains the resolved `READY_ROLE` — merged `jira.workflow.ready`, default `status:ready` — never a hard-coded label) and `child_refs` (sub-tasks plus `is blocked by` parentage, resolved as in `lisa-jira-read-ticket`) so S15 can classify the ticket. When the fetched description is ADF, walk the document tree and extract section headings from ADF `heading` nodes, then collect the text between heading nodes for section-specific gates. If the fetched description is a single paragraph containing literal Markdown/wiki heading markers, treat that as a formatting failure rather than accepting substring matches. Otherwise parse the YAML spec.
2. If any feasibility gate will run, invoke `lisa-atlassian-access` `operation: list-sites` once to confirm the configured site is reachable (it enforces connection match against `.lisa.config.json`).
3. Run every Specification gate in order. Collect PASS / FAIL / N/A with a one-line reason.
4. Unless the caller passed `--spec-only` (dry-run), run every Feasibility gate. Collect results.
5. Emit the report below.

## Output

Output is a single fenced text block. Callers parse it; do not add free-form prose around it.

```text
## jira-validate-ticket: <TICKET-KEY-or-SUMMARY>

### Specification Gates
- [PASS|FAIL|N/A] S1 Required core fields — <one-line reason>
- [PASS|FAIL|N/A] S2 Summary format — <one-line reason>
- [PASS|FAIL|N/A] S3 Description three audiences — <one-line reason>
- [PASS|FAIL|N/A] S4 Acceptance criteria in Gherkin — <one-line reason>
- [PASS|FAIL|N/A] S5 Bug-specific content — <one-line reason>
- [PASS|FAIL|N/A] S6 Spike-specific content — <one-line reason>
- [PASS|FAIL|N/A] S7 Epic parent declared — <one-line reason>
- [PASS|FAIL|N/A] S8 Target Backend Environment — <one-line reason>
- [PASS|FAIL|N/A] S9 Sign-in Required — <one-line reason>
- [PASS|FAIL|N/A] S10 Single-repo scope — <one-line reason>
- [PASS|FAIL|N/A] S11 Validation Journey — <one-line reason>
- [PASS|FAIL|N/A] S12 Source Precedence — <one-line reason>
- [PASS|FAIL|N/A] S13 Relationship Search — <one-line reason>
- [PASS|FAIL|N/A] S14 Evidence manifest binding — <one-line reason>
- [PASS|FAIL|N/A] S15 Leaf-only build-ready — <one-line reason>
- [PASS|FAIL|N/A] S16 Source Requirement traceability — <one-line reason>
- [PASS|FAIL|N/A] S17 Improvement measurability — <one-line reason>
- [PASS|FAIL|N/A] S18 Stateless-pickup dry-run — <one-line reason>
- [PASS|FAIL|N/A] S19 Branch Plan derivation — <one-line reason>
- [PASS|FAIL|N/A] S20 Named-control reachability — <one-line reason>

### Feasibility Gates  (omit this section when --spec-only)
- [PASS|FAIL|N/A] F1 Issue type valid in project — <one-line reason>
- [PASS|FAIL|N/A] F2 Epic parent exists and is an Epic — <one-line reason>
- [PASS|FAIL|N/A] F3 Linked tickets exist — <one-line reason>
- [PASS|FAIL|N/A] F4 Required custom fields populated — <one-line reason>
- [PASS|FAIL|N/A] F5 Required external access provable — <one-line reason>

### Verdict: PASS | FAIL
### Failures: <count>
### Failure details
- gate: <gate-id>
  category: <product-clarity|acceptance-criteria|design-ux|scope|dependency|data|technical|structural>
  product_relevant: <true|false>
  what: <plain-language description of what is missing or wrong, no gate-IDs, no JIRA terminology — written so a non-engineer product owner understands the issue>
  recommendation: <1–3 concrete options the caller (or downstream product team) can pick from. Never "clarify this" — always a specific suggested resolution.>
- gate: <gate-id>
  category: ...
  ...
```

The verdict is `PASS` if and only if every applicable gate is `PASS`. Any `FAIL` makes the verdict `FAIL`. `N/A` does not affect the verdict.

### Failure-detail fields

- **gate**: the gate ID (`S1`–`S20`, `F1`–`F5`).
- **category**: the gate's fixed category from the table above. Callers use this to label or filter comments — `product-clarity`, `acceptance-criteria`, `design-ux`, `scope`, `dependency`, `data`, `technical`, or `structural`.
- **product_relevant**: matches the gate's table entry. `false` means the failure is an internal data-quality problem (e.g., the agent built a malformed spec, an issue type is invalid in the project) and the caller should fix it without bothering the product team. `true` means the PRD needs product input to resolve.
- **what**: plain-language description of the issue. No gate IDs, no JIRA jargon, no engineering shorthand. A product owner reading this on a Notion comment should understand what is unclear and why.
- **recommendation**: 1–3 concrete options the reader can pick from, not a generic "please clarify." If the answer is genuinely open-ended, list the most plausible candidate resolutions you considered, even if speculative.

## Rules

- Never write to JIRA. This skill only invokes `lisa-atlassian-access` with read-only operations (`read-ticket`, `search-issues`, `list-sites`); it never calls write operations (`write-ticket`, `transition`, `comment`, `link`).
- Never auto-fix the spec. This skill reports gaps; callers decide what to do (block, ask the human, regenerate the spec).
- Never silently skip a gate. If a gate genuinely doesn't apply, return `N/A` with the reason; never omit it.
- The `what` and `recommendation` fields must be concrete and product-readable — the dry-run path turns each failure into a Notion comment, and the audience for those comments is the product team, not engineers. Vague guidance ("clarify this", "decide how to handle X") is useless; always give 1–3 candidate resolutions.
- Never emit a category outside the fixed set. If a new gate doesn't fit, propose adding the category to the taxonomy in this skill rather than inventing one inline.
- `product_relevant` is determined by the gate, not by the failure context. Do not flip it per-failure.

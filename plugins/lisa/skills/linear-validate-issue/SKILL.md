---
name: linear-validate-issue
description: "Validates a proposed Linear work item spec (Project, Issue, or sub-Issue) — or an existing Linear item — against the organizational quality gates without writing anything. Returns a structured PASS/FAIL report per gate with concrete remediation. Single source of truth for what makes a valid Linear item — both the write path (linear-write-issue runs it pre-write) and the dry-run path (linear-to-tracker runs it during PRD intake) call this skill so the bar can never drift."
allowed-tools: ["Bash", "mcp__linear-server__list_teams", "mcp__linear-server__get_team", "mcp__linear-server__list_projects", "mcp__linear-server__get_project", "mcp__linear-server__list_issues", "mcp__linear-server__get_issue", "mcp__linear-server__list_issue_labels", "mcp__linear-server__list_project_labels"]
---

# Validate Linear Work Item: $ARGUMENTS

Run all organizational quality gates against a Linear work item spec OR an existing Linear item. **This skill is read-only — it never writes to Linear.** The output is a structured report consumed by callers (`lisa:linear-write-issue` for pre-write gating, `lisa:linear-to-tracker` for PRD dry-run, `lisa:linear-verify` for post-write checks).

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
```

If the caller passes only an identifier, fetch the item via `mcp__linear-server__get_issue` (Issue) or `mcp__linear-server__get_project` (Project), derive the same fields from the fetched data, then run gates.

## Gates

Gates are grouped into **Specification** (spec-only checks, no Linear lookups) and **Feasibility** (requires Linear lookups). The dry-run path may opt to run Specification gates only; the write path runs both.

Each gate is tagged with a fixed `category` and a `product_relevant` boolean. Categories drive how downstream callers (notably `lisa:linear-prd-intake`) translate failures into product-facing comments; `product_relevant=false` failures indicate internal data-quality problems the agent should fix itself rather than ask product to clarify.

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
| S10 Single-repo scope | `scope` | true |
| S11 Validation Journey | `acceptance-criteria` | true |
| S12 Source Precedence | `design-ux` | true |
| S13 Relationship Search | `dependency` | true |
| F1 Issue type valid in team | `structural` | false |
| F2 Project parent exists and is in same team | `structural` | false |
| F3 Linked items exist | `structural` | false |
| F4 Required labels exist (or can be created) | `structural` | false |

Category values are the same fixed set as `lisa:jira-validate-ticket`:

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

#### S8 — Target Backend Environment

When `runtime_behavior_change = true`, description must contain `## Target Backend Environment` with one of `dev`, `staging`, `prod`. Skipped for doc-only / config-only / type-only / Epic.

#### S9 — Sign-in Required

When `authenticated_surface = true`, description must contain `## Sign-in Required` naming the account/role and credential source.

If the spec doesn't set `authenticated_surface`, infer it: scan the description and AC for sign-in / login / "as a {role} user" / authenticated route signals. If signals present and no `Sign-in Required` section: FAIL.

#### S10 — Repository section, single-repo scope

When `issue_type ∈ {Bug, Task, Sub-task}`, description must contain `## Repository` naming exactly one repo. Multiple repos OR cross-repo references in AC: FAIL with recommendation to split.

Story / Epic / Spike / Improvement: skipped (may span repos).

#### S11 — Validation Journey present

When `runtime_behavior_change = true`, description must contain `## Validation Journey`. Skipped for doc-only / config-only / type-only / Epic.

The caller controls strictness via `journey_followup: "auto"` or `"none"`:
- `auto` (default): missing section returns `FAIL` with remediation `"Invoke lisa:linear-add-journey to append the section after create"`. The write path auto-fixes; dry-run path leaves it as a FAIL the caller must address.
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

### Feasibility Gates (require Linear lookups; skip in dry-run if requested)

#### F1 — Issue type valid in team

For Issue types: confirm the team supports the issue type via `mcp__linear-server__get_team`. Linear issue types are typically per-team; check that the requested type exists.

For Epic (Project): confirm the team allows projects.

#### F2 — Project parent exists and is in same team

When `parent_project_id` is set: fetch via `mcp__linear-server__get_project`, confirm it exists and belongs to the configured team.

When `parent_issue_id` is set (Sub-task case): fetch via `mcp__linear-server__get_issue`, confirm the issue is non-Sub-task and in the same team / project.

#### F3 — Linked items exist

For each entry in `relations`, call `mcp__linear-server__get_issue` to confirm the identifier resolves. Flag broken identifiers.

#### F4 — Required labels exist (or can be created)

For each label referenced (`status:*`, `component:<name>`, `prd-*`), confirm via `mcp__linear-server__list_issue_labels` (or `list_project_labels` for Project labels) that it exists OR is creatable. Linear labels are team-scoped or workspace-scoped; flag if the requested scope is wrong.

## Execution

1. Parse `$ARGUMENTS`. If it's an identifier, fetch the item and derive the spec from the fetched fields. Otherwise parse the YAML spec.
2. Resolve team ID via `mcp__linear-server__list_teams({query: <teamKey>})` if any feasibility gate will run.
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

### Feasibility Gates  (omit when --spec-only)
- [PASS|FAIL|N/A] F1 Issue type valid in team — <one-line reason>
- [PASS|FAIL|N/A] F2 Project parent exists and is in same team — <one-line reason>
- [PASS|FAIL|N/A] F3 Linked items exist — <one-line reason>
- [PASS|FAIL|N/A] F4 Required labels exist (or can be created) — <one-line reason>

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

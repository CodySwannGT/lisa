---
name: jira-validate-ticket
description: "Validates a proposed JIRA ticket spec (or an existing ticket) against the organizational quality gates without writing anything. Returns a structured PASS/FAIL report per gate with concrete remediation. This is the single source of truth for what makes a valid ticket — both the write path (jira-write-ticket runs it pre-write) and the dry-run path (notion-to-tracker runs it during PRD intake) call this skill so the bar can never drift."
allowed-tools: ["Bash", "mcp__atlassian__getJiraIssue", "mcp__atlassian__searchJiraIssuesUsingJql", "mcp__atlassian__getIssueLinkTypes", "mcp__atlassian__getJiraProjectIssueTypesMetadata", "mcp__atlassian__getVisibleJiraProjects", "mcp__atlassian__getAccessibleAtlassianResources"]
---

# Validate JIRA Ticket: $ARGUMENTS

Run all organizational quality gates against a ticket spec OR an existing ticket. **This skill is read-only — it never writes to JIRA.** The output is a structured report consumed by callers (`lisa:jira-write-ticket` for pre-write gating, `lisa:notion-to-tracker` for PRD dry-run, `lisa:jira-verify` for post-write checks).

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
runtime_behavior_change: true     # → requires Target Backend Environment + Validation Journey
authenticated_surface: true       # → requires Sign-in Required
artifacts_attached: true          # → requires Source Precedence section
links: [{ key: "PROJ-99", type: "is blocked by" }]   # known issue links (may be empty)
remote_links: [{ url: "https://github.com/...", title: "PR #42" }]
```

If the caller passes only a ticket key, fetch the ticket via `mcp__atlassian__getJiraIssue`, derive the same fields from the fetched data, then run gates.

## Gates

Gates are grouped into **Specification** (spec-only checks, no JIRA lookups) and **Feasibility** (requires JIRA lookups). The dry-run path may opt to run Specification gates only; the write path runs both.

Each gate is tagged with a fixed `category` and a `product_relevant` boolean. Categories drive how downstream callers (notably `lisa:notion-prd-intake`) translate failures into product-facing comments; `product_relevant=false` failures indicate internal data-quality problems (broken parent links, missing core fields) that the agent should fix itself rather than ask product to clarify.

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
| S10 Single-repo scope | `scope` | true |
| S11 Validation Journey | `acceptance-criteria` | true |
| S12 Source Precedence | `design-ux` | true |
| S13 Relationship Search | `dependency` | true |
| F1 Issue type valid in project | `structural` | false |
| F2 Epic parent exists and is an Epic | `structural` | false |
| F3 Linked tickets exist | `structural` | false |
| F4 Required custom fields populated | `structural` | false |

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

Description text must include all of these sections (case-insensitive `h2.` headings):
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

#### S7 — Epic parent declared

When `issue_type ∉ {Bug, Epic}`, `parent_key` must be set. (Validity of the key is checked in feasibility gates.)

#### S8 — Target Backend Environment

When `runtime_behavior_change = true`, description must contain `h2. Target Backend Environment` with one of `dev`, `staging`, `prod`. Skipped for doc-only / config-only / type-only / Epic.

#### S9 — Sign-in Required

When `authenticated_surface = true`, description must contain `h2. Sign-in Required` naming the account/role and credential source (1Password item, env var, seeded fixture).

If the spec doesn't set `authenticated_surface`, infer it: scan the description and AC for sign-in / login / "as a {role} user" / authenticated route signals. If signals present and no `Sign-in Required` section: FAIL.

#### S10 — Repository section, single-repo scope

When `issue_type ∈ {Bug, Task, Sub-task}`, description must contain `h2. Repository` naming exactly one repo. Multiple repos OR cross-repo references in AC: FAIL with recommendation to split.

Story / Epic / Spike / Improvement: skipped (may span repos).

#### S11 — Validation Journey present

When `runtime_behavior_change = true`, description must contain `h2. Validation Journey`. Skipped for doc-only / config-only / type-only / Epic.

The caller controls the strictness by passing `journey_followup: "auto"` or `journey_followup: "none"` in the spec:
- `auto` (default): if the section is absent, return `FAIL` with remediation `"Invoke lisa:jira-add-journey to append the section after create"`. Callers like `lisa:jira-write-ticket` know to chain `lisa:jira-add-journey` automatically, so this counts as a fixable failure they can resolve in-line — they re-run validation after appending.
- `none`: missing section is a `FAIL` that the caller will not auto-fix, so the verdict gates progress (used by dry-run paths like `lisa:notion-to-tracker` PRD intake, where there's no agent standing by to add the journey).

Either way the gate emits `FAIL`, not a third state. Strictness is the caller's policy, not the validator's.

#### S12 — Source Precedence (when artifacts attached)

When `artifacts_attached = true`, description must include source-precedence guidance covering: business rules → PRD body, visual treatment → mocks, flow → prototypes, API/data → data artifacts. Cross-axis conflicts surfaced under `## Open Questions`.

Accept either placement — both are valid per `lisa:jira-source-artifacts`:
- A dedicated `## Source Precedence` (or `h2. Source Precedence`) subsection, OR
- A "Source Precedence" / "source precedence" / "authoritative source" paragraph under `Technical Approach` that covers the four axes above.

Detect by scanning for the phrase `Source Precedence` (case-insensitive) anywhere in the description, AND verifying the four axes (business rules, visual, flow, data) are each named. Missing the phrase OR missing one or more axes: FAIL with a remediation that names the missing axes.

#### S13 — Relationship Search documented

The ticket must EITHER have at least one issue link in `links`, OR the description / a comment must contain a `## Relationship Search` block listing the git history queries and JQL queries that were run with their outcomes ("Searched git history for `<keywords>` and JQL for component=`X`; no related work found.").

A ticket with zero links and no documented search: FAIL.

### Feasibility Gates (require JIRA lookups; skip in dry-run if requested)

#### F1 — Issue type valid in project

Call `mcp__atlassian__getJiraProjectIssueTypesMetadata` and confirm `issue_type` exists in `project_key`.

#### F2 — Epic parent exists and is an Epic

When `parent_key` is set for non-Sub-task: fetch via `mcp__atlassian__getJiraIssue`, confirm the issue type is `Epic`. For Sub-task, confirm the parent is a non-Sub-task in the same project.

#### F3 — Linked tickets exist

For each entry in `links`, call `mcp__atlassian__getJiraIssue` to confirm the key resolves. Flag broken keys.

#### F4 — Required custom fields populated

`mcp__atlassian__getJiraProjectIssueTypesMetadata` returns required custom fields for the issue type. Any required custom field not provided in the spec: FAIL.

## Execution

1. Parse `$ARGUMENTS`. If it's a ticket key, fetch the ticket and derive the spec from the fetched fields. Otherwise parse the YAML spec.
2. Resolve cloud ID via `mcp__atlassian__getAccessibleAtlassianResources` if any feasibility gate will run.
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

### Feasibility Gates  (omit this section when --spec-only)
- [PASS|FAIL|N/A] F1 Issue type valid in project — <one-line reason>
- [PASS|FAIL|N/A] F2 Epic parent exists and is an Epic — <one-line reason>
- [PASS|FAIL|N/A] F3 Linked tickets exist — <one-line reason>
- [PASS|FAIL|N/A] F4 Required custom fields populated — <one-line reason>

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

- **gate**: the gate ID (`S1`–`S13`, `F1`–`F4`).
- **category**: the gate's fixed category from the table above. Callers use this to label or filter comments — `product-clarity`, `acceptance-criteria`, `design-ux`, `scope`, `dependency`, `data`, `technical`, or `structural`.
- **product_relevant**: matches the gate's table entry. `false` means the failure is an internal data-quality problem (e.g., the agent built a malformed spec, an issue type is invalid in the project) and the caller should fix it without bothering the product team. `true` means the PRD needs product input to resolve.
- **what**: plain-language description of the issue. No gate IDs, no JIRA jargon, no engineering shorthand. A product owner reading this on a Notion comment should understand what is unclear and why.
- **recommendation**: 1–3 concrete options the reader can pick from, not a generic "please clarify." If the answer is genuinely open-ended, list the most plausible candidate resolutions you considered, even if speculative.

## Rules

- Never write to JIRA. The `allowed-tools` list intentionally excludes `createJiraIssue`, `editJiraIssue`, `createIssueLink`, `addCommentToJiraIssue`.
- Never auto-fix the spec. This skill reports gaps; callers decide what to do (block, ask the human, regenerate the spec).
- Never silently skip a gate. If a gate genuinely doesn't apply, return `N/A` with the reason; never omit it.
- The `what` and `recommendation` fields must be concrete and product-readable — the dry-run path turns each failure into a Notion comment, and the audience for those comments is the product team, not engineers. Vague guidance ("clarify this", "decide how to handle X") is useless; always give 1–3 candidate resolutions.
- Never emit a category outside the fixed set. If a new gate doesn't fit, propose adding the category to the taxonomy in this skill rather than inventing one inline.
- `product_relevant` is determined by the gate, not by the failure context. Do not flip it per-failure.

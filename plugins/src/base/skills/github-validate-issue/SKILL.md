---
name: github-validate-issue
description: "Validates a proposed GitHub Issue spec (or an existing issue) against the organizational quality gates without writing anything. Returns a structured PASS/FAIL report per gate with concrete remediation. The GitHub counterpart of lisa:jira-validate-ticket — same gate definitions, translated to the GitHub Issues data model. Single source of truth for what makes a valid GitHub Issue. Both the write path (github-write-issue runs it pre-write) and the dry-run path (github-to-tracker runs it during PRD intake) call this skill."
allowed-tools: ["Bash", "Read"]
---

# Validate GitHub Issue: $ARGUMENTS

Run all organizational quality gates against an issue spec OR an existing issue. **This skill is read-only — it never writes to GitHub.** The output is a structured report consumed by callers (`lisa:github-write-issue` for pre-write gating, `lisa:github-to-tracker` for PRD dry-run, `lisa:github-verify` for post-write checks).

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
parent_ref: "my-org/my-repo#1234"   # Parent Epic for non-Bug/non-Epic; Story for Sub-task
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
```

If the caller passes only an issue ref, fetch via `gh issue view <number> --repo <org>/<repo> --json number,title,body,labels,state,milestone,assignees`, parse the body sections, derive the spec fields, then run gates. The parser lives in `lisa:github-read-issue` (composition).

## Gates

Gates are grouped into **Specification** (spec-only checks, no GitHub lookups) and **Feasibility** (requires GitHub lookups). The dry-run path may opt to run Specification gates only via `--spec-only`; the write path runs both.

Each gate is tagged with a fixed `category` and a `product_relevant` boolean. Categories are the same fixed set used by `lisa:jira-validate-ticket` so downstream PRD-intake comment-formatting policy is shared across vendors.

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
| S10 Single-repo scope | `scope` | true |
| S11 Validation Journey | `acceptance-criteria` | true |
| S12 Source Precedence | `design-ux` | true |
| S13 Relationship Search | `dependency` | true |
| F1 Issue type label exists in repo | `structural` | false |
| F2 Parent sub-issue exists and is the right type | `structural` | false |
| F3 Linked issues exist | `structural` | false |
| F4 Required labels populated | `structural` | false |

Category values are the same fixed set as `lisa:jira-validate-ticket`:

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

When `issue_type ∉ {Bug, Epic}`, `parent_ref` must be set. The native sub-issue link is set by `lisa:github-write-issue` Phase 6 step 3. (Validity of the parent is checked in feasibility gate F2.)

#### S8 — Target Backend Environment

When `runtime_behavior_change = true`, body must contain `## Target Backend Environment` with one of `dev`, `staging`, `prod`. Skipped for doc-only / config-only / type-only / Epic.

#### S9 — Sign-in Required

When `authenticated_surface = true`, body must contain `## Sign-in Required` naming the account/role and credential source.

If the spec doesn't set `authenticated_surface`, infer it: scan the body and AC for sign-in / login / "as a {role} user" / authenticated route signals. If signals present and no `Sign-in Required` section: FAIL.

#### S10 — Repository section, single-repo scope

When `issue_type ∈ {Bug, Task, Sub-task}`, body must contain `## Repository` naming exactly one repo. Multiple repos OR cross-repo references in AC: FAIL with recommendation to split into per-repo issues under a shared Epic.

(GitHub Issues live in one repo by definition, so the `## Repository` section is technically redundant — keep it for parity with the JIRA path so downstream tooling sees the same shape.)

Story / Epic / Spike / Improvement: skipped (may span repos).

#### S11 — Validation Journey present

When `runtime_behavior_change = true`, body must contain `## Validation Journey`. Skipped for doc-only / config-only / type-only / Epic.

The caller controls strictness via `journey_followup`:
- `auto` (default): missing section is FAIL with remediation `"Invoke lisa:github-add-journey to append the section after create"`. Callers like `lisa:github-write-issue` know to chain the followup automatically.
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

### Feasibility Gates (require GitHub lookups; skip in `--spec-only`)

#### F1 — Issue type label exists in repo

```bash
gh label list --repo <org>/<repo> --json name --jq '.[].name'
```

Confirm `type:<issue_type>` exists. Missing labels can be auto-created by `lisa:github-write-issue` Phase 5 — flag the absence as a structural FAIL with remediation "Run `gh label create type:<issue_type>` or let the write path auto-create."

#### F2 — Parent sub-issue exists and is the right type

When `parent_ref` is set:

```bash
gh issue view <number> --repo <org>/<repo> --json number,labels,state
```

Confirm the parent issue exists and:
- For non-Sub-task children: parent has `type:Epic` label.
- For Sub-task children: parent has `type:Story`, `type:Task`, `type:Bug`, or `type:Improvement` (anything that can host sub-tasks).

#### F3 — Linked issues exist

For each entry in `links`, run `gh issue view <number> --repo <link-org>/<link-repo>` to confirm the ref resolves. Flag broken refs.

#### F4 — Required labels populated

Per `Phase 5` of `lisa:github-write-issue`, every issue MUST carry: `type:<issue_type>`, `status:<status>`, `priority:<priority>`. If any are missing from the spec / live issue, FAIL with the missing label name.

## Execution

1. Parse `$ARGUMENTS`. If it's an issue ref, fetch via `gh issue view --json` and derive the spec fields. Otherwise parse the YAML spec.
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

### Feasibility Gates  (omit this section when --spec-only)
- [PASS|FAIL|N/A] F1 Issue type label exists in repo — <one-line reason>
- [PASS|FAIL|N/A] F2 Parent sub-issue exists and is the right type — <one-line reason>
- [PASS|FAIL|N/A] F3 Linked issues exist — <one-line reason>
- [PASS|FAIL|N/A] F4 Required labels populated — <one-line reason>

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

Same shape and meaning as `lisa:jira-validate-ticket` so downstream PRD-intake skills (Notion, Confluence, Linear, GitHub) can format comments uniformly:

- **gate**: the gate ID (`S1`–`S13`, `F1`–`F4`).
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
- When validating an existing issue ref, parse the body via the same logic as `lisa:github-read-issue` so the two skills agree on what they see.

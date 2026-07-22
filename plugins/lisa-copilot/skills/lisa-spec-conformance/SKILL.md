---
name: lisa-spec-conformance
description: "Verifies that shipped work matches its spec section-by-section — acceptance criteria, Out of Scope, Technical Approach, Validation Journey assertions, and any explicit deliverables. Builds a coverage matrix mapping each requirement to evidence, flags scope creep separately from misses, and produces a verdict (CONFORMS / PARTIAL / DIVERGES). Runs during the verification phase alongside empirical system verification."
allowed-tools: ["Read", "Glob", "Grep", "Bash", "Skill", "mcp__atlassian__getJiraIssue", "mcp__atlassian__searchJiraIssuesUsingJql", "mcp__atlassian__getAccessibleAtlassianResources"]
---

# Spec Conformance: $ARGUMENTS

Compare shipped work against its spec section-by-section. This is the "accountant lens" — did the work ship exactly what was written, nothing more, nothing less? It is NOT UX review (that's `product-specialist`) and it is NOT empirical system verification (that's `verification-specialist`). Run it alongside those, not instead of them.

## Phase 1 — Resolve Spec Source

Determine the source of truth for this work. Check in this order:

1. **Explicit spec argument** — plan file path (e.g. `.claude/plans/<name>.md`), JIRA key (e.g. `PROJ-123`), Linear key, GitHub issue URL, or PRD path passed as `$ARGUMENTS`.
2. **Linked JIRA ticket** — if the current branch or PR body references a JIRA key, use it.
3. **PR body** — if the PR description contains a "Spec" or "Ticket" link, follow it.
4. **Plan file on disk** — check `.claude/plans/` for an active plan matching the branch name.

If none of the above resolves, stop. Do not guess what the spec was. Report: "No spec source found — pass a plan file, ticket key, or PR URL."

Based on the source, load the full spec:

| Source | How to Load |
|--------|-------------|
| Plan file (`.md`) | `Read` the file |
| JIRA key, GitHub issue ref, or Linear identifier | Invoke `/tracker-read <ref>` (vendor-neutral; dispatches to `/jira-read-ticket`, `/github-read-issue`, or `/linear-read-issue` per `.lisa.config.json` `tracker`) to get the full context bundle (primary item + epic / project / parent + linked items) |
| PRD | `Read` the file or fetch via Notion / Confluence MCP, or `gh issue view` for a GitHub PRD |

## Phase 2 — Extract Requirements

Parse the spec into a structured requirement list. Do NOT skip sections — every requirement becomes a row in the coverage matrix.

Sections to extract:

| Section | What to Extract | Classification |
|---------|-----------------|----------------|
| Acceptance Criteria | Each Gherkin scenario or bullet | `acceptance` |
| Out of Scope | Each excluded item | `excluded` (flags scope creep) |
| Technical Approach | Each concrete implementation commitment (not narrative) | `technical` |
| Validation Journey Assertions | Each `Assertion:` bullet | `assertion` |
| Deliverables | Each explicit deliverable (migration, doc, endpoint, script) | `deliverable` |
| Plan file tasks | Each task marked complete in the plan | `task` |
| Linked blocker resolutions | Each `is blocked by` that required work in this ticket | `blocker` |

If an acceptance criterion is not in Gherkin, still extract it as a requirement — but flag it as `LOW_SPECIFICITY` so the verdict downgrades.
Downgrade rule: if any `LOW_SPECIFICITY` requirement exists, the maximum possible verdict is `PARTIAL` unless the spec is tightened and re-evaluated.

Skip narrative prose (Context / Business Value) — it isn't directly verifiable. Reference it only when explaining a miss.

## Phase 3 — Inspect Shipped Work

Gather evidence of what was actually shipped:

1. **Diff scope** — the commits on the current branch vs. the default branch:
   ```bash
   BASE_BRANCH="$(git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@')"
   git log "${BASE_BRANCH}"..HEAD --oneline
   git diff "${BASE_BRANCH}"...HEAD --stat
   ```
2. **File-level changes** — per-file diff for each changed file:
   ```bash
   git diff "${BASE_BRANCH}"...HEAD -- <file>
   ```
3. **Test coverage** — which tests were added/changed for the requirements:
   ```bash
   git diff "${BASE_BRANCH}"...HEAD -- '**/*.test.*' '**/*.spec.*'
   ```
4. **Empirical evidence** — output of `verification-specialist` if available (proof artifacts, API captures, UI screenshots, DB queries). If that report isn't in context, ask the caller for it before proceeding — do not substitute reading code for running the system.
4a. **The machine-readable verdict** — `Read` `${CLAUDE_PROJECT_DIR:-.}/.lisa/verification-status.json`. Under **schema v2** it is the structured form of the evidence above, and it is what lets you check a claim's *reach* instead of taking "verified" at its word. Load `artifact` (`repository`, `head_sha`, `environment`), `claims[]` (`claim_id`, `statement`, `boundary`, `required_evidence_kinds`, `status`, `evidence_refs`, `not_established`), `evidence[]` (`evidence_id`, `kind`, `locator`, `sha256`, `captured_at`, `artifact_head_sha`), and the `not_established_reviewed` flag.
5. **PR description** — `gh pr view --json title,body,files` if a PR exists.
6. **Deployed state** — if the verification phase already hit a deployed environment, use those captures.

Do NOT run the system yourself — that's the verification-specialist's job. Your job is to map their evidence to the spec.

## Phase 3b — Cross-Check Claims Against Their Boundaries

The `claim-evidence-mapping` rule is the contract: **every claim declares a boundary, and a claim is established only by evidence of a kind that reaches that boundary.** Conformance is not just "was it built" — it is also "does the proof offered actually reach the thing the requirement asserts." A unit `test-run-log` cited for a requirement about browser-visible behavior is a conformance defect even when the code is perfect.

For every v2 claim loaded in Phase 3 step 4a, run three checks:

| Check | Rule | Failure |
|-------|------|---------|
| **Boundary reach** | Each `evidence_refs` entry resolves to an `evidence[]` row whose `kind` appears in that claim's `required_evidence_kinds` — and those kinds are the ones the `claim-evidence-mapping` taxonomy binds to the claim's `boundary` | `BOUNDARY_MISMATCH` |
| **Artifact identity** | Every cited evidence row's `artifact_head_sha` equals `artifact.head_sha` — the claim applies only to the artifact the evidence was collected against | `BOUNDARY_MISMATCH`, noting both SHAs |
| **Not established** | `not_established_reviewed` is present and `true`, and every claim carries a `not_established` list (possibly empty) | `BOUNDARY_MISMATCH` on the verdict as a whole |

Then bind the verdict back to the spec: map each `claim_id` to the requirement row it discharges. A requirement whose only supporting claim fails a check is **not** `MATCH`, no matter what the verification report's prose said. A requirement with no claim at all is `MISSING`, not `PARTIAL`.

**Degrade, never block.** If `.lisa/verification-status.json` is absent, or carries **v1** (no `schema_version`, or `schema_version: 1` — only `plan` / `status` / `criteria[]` / `updated_at`), the boundary cross-check is not available. Say so explicitly in the report ("v2 verdict not present — boundary reach unverified"), fall back to the prose evidence from Phase 3, and cap the verdict at `PARTIAL` for any requirement whose boundary you cannot confirm. Do not invent a mismatch you could not check, and do not silently upgrade an unchecked claim to `MATCH`.

## Phase 4 — Build Coverage Matrix

For every requirement extracted in Phase 2, produce one row:

| Column | Value |
|--------|-------|
| Requirement ID | Stable identifier (e.g. `AC-1`, `OOS-2`, `ASSERT-3`) |
| Classification | `acceptance` / `excluded` / `technical` / `assertion` / `deliverable` / `task` / `blocker` |
| Requirement Text | Verbatim from spec |
| Evidence | Specific pointer — file:line, test name, verification report section, PR file, screenshot name. When a v2 verdict exists, also name the `claim_id` and `evidence_id` that discharge it |
| Boundary | The claim's `boundary` from the v2 verdict (`code-unit` / `browser` / `http-api` / `cli` / `data` / `deploy-health` / `performance` / `standards-compat`), or `—` when no v2 claim maps to this row |
| Evidence kind | The `kind` of each cited evidence row, so a reader sees the reach without opening the verdict |
| Status | `MATCH` / `PARTIAL` / `MISSING` / `BOUNDARY_MISMATCH` / `SCOPE_CREEP_VIOLATION` |
| Notes | One line — why partial, what's missing, or where evidence is thin |

### Status definitions

- **`MATCH`** — requirement is implemented AND there is empirical evidence it works (test + verification report).
- **`PARTIAL`** — implementation exists but evidence is incomplete (e.g. code present, no test; or test present, no run-time verification).
- **`MISSING`** — requirement has no corresponding implementation OR no evidence at all.
- **`BOUNDARY_MISMATCH`** — the requirement was implemented and evidence was cited, but the evidence does not *reach* the claim's boundary (a unit `test-run-log` offered for a `browser` claim), or its `artifact_head_sha` does not match `artifact.head_sha`, or the verdict omits the required Not-established review. This is a distinct failure from a miss: the work may be right and the proof still does not establish it. A `BOUNDARY_MISMATCH` row forces the verdict to `DIVERGES` — it can never render as `CONFORMS` or `PARTIAL`. Name the boundary, the kind cited, and the kind(s) required, citing the `claim-evidence-mapping` taxonomy.
- **`SCOPE_CREEP_VIOLATION`** — used for `excluded` classification only. An Out-of-Scope item appears to have been shipped anyway. This is a different failure than a miss — it means the agent exceeded the spec.

### Scope creep detection

Separately from the matrix, scan the diff for work NOT traceable to any requirement. For each such change:

- Identify the file/module
- Summarize the change in one line
- Classify as `UNTRACEABLE_CHANGE` (not necessarily wrong — refactors often land here — but MUST be surfaced)

Untraceable changes are not automatic failures. They become findings the human reviews.

## Phase 5 — Verdict

Produce exactly one verdict:

- **`CONFORMS`** — every requirement is `MATCH`. No `SCOPE_CREEP_VIOLATION`, no `BOUNDARY_MISMATCH`. Untraceable changes, if any, are clearly refactors or test support.
- **`PARTIAL`** — some requirements are `PARTIAL` but none are `MISSING`, `BOUNDARY_MISMATCH`, or `SCOPE_CREEP_VIOLATION`. Work is mostly there but evidence is thin.
- **`DIVERGES`** — at least one requirement is `MISSING`, OR at least one `BOUNDARY_MISMATCH` exists, OR at least one `SCOPE_CREEP_VIOLATION` exists, OR there are substantive untraceable changes that materially alter behavior.

A verdict of `PARTIAL` or `DIVERGES` blocks task completion. The caller must resolve the gaps (implement the miss, remove the creep, add the missing evidence) before re-running.

## Phase 6 — Output

Structure the report so it can be pasted into a PR comment or JIRA ticket:

```text
## Spec Conformance Report

**Spec source:** <plan file / JIRA key / Linear / GitHub issue / PRD>
**Shipped scope:** <N commits, M files, K tests on branch <branch> vs <default-branch>>
**Verdict artifact:** <.lisa/verification-status.json schema v2, artifact.head_sha <sha> — or "v2 verdict not present — boundary reach unverified">

### Coverage Matrix

| ID | Class | Requirement | Evidence | Boundary | Evidence kind | Status | Notes |
|----|-------|-------------|----------|----------|---------------|--------|-------|
| AC-1 | acceptance | [text] | [pointer] (AC-1 / EV-1) | browser | screenshot | MATCH | |
| AC-2 | acceptance | [text] | — | — | — | MISSING | No corresponding code or test |
| AC-3 | acceptance | [text] | EV-4 | browser | test-run-log | BOUNDARY_MISMATCH | Unit log cannot establish a browser claim — needs screenshot or recording |
| OOS-1 | excluded | [text] | src/foo.ts:42 | — | — | SCOPE_CREEP_VIOLATION | Added anyway |
| ASSERT-1 | assertion | [text] | verification-report §2 | http-api | — | PARTIAL | Asserted in code, not run in verification |

### Not Established

Reproduce the verdict's `not_established` entries verbatim, grouped by claim, plus anything the matrix could not confirm. This section is **never omitted and never blank**: with nothing outstanding it renders `None outstanding — reviewed`. State whether `not_established_reviewed` was `true`.

- AC-1 — not exercised on mobile viewports; Safari not tested
- AC-4 — offline behavior consciously out of scope for this ticket

### Untraceable Changes
- src/utils/helpers.ts — extracted shared regex constant (refactor, no behavior change)
- src/auth/session.ts — added retry logic (NOT IN SPEC — verify intentional)

### Verdict: CONFORMS | PARTIAL | DIVERGES

**Matches:** N/Total
**Partial:** N
**Missing:** N
**Boundary mismatches:** N
**Scope creep violations:** N
**Untraceable changes flagged for review:** N

### Required Actions (if PARTIAL or DIVERGES)
1. [specific action — implement X, remove Y, add test for Z, capture evidence for W]
2. ...
```

## Rules

- Never substitute "I read the code and it looks right" for empirical evidence. If verification-specialist hasn't run yet, request its report before producing a verdict.
- Never mark a requirement `MATCH` based on the presence of code alone — evidence means test + runtime observation.
- Never mark a requirement `MATCH` on evidence that does not **reach** its claim's boundary. Per the `claim-evidence-mapping` contract, a unit `test-run-log` establishes only `code-unit` behavior; cited for a `browser`, `http-api`, `deploy-health`, or `standards-compat` claim it is a `BOUNDARY_MISMATCH`, not a match.
- Always report the Not-established section, even when empty. A report that lists only what passed is unreadable at a gate.
- Always surface scope creep separately from misses. They are distinct failures.
- Always surface untraceable changes — even benign refactors — so the human can confirm intent.
- The Out of Scope section is load-bearing. If the spec has one, every item must appear in the matrix as `excluded`.
- If the spec has no acceptance criteria, flag the spec itself as inadequate before running the matrix. The verdict is `DIVERGES` for spec inadequacy until criteria are added.
- Do not invent requirements the spec didn't state. If the shipped work does something reasonable but unspecified, it becomes an untraceable change, not a match.

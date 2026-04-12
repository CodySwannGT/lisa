---
name: spec-conformance
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
| JIRA key | Invoke `/jira-read-ticket <KEY>` to get the full context bundle (primary ticket + epic + linked tickets) |
| Linear key | Fetch via Linear MCP if available; else `Bash` with Linear CLI; else report "Linear reader unavailable" |
| GitHub issue | `gh issue view <number> --json title,body,comments,labels,milestone` |
| PRD | `Read` the file or fetch via Notion MCP if it's a Notion URL |

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

Skip narrative prose (Context / Business Value) — it isn't directly verifiable. Reference it only when explaining a miss.

## Phase 3 — Inspect Shipped Work

Gather evidence of what was actually shipped:

1. **Diff scope** — the commits on the current branch vs. main:
   ```bash
   git log main..HEAD --oneline
   git diff main...HEAD --stat
   ```
2. **File-level changes** — per-file diff for each changed file:
   ```bash
   git diff main...HEAD -- <file>
   ```
3. **Test coverage** — which tests were added/changed for the requirements:
   ```bash
   git diff main...HEAD -- '**/*.test.*' '**/*.spec.*'
   ```
4. **Empirical evidence** — output of `verification-specialist` if available (proof artifacts, API captures, UI screenshots, DB queries). If that report isn't in context, ask the caller for it before proceeding — do not substitute reading code for running the system.
5. **PR description** — `gh pr view --json title,body,files` if a PR exists.
6. **Deployed state** — if the verification phase already hit a deployed environment, use those captures.

Do NOT run the system yourself — that's the verification-specialist's job. Your job is to map their evidence to the spec.

## Phase 4 — Build Coverage Matrix

For every requirement extracted in Phase 2, produce one row:

| Column | Value |
|--------|-------|
| Requirement ID | Stable identifier (e.g. `AC-1`, `OOS-2`, `ASSERT-3`) |
| Classification | `acceptance` / `excluded` / `technical` / `assertion` / `deliverable` / `task` / `blocker` |
| Requirement Text | Verbatim from spec |
| Evidence | Specific pointer — file:line, test name, verification report section, PR file, screenshot name |
| Status | `MATCH` / `PARTIAL` / `MISSING` / `SCOPE_CREEP_VIOLATION` |
| Notes | One line — why partial, what's missing, or where evidence is thin |

### Status definitions

- **`MATCH`** — requirement is implemented AND there is empirical evidence it works (test + verification report).
- **`PARTIAL`** — implementation exists but evidence is incomplete (e.g. code present, no test; or test present, no run-time verification).
- **`MISSING`** — requirement has no corresponding implementation OR no evidence at all.
- **`SCOPE_CREEP_VIOLATION`** — used for `excluded` classification only. An Out-of-Scope item appears to have been shipped anyway. This is a different failure than a miss — it means the agent exceeded the spec.

### Scope creep detection

Separately from the matrix, scan the diff for work NOT traceable to any requirement. For each such change:

- Identify the file/module
- Summarize the change in one line
- Classify as `UNTRACEABLE_CHANGE` (not necessarily wrong — refactors often land here — but MUST be surfaced)

Untraceable changes are not automatic failures. They become findings the human reviews.

## Phase 5 — Verdict

Produce exactly one verdict:

- **`CONFORMS`** — every requirement is `MATCH`. No `SCOPE_CREEP_VIOLATION`. Untraceable changes, if any, are clearly refactors or test support.
- **`PARTIAL`** — some requirements are `PARTIAL` but none are `MISSING` or `SCOPE_CREEP_VIOLATION`. Work is mostly there but evidence is thin.
- **`DIVERGES`** — at least one requirement is `MISSING`, OR at least one `SCOPE_CREEP_VIOLATION` exists, OR there are substantive untraceable changes that materially alter behavior.

A verdict of `PARTIAL` or `DIVERGES` blocks task completion. The caller must resolve the gaps (implement the miss, remove the creep, add the missing evidence) before re-running.

## Phase 6 — Output

Structure the report so it can be pasted into a PR comment or JIRA ticket:

```text
## Spec Conformance Report

**Spec source:** <plan file / JIRA key / Linear / GitHub issue / PRD>
**Shipped scope:** <N commits, M files, K tests on branch <branch> vs main>

### Coverage Matrix

| ID | Class | Requirement | Evidence | Status | Notes |
|----|-------|-------------|----------|--------|-------|
| AC-1 | acceptance | [text] | [pointer] | MATCH | |
| AC-2 | acceptance | [text] | — | MISSING | No corresponding code or test |
| OOS-1 | excluded | [text] | src/foo.ts:42 | SCOPE_CREEP_VIOLATION | Added anyway |
| ASSERT-1 | assertion | [text] | verification-report §2 | PARTIAL | Asserted in code, not run in verification |

### Untraceable Changes
- src/utils/helpers.ts — extracted shared regex constant (refactor, no behavior change)
- src/auth/session.ts — added retry logic (NOT IN SPEC — verify intentional)

### Verdict: CONFORMS | PARTIAL | DIVERGES

**Matches:** N/Total
**Partial:** N
**Missing:** N
**Scope creep violations:** N
**Untraceable changes flagged for review:** N

### Required Actions (if PARTIAL or DIVERGES)
1. [specific action — implement X, remove Y, add test for Z, capture evidence for W]
2. ...
```

## Rules

- Never substitute "I read the code and it looks right" for empirical evidence. If verification-specialist hasn't run yet, request its report before producing a verdict.
- Never mark a requirement `MATCH` based on the presence of code alone — evidence means test + runtime observation.
- Always surface scope creep separately from misses. They are distinct failures.
- Always surface untraceable changes — even benign refactors — so the human can confirm intent.
- The Out of Scope section is load-bearing. If the spec has one, every item must appear in the matrix as `excluded`.
- If the spec has no acceptance criteria, flag the spec itself as inadequate before running the matrix. The verdict is `DIVERGES` for spec inadequacy until criteria are added.
- Do not invent requirements the spec didn't state. If the shipped work does something reasonable but unspecified, it becomes an untraceable change, not a match.

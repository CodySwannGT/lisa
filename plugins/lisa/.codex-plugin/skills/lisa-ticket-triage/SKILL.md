---
name: lisa-ticket-triage
description: "Analytical triage gate for…"
allowed-tools: ["Read", "Glob", "Grep", "Bash"]
---

# Ticket Triage: $ARGUMENTS

Perform analytical triage on the ticket. The caller MUST have run `lisa-tracker-read` (or its vendor-specific underlying skill — `lisa-jira-read-ticket` for JIRA, `lisa-github-read-issue` for GitHub) first and provided the resulting context bundle — which includes the primary ticket, all linked tickets (blocks / is blocked by / relates to / duplicates), parent (Epic in JIRA, parent sub-issue in GitHub), siblings, sub-tasks / sub-issues, and remote PR state. Do not triage from a bare ticket summary — if the bundle is missing link or parent context, stop and instruct the caller to run `/tracker-read` first.

Repository name for scoped labels and comment headers: determine via `basename $(git rev-parse --show-toplevel)`.

## Phase 0 -- Pre-flight Description Gate

Before any analytical work, confirm the ticket carries the content an implementer needs to start. The caller should already have run `lisa-tracker-verify`; this phase consumes its output. If `lisa-tracker-verify` returned `FAIL` for any of the following, emit `BLOCKED` immediately with the missing-requirements list and skip to Phase 6:

- Parent missing (Epic parent for JIRA non-bug-non-epic; parent sub-issue for GitHub non-bug-non-epic)
- Description quality failures (no Gherkin acceptance criteria, missing audience sections)
- Validation Journey missing on a runtime-behavior ticket
- Target backend environment missing on a runtime-behavior ticket
- Sign-in credentials missing on a ticket that touches authenticated surfaces
- Relationship discovery missing (no links AND no documented git + tracker-search outcome)

Single-repo scope is handled separately — see below.

The caller (jira-agent or github-agent) is responsible for transitioning the ticket to `Blocked` (JIRA status) or relabeling to `status:blocked` (GitHub), reassigning to the **Reporter / original author**, and posting a comment listing the missing requirements. This skill only emits the verdict and the missing-requirements list.

**Single-repo scope is split, not blocked.** A cross-repo leaf work unit (Bug / Task / Sub-task / Improvement spanning repos) is a decomposition error the agent owns, not a terminal BLOCKED. Do not emit BLOCKED for it. The caller runs the **work-time split procedure** in the `repo-scope-split` rule (narrow the original to one repo, spin off a sibling per additional repo, link the producer→consumer dependency), then re-runs `tracker-verify` and re-enters triage on the now single-repo ticket. Only fall back to BLOCKED if the split is ambiguous (see "When to block instead of split" in that rule).

If `lisa-tracker-verify` returned `PASS` for all the above, proceed to Phase 1.

## Phase 1 -- Relevance Check

Search the local codebase using Glob and Grep for code related to the ticket's subject matter:
- Keywords from summary and description
- Component names, API endpoints, database tables
- Error messages or log strings mentioned in the ticket

If NO relevant code is found in this repo:
- Output: `## Verdict: NOT_RELEVANT`
- Instruct caller to add the label `claude-triaged-{repo}` and skip this ticket

If relevant code IS found, proceed to Phase 2.

## Phase 1.5 -- Relationship & Epic Awareness

From the context bundle, evaluate relationships before analyzing this ticket in isolation:

- **Open blockers (`is blocked by`)**: if any blocker is not `Done` or its linked PR is not merged, raise an ambiguity: "Blocker {KEY} is not shipped — work cannot meaningfully start." This is an automatic `BLOCKED` verdict unless the human confirms the blocker state is acceptable.
- **Epic siblings in progress**: if a sibling under the same epic is `In Progress` / `In Review` with a different assignee and overlapping scope, raise it as an edge case in Phase 4 ("Duplicate-work risk with {KEY}").
- **`duplicates` / `is duplicated by` links**:
  - If this ticket is a duplicate of an open canonical ticket whose fix is not yet merged into the base branch, verdict is `BLOCKED` with the recommendation to close as duplicate manually rather than implement.
  - If this ticket is a duplicate of canonical work that is already merged/deployed, verdict is `DUPLICATE_ALREADY_FIXED`. This verdict must carry the canonical ticket reference, the canonical PR/commit reference, and empirical evidence that the canonical fix is present on the relevant base branch. Never emit this verdict from a name/label match alone.
- **`relates to` links with shipped PRs**: flag the PRs in the verification methodology (Phase 5) as prior art worth reviewing before writing new code.

Do not re-fetch tickets — the bundle already has the context.
If Phase 1.5 finds an automatic blocker condition (`is blocked by` not shipped, or duplicate-of-open), emit `BLOCKED` immediately and skip to Phase 6 output formatting. If it finds a duplicate whose canonical fix is empirically present on the base branch, emit `DUPLICATE_ALREADY_FIXED` immediately and skip to Phase 6 output formatting.

## Phase 2 -- Cross-Repo Awareness

Parse the ticket's existing comments for triage headers from OTHER repositories. Look for patterns like:
- `*[some-repo-name] Ambiguity detected*`
- `*[some-repo-name] Edge cases*`
- `*[some-repo-name] Verification methodology*`

Note which phases other repos have already covered and what findings they posted. In subsequent phases:
- Do NOT duplicate findings already posted by another repo
- DO add supplementary findings specific to THIS repo's codebase

## Phase 3 -- Ambiguity Detection

Examine the ticket summary, description, and acceptance criteria. Look for:

| Signal | Example |
|--------|---------|
| Vague language | "should work properly", "handle edge cases", "improve performance" |
| Untestable criteria | No measurable outcome defined |
| Undefined terms | Acronyms or domain terms not explained in context |
| Missing scope boundaries | What's included vs excluded is unclear |
| Implicit assumptions | Assumptions not stated explicitly |

Skip ambiguities already raised by another repo's triage comments.

For each NEW ambiguity found, produce:

```text
### Ambiguity: [short title]
**Description:** [what is ambiguous]
**Suggested clarification:** [specific question to resolve it]
```

Be specific -- every ambiguity must have a concrete clarifying question.

## Phase 4 -- Edge Case Analysis

Search the codebase using Glob and Grep for files related to the ticket's subject matter. Check git history for recent changes in those areas:

```bash
git log --oneline -20 -- <relevant-paths>
```

Identify:
- Boundary conditions (empty inputs, max values, concurrent access)
- Error handling gaps in related code
- Integration risks with other components
- Data migration or backward compatibility concerns

Reference only files in THIS repo. Acknowledge edge cases from other repos if relevant, but do not duplicate them.

For each edge case, produce:

```text
### Edge Case: [title]
**Description:** [what could go wrong]
**Code reference:** [file path and relevant lines or patterns]
```

Every edge case must reference specific code files or patterns found in the codebase. If no relevant code exists, note that this appears to be a new feature with no existing code to analyze.

## Phase 5 -- Verification Methodology

For each acceptance criterion, specify a concrete verification method scoped to what THIS repo can test:

| Verification Type | When to Use | What to Specify |
|-------------------|-------------|-----------------|
| UI | Change affects user-visible interface | Playwright test description with specific assertions |
| API | Change affects HTTP/GraphQL/RPC endpoints | curl command with expected response status and body |
| Data | Change involves schema, migrations, queries | Database query or service call to verify state |
| Performance | Change claims performance improvement | Benchmark description with target metrics |

Do not duplicate verification methods already posted by other repos.

Produce a table:

```text
| Acceptance Criterion | Verification Method | Type |
|---------------------|--------------------| -----|
```

Every verification method must be specific enough that an automated agent could execute it.

## Phase 6 -- Verdict

Evaluate the findings and produce exactly one verdict:

- **`NOT_RELEVANT`** -- No relevant code was found in this repository (Phase 1). The caller should add the triage label and skip implementation in this repo.
- **`DUPLICATE_ALREADY_FIXED`** -- This ticket duplicates canonical work whose fix is already merged/deployed and empirically confirmed present on the relevant base branch. Work MUST NOT proceed. The caller must post the triage finding, ensure the native `duplicates <canonical>` link exists when the tracker supports one, and return the structured canonical reference/evidence to build intake for terminal duplicate closeout.
- **`BLOCKED`** -- Blocking conditions were found in Phase 0 (missing required description content), Phase 1.5 (open blockers, duplicate-of-open), and/or Phase 3 (ambiguities). Work MUST NOT proceed until resolved by a human. When the block is from Phase 0, the caller (jira-agent) MUST transition the ticket to `Blocked` and reassign to the Reporter — not just leave it in place. For Phase 1.5 / Phase 3 blocks, post findings, add the triage label, and STOP.
- **`PASSED_WITH_FINDINGS`** -- No ambiguities, but edge cases or verification findings were identified. Work can proceed. The caller should post findings and add the triage label.
- **`PASSED`** -- No ambiguities, edge cases, or verification gaps found. Work can proceed. The caller should add the triage label.

Output format:

```text
## Verdict: [NOT_RELEVANT | DUPLICATE_ALREADY_FIXED | BLOCKED | PASSED_WITH_FINDINGS | PASSED]

**Ambiguities found:** [count]
**Edge cases identified:** [count]
**Verification methods defined:** [count]
```

## Output Structure

Structure all output with clear section headers so the caller can parse and post findings:

```text
## Triage: [TICKET-KEY] ([repo-name])

### Ambiguities
[Phase 3 findings, or "None found."]

### Edge Cases
[Phase 4 findings, or "None found."]

### Verification Methodology
[Phase 5 table, or "No acceptance criteria to verify."]

## Verdict: [NOT_RELEVANT | DUPLICATE_ALREADY_FIXED | BLOCKED | PASSED_WITH_FINDINGS | PASSED]
```

The caller is responsible for:
1. Posting the findings as comments on the ticket (using whatever Jira mechanism is available)
2. Adding the `claude-triaged-{repo}` label to the ticket
3. If `BLOCKED` due to Phase 0 (missing required description content): transitioning the ticket to `Blocked`, reassigning to the **Reporter**, posting a comment listing the missing requirements, and stopping all work.
4. If `DUPLICATE_ALREADY_FIXED`: return the canonical ticket reference and empirical base-branch evidence to build intake so it can close the ticket as a terminal duplicate without opening a PR.
5. If `BLOCKED` due to Phase 1.5 (open blockers, duplicate-of-open) or Phase 3 (ambiguities): stopping all work and reporting to the human; do NOT auto-transition status in these cases.

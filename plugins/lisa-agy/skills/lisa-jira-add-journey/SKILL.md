---
name: lisa-jira-add-journey
description: "Add a Validation Journey section to an existing JIRA ticket by analyzing the change type and generating appropriate verification steps with evidence markers."
---

# Add Validation Journey to Existing JIRA Ticket

Read an existing JIRA ticket, analyze the change type, and generate a Validation Journey section with appropriate verification steps based on the project's verification patterns.

## Arguments

`$ARGUMENTS`: `<TICKET_ID>`

- `TICKET_ID` (required): JIRA ticket key (e.g., `PROJ-123`)

## Prerequisites

- `JIRA_API_TOKEN` environment variable set
- `jira-cli` configured (`~/.config/.jira/.config.yml`)

## Workflow

### Step 1: Read the Ticket

Use the Atlassian MCP or jira-cli to read the full ticket details:

```bash
jira issue view <TICKET_ID>
```

Extract: title, description, acceptance criteria, components, labels, linked tickets.

### Step 2: Check for Existing Journey

Run the parser to see if a Validation Journey already exists:

```bash
python3 .claude/skills/jira-journey/scripts/parse-plan.py <TICKET_ID> 2>&1
```

If the parser succeeds and returns steps, inspect the journey source for at least one local typed `[EVIDENCE: <artifact-type>: <name>]` marker. Stop only when that local marker exists. An `[EVIDENCE-REF: <work-item-ref> | <artifact-type>: <kebab-case-name>]` is a non-claiming pointer and does not count; if the journey has references but no local claiming marker, continue drafting the missing local journey evidence.

### Step 3: Analyze the Change Type

Examine the ticket description, acceptance criteria, and codebase to determine the change type:

1. **API/GraphQL changes** — New or modified endpoints, request/response schemas
2. **Database migration** — Schema changes, new tables/columns, indexes
3. **Background job/queue** — New job processors, queue consumers, event handlers
4. **Library/utility** — Exported functions, shared modules, npm package changes
5. **Security fix** — Auth, authorization, input validation, OWASP vulnerabilities
6. **Authentication/authorization** — Role-based access, session management, tokens

Use the Explore agent or read the codebase directly to understand which files are affected and what verification approach is appropriate.

### Step 4: Map Change Type to Verification Pattern

Based on the change type, generate verification steps using patterns from `verfication.md`:

| Change Type | Verification Approach |
|---|---|
| API/GraphQL | curl commands verifying endpoints, status codes, response schemas |
| Database migration | Migration execution + schema verification + rollback check |
| Background job/queue | Enqueue + process + state change verification |
| Library/utility | Test execution + build verification + export check |
| Security fix | Exploit reproduction pre-fix + exploit failure post-fix |
| Auth/authz | Multi-role verification with explicit status codes |

### Step 5: Draft the Validation Journey

Compose the journey with typed `[EVIDENCE: <artifact-type>: <name>]` markers at key verification points. The type says HOW the proof is captured (`screenshot`, `recording`, `http-transcript`, `cli-output`, `log-snippet`, `db-query-output`, `perf-trace`, `test-run-log`, `deploy-log`, `state-dump` — the fixed taxonomy in the `verification` rule); the name says WHAT it proves:

```text
h2. Validation Journey

h3. Prerequisites
- List required services, database, env vars

h3. Steps
1. Verify current state before changes
2. Apply the change
3. Verify expected new state [EVIDENCE: http-transcript: health-endpoint-200]
4. Test error/edge cases [EVIDENCE: screenshot: invalid-input-error-state]
5. Verify rollback if applicable [EVIDENCE: db-query-output: rows-restored-after-rollback]

h3. Assertions
- Describe what must be true after verification
```

### Guidelines for Drafting

1. **2-5 evidence markers** — Focus on proving the change works and handles errors
2. **Concrete, runnable steps** — "Run `curl -s localhost:3000/health | jq .status`" not "Check the endpoint"
3. **Include environment setup** — Database connection, running services, env vars
4. **Markers are typed artifacts, not assertion labels** — `[EVIDENCE: <artifact-type>: <kebab-case-name>]`. `[EVIDENCE: load-failure-handled-gracefully]` names a claim with nothing to capture; write `[EVIDENCE: screenshot: load-failure-error-state]` or `[EVIDENCE: perf-trace: pipeline-load-tti]`. Names are kebab-case and unique within the ticket.
5. **Assertions are measurable** — "Returns 200 with `{status: ok}`" not "API works correctly"
6. **Cover happy path and error path** — At minimum, one success and one failure evidence marker
7. **On a leaf work unit, the markers are binding** — For a Bug / Task / Sub-task / Improvement, every typed `[EVIDENCE: <artifact-type>: <name>]` here is the ticket's evidence manifest: validation gate S14 requires at least one, and the ticket cannot be closed until each named artifact is captured **in its declared type** and attached (see the "Per-Work-Unit Evidence Contract" in the `verification` rule). Name only evidence you intend to capture — and name all of it.
8. **Reference sibling evidence without claiming it** — Use only `[EVIDENCE-REF: <work-item-ref> | <artifact-type>: <kebab-case-name>]` when prose points to an artifact declared by another ticket. Never paste, quote, or code-format the sibling's `[EVIDENCE: ...]` marker: that exact prefix creates a local obligation. `EVIDENCE-REF` never satisfies this ticket's S14 minimum, uniqueness check, capture list, or completion gate; a runtime-changing leaf still needs at least one local `[EVIDENCE: ...]` marker.

### Step 6: Present to User for Approval

Display the drafted Validation Journey change to the user and ask for confirmation before updating the ticket.

### Step 7: Merge into Ticket Description

After user approval, use the JIRA REST API to update the ticket description. If no journey exists, append one section. If a reference-only journey exists, preserve all existing prose and `EVIDENCE-REF` pointers and append only the missing local steps/markers inside that existing section. Never create a second `Validation Journey` heading; the parser selects the existing section and duplicate headings make S14 evaluation ambiguous.

### Step 8: Verify

Run the parser again to confirm the journey was added correctly:

```bash
python3 .claude/skills/jira-journey/scripts/parse-plan.py <TICKET_ID>
```

Confirm the journey has at least one local `[EVIDENCE: <artifact-type>: <name>]` marker. An `EVIDENCE-REF` alone does not count.

## When to Use This Skill

- Ticket was created before the Validation Journey convention was established
- Ticket was created manually without following `lisa-jira-create` guidelines
- Ticket needs a journey added or updated based on implementation progress
- Before starting work on a ticket, to ensure verification steps are documented

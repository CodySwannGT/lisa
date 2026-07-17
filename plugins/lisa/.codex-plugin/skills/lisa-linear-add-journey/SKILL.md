---
name: lisa-linear-add-journey
description: "Add a Validation Journey…"
allowed-tools: ["Bash", "Read", "Glob", "Grep", "Skill"]
---

# Add Validation Journey to Existing Linear Issue

Read an existing Linear Issue, analyze the change type, and append a Validation Journey section to the description with appropriate verification steps based on the project's verification patterns.

This skill is the destination of the `lisa-tracker-add-journey` shim when `tracker = "linear"`.

## Configuration

Reads `linear.workspace`, `linear.teamKey` from `.lisa.config.json` (with `.local` override).

## Arguments

`$ARGUMENTS`: `<IDENTIFIER>` — Linear Issue identifier (e.g. `ENG-123`).

## Workflow

### Step 1: Read the Issue

Fetch via `lisa-linear-access operation: get-issue` and extract: title, description (markdown), labels, project, parent, attachments.

### Step 2: Check for Existing Journey

If the description already contains a `## Validation Journey` section, report and stop — never overwrite an existing journey without explicit instruction.

### Step 3: Analyze the Change Type

Examine the description, acceptance criteria, and codebase to determine the change type:

1. **API/GraphQL** — New or modified endpoints, request/response schemas
2. **Database migration** — Schema changes, new tables/columns, indexes
3. **Background job/queue** — New job processors, queue consumers, event handlers
4. **Library/utility** — Exported functions, shared modules, npm package changes
5. **Security fix** — Auth, authorization, input validation, OWASP vulnerabilities
6. **Authentication/authorization** — Role-based access, session management, tokens
7. **UI/frontend** — Components, flows, browser-driven verification

Use Explore agents or read the codebase to understand which files are affected and what verification approach is appropriate.

### Step 4: Map Change Type to Verification Pattern

| Change Type | Verification Approach |
|---|---|
| API/GraphQL | curl commands verifying endpoints, status codes, response schemas |
| Database migration | Migration execution + schema verification + rollback check |
| Background job/queue | Enqueue + process + state change verification |
| Library/utility | Test execution + build verification + export check |
| Security fix | Exploit reproduction pre-fix + exploit failure post-fix |
| Auth/authz | Multi-role verification with explicit status codes |
| UI/frontend | Playwright browser flow + visual evidence |

### Step 5: Draft the Validation Journey (markdown)

Linear descriptions are markdown. Use `##` and `###` headings — not Jira wiki markup.

Compose the journey with typed `[EVIDENCE: <artifact-type>: <name>]` markers at key verification points. The type says HOW the proof is captured (`screenshot`, `recording`, `http-transcript`, `cli-output`, `log-snippet`, `db-query-output`, `perf-trace`, `test-run-log`, `deploy-log`, `state-dump` — the fixed taxonomy in the `verification` rule); the name says WHAT it proves.

```markdown
## Validation Journey

### Prerequisites
- List required services, database, env vars

### Steps
1. Verify current state before changes
2. Apply the change
3. Verify expected new state [EVIDENCE: http-transcript: health-endpoint-200]
4. Test error/edge cases [EVIDENCE: screenshot: invalid-input-error-state]
5. Verify rollback if applicable [EVIDENCE: db-query-output: rows-restored-after-rollback]

### Assertions
- Describe what must be true after verification
```

### Guidelines for Drafting

1. **2–5 evidence markers** — Focus on proving the change works and handles errors.
2. **Concrete, runnable steps** — `Run \`curl -s localhost:3000/health | jq .status\`` not "Check the endpoint".
3. **Include environment setup** — Database connection, running services, env vars.
4. **Markers are typed artifacts, not assertion labels** — `[EVIDENCE: <artifact-type>: <kebab-name>]`. `[EVIDENCE: load-failure-handled-gracefully]` names a claim with nothing to capture; write `[EVIDENCE: screenshot: load-failure-error-state]` or `[EVIDENCE: perf-trace: pipeline-load-tti]`. Names are kebab-case and unique within the ticket.
5. **Cross-item references are non-binding** — If the journey needs to mention another item's artifact, use `[EVIDENCE-REF: <tracker-ref>: <artifact-type>: <kebab-name>]` (for example, `[EVIDENCE-REF: ENG-123: cli-output: upstream-contract-pass]`). Do not paste a sibling item's `[EVIDENCE: ...]` marker into this item; S14 treats `[EVIDENCE: ...]` as this item's own manifest and ignores `EVIDENCE-REF`.
6. **Assertions are measurable** — "Returns 200 with `{status: ok}`" not "API works correctly".
7. **Cover happy path and error path** — At minimum, one success and one failure evidence marker.
8. **On a leaf work unit, the markers are binding** — For a Bug / Task / Sub-task / Improvement, every typed `[EVIDENCE: <artifact-type>: <name>]` here is the item's evidence manifest: validation gate S14 requires at least one, and the item cannot be closed until each named artifact is captured **in its declared type** and attached (see the "Per-Work-Unit Evidence Contract" in the `verification` rule). Name only evidence you intend to capture — and name all of it; `EVIDENCE-REF` never satisfies or extends the manifest.

### Step 6: Present to User for Approval

Display the drafted journey and ask for confirmation before appending.

### Step 7: Append to Issue Description

After approval, fetch the current description, append the new Validation Journey section, and update via `lisa-linear-access operation: save-issue({id, description: <new-description>})`. Preserve all existing description content — never overwrite.

### Step 8: Verify

Re-fetch the issue and confirm the section is present.

## When to Use This Skill

- Issue was created before the Validation Journey convention was established
- Issue was created manually without following `lisa-linear-create` guidelines
- Issue needs a journey added or updated based on implementation progress
- Before starting work on an Issue, to ensure verification steps are documented

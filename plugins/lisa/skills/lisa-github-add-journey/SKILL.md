---
name: lisa-github-add-journey
description: "Add a Validation Journey section to an existing GitHub Issue by analyzing the change type and generating appropriate verification steps with evidence markers. The GitHub counterpart of lisa-jira-add-journey."
allowed-tools: ["Bash", "Skill"]
---

# Add Validation Journey to Existing GitHub Issue

Read an existing GitHub Issue, analyze the change type, and append a `## Validation Journey` markdown section with appropriate verification steps based on the project's verification patterns.

## Arguments

`$ARGUMENTS`: `<ISSUE_REF>`

- `ISSUE_REF` (required): GitHub issue ref — `org/repo#<number>` or full GitHub issue URL.

## Prerequisites

- `gh` CLI authenticated (`gh auth status`).

## Workflow

### Step 1: Read the Issue

```bash
gh issue view <number> --repo <org>/<repo> --json number,title,body,labels,assignees,milestone,url
```

Extract: title, body, type (from `type:` label), components (from `component:` labels), assignees, linked PRs.

### Step 2: Check for Existing Journey

Parse the body for an existing `## Validation Journey` heading. If present and the section contains at least one `[EVIDENCE: <name>]` marker, the issue already has a journey — report this to the user and stop.

### Step 3: Analyze the Change Type

Examine the body, acceptance criteria, and codebase to determine the change type:

1. **API/GraphQL changes** — New or modified endpoints, request/response schemas
2. **Database migration** — Schema changes, new tables/columns, indexes
3. **Background job/queue** — New job processors, queue consumers, event handlers
4. **Library/utility** — Exported functions, shared modules, npm package changes
5. **Security fix** — Auth, authorization, input validation, OWASP vulnerabilities
6. **Authentication/authorization** — Role-based access, session management, tokens

Use Explore agents or read the codebase directly to understand which files are affected.

### Step 4: Map Change Type to Verification Pattern

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
5. **Cross-ticket references are non-binding** — If the journey needs to mention another issue's artifact, use `[EVIDENCE-REF: <tracker-ref>: <artifact-type>: <kebab-name>]` (for example, `[EVIDENCE-REF: #123: cli-output: upstream-contract-pass]`). Do not paste a sibling issue's `[EVIDENCE: ...]` marker into this issue; S14 treats `[EVIDENCE: ...]` as this issue's own manifest and ignores `EVIDENCE-REF`.
6. **Assertions are measurable** — `Returns 200 with {status: ok}` not "API works correctly".
7. **Cover happy path AND error path** — At minimum, one success and one failure marker.
8. **On a leaf work unit, the markers are binding** — For a Bug / Task / Sub-task / Improvement, every typed `[EVIDENCE: <artifact-type>: <name>]` here is the issue's evidence manifest: validation gate S14 requires at least one, and the issue cannot be closed until each named artifact is captured **in its declared type** and attached (see the "Per-Work-Unit Evidence Contract" in the `verification` rule). Name only evidence you intend to capture — and name all of it; `EVIDENCE-REF` never satisfies or extends the manifest.

### Step 6: Present to User for Approval

Display the drafted Validation Journey and ask for confirmation before appending it to the issue body. (If invoked from a parent skill running unattended — e.g., `lisa-github-write-issue` Phase 6 step 5 — proceed without the prompt.)

### Step 7: Append to Issue Body

After approval:

```bash
current_body=$(gh issue view <number> --repo <org>/<repo> --json body --jq '.body')
# Compose new body: existing + "\n\n## Validation Journey\n..." (or replace if present)
gh issue edit <number> --repo <org>/<repo> --body-file /tmp/updated-body.md
```

Preserve every other section verbatim — never re-render the body from parsed fields, since the issue may carry `extra_sections` we don't recognize.

### Step 8: Verify

Re-read the issue and confirm the `## Validation Journey` section is present and includes at least one `[EVIDENCE: <name>]` marker.

## When to Use This Skill

- Issue was created before the Validation Journey convention was established.
- Issue was created manually without following `lisa-github-create` guidelines.
- Issue needs a journey added or updated based on implementation progress.
- Before starting work on an issue, to ensure verification steps are documented.

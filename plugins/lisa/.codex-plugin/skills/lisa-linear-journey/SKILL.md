---
name: lisa-linear-journey
description: "Parse a Linear Issue's…"
allowed-tools: ["Bash", "Read", "Glob", "Grep", "Skill"]
---

# Linear Validation Journey

Parse a Linear Issue's Validation Journey, execute the verification steps using the appropriate tools for the change type, capture evidence at each typed `[EVIDENCE: <artifact-type>: <name>]` marker, and post to Linear + GitHub PR.

This skill is the destination of the `lisa-tracker-journey` shim when `tracker = "linear"`.

## Configuration

Reads `linear.workspace`, `linear.teamKey` from `.lisa.config.json` (with `.local` override).

## Arguments

`$ARGUMENTS`: `<IDENTIFIER> [PR_NUMBER]`

- `IDENTIFIER` (required): Linear Issue identifier (e.g. `ENG-123`)
- `PR_NUMBER` (optional): GitHub PR number to update description

## Prerequisites

- Linear MCP authenticated
- `gh` CLI authenticated
- Appropriate services running for the verification type (dev server, database, etc.)

## Workflow

### Step 1: Parse the Validation Journey

Fetch the Issue via `lisa-linear-access operation: get-issue` and extract the `## Validation Journey` section from the markdown description. Parse:

- `### Prerequisites` — list of required services / env / setup
- `### Steps` — numbered steps, each potentially containing typed `[EVIDENCE: <artifact-type>: <name>]` markers
- `### Assertions` — what must be true after verification

If the section is missing or has no steps, report `"No Validation Journey on <IDENTIFIER>. Run /linear-add-journey first."` and stop.

### Step 2: Satisfy Prerequisites

Before executing steps, verify each prerequisite:

1. Required services running (dev server, database, queue worker)
2. Database connectivity if needed
3. Environment variables set
4. Run any setup commands mentioned in prerequisites

Stop and report if any prerequisite is not satisfied.

### Step 3: Execute Steps and Capture Evidence

Execute each step sequentially. Determine the verification approach based on the step text and change type:

- **API endpoints** → Run curl commands, capture HTTP response to `evidence/NN-name.txt` (or `.json` for structured data)
- **Database changes** → Run psql / migration commands, capture schema output
- **Background jobs** → Trigger the job, check queue / state, capture logs
- **Library / utility changes** → Run tests, capture output
- **Security fixes** → Reproduce exploit attempt, verify fix
- **UI / frontend** → Playwright browser flow, capture screenshots / DOM state

At each typed `[EVIDENCE: <artifact-type>: <name>]` marker, capture an artifact **of the declared type** — the type is the contract, not a suggestion:

- `screenshot` / `recording` → an actual image/video file from the driven UI (Playwright, simulator), never a text description of what was seen
- `http-transcript` → the exact request (curl command or client call) plus the full response
- `cli-output` → the command plus stdout/stderr and exit code
- `log-snippet` → the correlated log lines pulled from the running system
- `db-query-output` → the query plus returned rows
- `perf-trace` → the benchmark/frame-timing/profiler output with methodology (device profile, dataset size)
- `test-run-log` → reporter output naming the spec and showing it ran and passed
- `deploy-log` / `state-dump` → the deployment/health-check output or observed-state JSON

A prose claim ("the error state rendered gracefully") satisfies no marker. Legacy untyped markers: infer the type from the step's action, capture accordingly, and note the inference. Write each artifact to a numbered file:

Treat only exact `[EVIDENCE: ...]` markers (plus the legacy local `[SCREENSHOT: ...]` form) as capture instructions. Both the canonical `[EVIDENCE-REF: <work-item-ref> | <artifact-type>: <kebab-case-name>]` and the Lisa 2.223.0 legacy alias `[EVIDENCE-REF: <tracker-ref>: <artifact-type>: <kebab-case-name>]` point to another work item's artifact: preserve either as explanatory text, but do not capture it, assign it a sequence number, include it in duplicate-name checks, or count it as a local manifest entry. If a runtime-changing leaf has references but no local claiming marker, stop because S14 is unsatisfied.

#### Evidence Naming Convention

`{NN}-{evidence-name}.{ext}`

- `NN`: zero-padded sequential number (`01`, `02`, `03`...)
- `evidence-name`: the `<name>` part of the typed marker
- `ext`: `.txt` for plain output, `.json` for structured data

Example:

```text
evidence/
  01-health-check.json
  02-schema-after-migration.txt
  03-rate-limit-response.txt
  comment.txt
  code-blocks.md
```

### Step 4: Generate Evidence Comment + Code Blocks

After capturing all evidence, build:

- `evidence/comment.txt` — human-readable summary of the verification (Linear comment body, markdown-supported)
- `evidence/code-blocks.md` — fenced code blocks containing the captured evidence outputs (appended below `comment.txt` inside a `<details>` block)

### Step 5: Post Evidence

Invoke `lisa-linear-evidence` with `<IDENTIFIER> ./evidence` to:

1. Upload large evidence files to the GitHub `pr-assets` release (if files present in `evidence/files/`).
2. Update the GitHub PR description with an Evidence section (when a PR is open).
3. Post the Linear comment (`comment.txt` + collapsible `code-blocks.md`).
4. Transition labels: remove `status:in-progress`, add `status:code-review`.

### Step 6: Verify

Confirm:
- Evidence appears as a comment on the Linear Issue.
- The PR description shows the Evidence section.
- The Issue's `status:*` label transitioned to `code-review`.

## Verification Patterns Reference

Use patterns from the project's `verification.md`:

| Change Type | Verification Method | Evidence Format |
|---|---|---|
| API endpoint | `curl -s localhost:PORT/endpoint` | JSON response |
| Database migration | `psql -c "\d table"` or migration output | Schema text |
| Background job | Trigger + check state | Log output |
| Library / utility | `bun run test -- path/to/test` | Test output |
| Security fix | Reproduce + verify fix | Request / response |
| Auth/authz | Multi-role verification | Status codes per role |
| UI / frontend | Any capable interactive browser controller (in-app Browser/Chrome, Playwright MCP/API/ad hoc script, CDP, computer use, or equivalent) | Screenshot + DOM |

## Troubleshooting

### Evidence file is empty

Ensure the command succeeded and produced output. Use `2>&1` to capture both stdout and stderr.

### Parser returns no steps

The Issue may not have a Validation Journey section. Run `/linear-add-journey <IDENTIFIER>` to add one.

### Label transition fails

Ensure `status:in-progress` and `status:code-review` exist on the team. `lisa-linear-evidence` creates them on demand if missing.

---
name: github-journey
description: "Parse a GitHub Issue's Validation Journey section, execute the verification steps using appropriate tools (curl, test commands, database queries), capture evidence at each marker, and post results via lisa:github-evidence. The GitHub counterpart of lisa:jira-journey."
allowed-tools: ["Bash", "Read", "Glob", "Grep", "Skill"]
---

# GitHub Validation Journey

Parse a GitHub Issue's Validation Journey, execute the verification steps using the appropriate tools for the change type, capture evidence at each `[EVIDENCE: <name>]` marker, and post to the issue + GitHub PR.

## Arguments

`$ARGUMENTS`: `<ISSUE_REF> [PR_NUMBER]`

- `ISSUE_REF` (required): GitHub issue ref — `org/repo#<number>` or full GitHub issue URL.
- `PR_NUMBER` (optional): GitHub PR number for the implementation PR. If omitted, the skill auto-detects the PR from `lisa:github-read-issue`'s linked-PR list (preferring the most recent open PR).

## Prerequisites

- `gh` CLI authenticated.
- Appropriate services running for the verification type (dev server, database, etc.).

## Workflow

### Step 1: Parse the Validation Journey

```bash
gh issue view <number> --repo <org>/<repo> --json body --jq '.body'
```

Extract the `## Validation Journey` section (plus its `### Prerequisites`, `### Steps`, and `### Assertions` sub-sections). Parse each step into a structured form: `{ index, text, evidence_marker (or null) }`.

If the issue has no Validation Journey, stop and instruct the caller to run `/github-add-journey <issue-ref>` first.

### Step 2: Satisfy Prerequisites

Before starting the journey, verify each prerequisite:

1. Check if required services are running (`curl localhost:<port>/health`, `pg_isready`, etc.).
2. Verify database connectivity if the journey touches data.
3. Ensure environment variables are set.
4. Run any setup commands mentioned in `### Prerequisites`.

### Step 3: Execute Steps and Capture Evidence

Execute each step sequentially. Determine the verification approach based on the step text and the issue's change type (inferred from `type:` label, `component:` labels, and the body):

- **API endpoints** → Run curl commands, capture HTTP response to `evidence/NN-name.txt` (or `.json`).
- **Database changes** → Run psql/migration commands, capture schema output.
- **Background jobs** → Trigger the job, check queue/state, capture logs.
- **Library/utility changes** → Run tests, capture output.
- **Security fixes** → Reproduce exploit attempt, verify fix, capture output.

At each `[EVIDENCE: name]` marker, capture stdout/stderr to a numbered file:

#### Evidence Naming Convention

`{NN}-{evidence-name}.txt` (or `.json` for structured data):

- `NN`: zero-padded sequential number (01, 02, 03...).
- `evidence-name`: the value from `[EVIDENCE: <name>]` (kebab-case).

Example:

```text
evidence/
  01-health-check.json
  02-schema-after-migration.txt
  03-rate-limit-response.txt
  comment.md
```

### Step 4: Generate Evidence Templates

Compose `evidence/comment.md` with:

- The issue ref + title.
- The PR ref.
- Each evidence marker rendered as a GitHub markdown section with a fenced code block of the captured file.
- An "Assertions verified" subsection mapping each `### Assertions` line to "PASS / FAIL".

This template generator is shared with `lisa:jira-journey` (the JIRA path renders the same content as wiki markup). When the markdown comment is the canonical artifact, both vendors stay aligned.

### Step 5: Post Evidence

Use `lisa:github-evidence` to post everything:

```bash
# Equivalent of: bash scripts/post-evidence.sh — but invoked via the Skill tool
```

Invoke the skill with `<ISSUE_REF> ./evidence <PR_NUMBER>`. It uploads the files to the `pr-assets` release, edits the PR's `## Evidence` section, posts a comment on the issue, and relabels the issue to `status:code-review`.

### Step 6: Verify

Confirm:
- Evidence files exist as release assets named `pr-<PR>-NN-name.{txt,json}`.
- The PR description contains the `## Evidence` section with code-block embeds.
- The issue has a new comment whose body matches `comment.md`.
- The issue's labels include `status:code-review` and not `status:in-progress`.

## Verification Patterns Reference

| Change Type | Verification Method | Evidence Format |
|---|---|---|
| API endpoint | `curl -s localhost:PORT/endpoint` | JSON response |
| Database migration | `psql -c "\d table"` or migration output | Schema text |
| Background job | Trigger + check state | Log output |
| Library/utility | `bun run test -- path/to/test` | Test output |
| Security fix | Reproduce + verify fix | Request/response |
| Auth/authz | Multi-role verification | Status codes per role |

## Troubleshooting

### Evidence file is empty

Ensure the command succeeded and produced output. Use `2>&1` to capture both stdout and stderr.

### Parser returns no steps

The issue may not have a Validation Journey section — run `/github-add-journey <ISSUE_REF>` first.

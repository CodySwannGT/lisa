---
name: linear-evidence
description: "Uploads text evidence to the GitHub `pr-assets` release, updates the PR description, posts a comment on the originating Linear Issue with code blocks, and transitions the Issue from in-progress to code-review by relabeling. Reusable by any skill that captures evidence and generates evidence/comment.txt + evidence/code-blocks.md. Linear counterpart of lisa:jira-evidence and lisa:github-evidence."
allowed-tools: ["Bash", "Skill", "mcp__linear-server__list_teams", "mcp__linear-server__get_issue", "mcp__linear-server__save_issue", "mcp__linear-server__save_comment", "mcp__linear-server__list_issue_labels", "mcp__linear-server__create_issue_label"]
---

# Linear Evidence: $ARGUMENTS

Post verification evidence to a Linear Issue and transition it to the code-review state. This skill is the destination of the `lisa:tracker-evidence` shim when `tracker = "linear"`.

`$ARGUMENTS` is the Linear Issue identifier (e.g. `ENG-123`) and the path to the evidence directory. Caller passes both: `<IDENTIFIER> <evidence-dir>`.

## Configuration

Reads `linear.workspace`, `linear.teamKey` from `.lisa.config.json` (with `.local` override).

## Inputs (in `<evidence-dir>`)

The caller must produce:

- `evidence/comment.txt` — the human-readable comment body posted on the Linear Issue.
- `evidence/code-blocks.md` — fenced code blocks (test outputs, command output, log excerpts) appended to the comment.
- `evidence/files/` (optional) — any text files that should be uploaded to the GitHub `pr-assets` release for permalink-style references.

If any of these are missing, stop and report.

## Phase 1 — Resolve Linear Issue

1. Parse the identifier from `$ARGUMENTS`.
2. Fetch via `mcp__linear-server__get_issue` to confirm it exists and capture its current state, label set, and Project membership.

## Phase 2 — Upload Evidence Files (optional)

If `evidence/files/` is non-empty, upload each text file to the GitHub `pr-assets` release on the current repo via `gh release upload`. The release is the permalink store — keeps the Linear comment lightweight while preserving large outputs.

For each uploaded file, capture the public release URL.

## Phase 3 — Update PR Description

If a PR is open on the current branch (`gh pr view --json url,number,body 2>/dev/null`), append an "Evidence" section to its description with:

- The Linear identifier and URL (constructed as `https://linear.app/<workspace>/issue/<IDENTIFIER>`).
- Links to any uploaded evidence files.
- A short summary line (first 2 lines of `evidence/comment.txt`).

If no PR is open, skip this phase.

## Phase 4 — Post Linear Comment

Call `mcp__linear-server__save_comment({issueId: <id>, body: <body>})` where `<body>` is:

```markdown
[<comment.txt contents verbatim>]

<details>
<summary>Evidence</summary>

[<code-blocks.md contents verbatim>]

</details>

[<bullet list of uploaded evidence file URLs, if any>]
```

Linear comments support markdown including `<details>` collapsibles, fenced code, and links — preserve the formatting.

## Phase 5 — Transition Status

Update labels via `mcp__linear-server__save_issue` to remove `status:in-progress` and add `status:code-review`. Resolve label IDs first via `mcp__linear-server__list_issue_labels` (create the label via `create_issue_label` if it doesn't exist on the team).

The native Linear `state` field is also updated to the team's "In Review" state if one exists — but the label remains the source of truth for cross-team consistency.

## Phase 6 — Report

Return:

- Linear Issue URL with new label state
- PR URL (if updated)
- List of uploaded evidence file URLs

## Rules

- Never modify the Issue description as part of evidence posting — comments only. Description edits go through `lisa:linear-write-issue`.
- Never skip the label transition. The build queue is keyed off `status:*` labels; an item that ships without transitioning is invisible to monitoring.
- If `mcp__linear-server__save_comment` fails, retry once. If it fails again, surface the error — don't pretend the comment was posted.
- Do not delete prior comments. The history is the audit trail.

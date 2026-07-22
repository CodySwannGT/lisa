---
name: lisa-linear-evidence
description: "Uploads text evidence to the GitHub `pr-assets` release, updates the PR description, posts a comment on the originating Linear Issue with code blocks, and transitions the Issue from the configured `claimed` label to the configured `review` label. Reusable by any skill that captures evidence and generates evidence/comment.txt + evidence/code-blocks.md. Linear counterpart of lisa-jira-evidence and lisa-github-evidence."
allowed-tools: ["Bash", "Skill"]
---

# Linear Evidence: $ARGUMENTS

Post verification evidence to a Linear Issue and transition it from the configured `claimed` build label to the configured `review` build label. This skill is the destination of the `lisa-tracker-evidence` shim when `tracker = "linear"`.

`$ARGUMENTS` is the Linear Issue identifier (e.g. `ENG-123`) and the path to the evidence directory. Caller passes both: `<IDENTIFIER> <evidence-dir>`.

## Workflow resolution

The `claimed` and `review` build labels are read from `.lisa.config.json` `linear.labels.build.*`, falling back to the defaults documented in the `config-resolution` rule (`status:in-progress` and `status:code-review`).

```bash
read_role() {
  local role="$1" default="$2"
  local local_v global_v
  local_v=$(jq -r ".linear.labels.build.${role} // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r ".linear.labels.build.${role} // empty" .lisa.config.json 2>/dev/null)
  echo "${local_v:-${global_v:-$default}}"
}

CLAIMED=$(read_role claimed "status:in-progress")
REVIEW=$(read_role review "status:code-review")
```

## Configuration

Reads `linear.workspace`, `linear.teamKey`, and `linear.labels.build.*` from `.lisa.config.json` (with `.local` override).

## Inputs (in `<evidence-dir>`)

The caller must produce:

- `evidence/comment.txt` — the human-readable comment body posted on the Linear Issue.
- `evidence/code-blocks.md` — fenced code blocks (test outputs, command output, log excerpts) appended to the comment.
- `evidence/files/` (optional) — any text files that should be uploaded to the GitHub `pr-assets` release for permalink-style references.

If any of these are missing, stop and report.

## Comment-body preflight (required)

Before posting or updating anything, check the evidence body (`comment.md`, and `comment.txt` where this skill uses it):

- It contains a `## Not established` heading. That heading is **never omitted and never blank** — when nothing is outstanding it still renders `None outstanding — reviewed`; otherwise it names, in plain operator language, what the verification did not prove.
- The accompanying verdict carries `not_established_reviewed: true` (the list may be empty; the flag may never be omitted).
- It contains a `## Artifact identity` heading carrying **values, not placeholders** — the repository, the `head_sha` the verification observed, the `environment`, and per artifact its `sha256` digest and `captured_at`. **Refuse to post** a body whose identity heading is absent or unpopulated, or whose recorded `artifact_head_sha` disagrees with the verdict's `artifact.head_sha` — report the evidence id and **both SHAs**. Definition: the `claim-evidence-mapping` rule.

If either is missing, **refuse to post**: stop and report the missing Not-established review to the caller instead of publishing. Composing the body is `lisa-tracker-evidence`'s job (see its UI Evidence Checklist); this skill only refuses to publish one that omits the section. The section is defined by the `claim-evidence-mapping` rule and generalizes `lisa-improve-harness`'s required, never-empty `Known limits` field.

## Phase 1 — Resolve Linear Issue

1. Parse the identifier from `$ARGUMENTS`.
2. Fetch via `lisa-linear-access operation: get-issue` to confirm it exists and capture its current state, label set, and Project membership.

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

Call `lisa-linear-access operation: save-comment({issueId: <id>, body: <body>})` where `<body>` is:

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

Update labels via `lisa-linear-access operation: save-issue` to remove `$CLAIMED` and add `$REVIEW`. Resolve label IDs first via `lisa-linear-access operation: list-issue-labels` (create the label via `create_issue_label` if it doesn't exist on the team).

The native Linear `state` field is also updated to the team's "In Review" state if one exists — but the label remains the source of truth for cross-team consistency.

## Phase 6 — Report

Return:

- Linear Issue URL with new label state
- PR URL (if updated)
- List of uploaded evidence file URLs

## Rules

- Never modify the Issue description as part of evidence posting — comments only. Description edits go through `lisa-linear-write-issue`.
- Never skip the label transition. The build queue is keyed off the configured `linear.labels.build.*` labels; an item that ships without transitioning is invisible to monitoring.
- If `lisa-linear-access operation: save-comment` fails, retry once. If it fails again, surface the error — don't pretend the comment was posted.
- Do not delete prior comments. The history is the audit trail.

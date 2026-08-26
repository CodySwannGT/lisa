---
name: lisa-linear-evidence
description: "Uploads text evidence to the GitHub `pr-assets` release, updates the PR description, posts a comment on the originating Linear Issue with code blocks, and transitions the Issue from the configured `claimed` label to the configured `review` label. Reusable by any skill that captures evidence and generates evidence/comment.txt + evidence/code-blocks.md. Linear counterpart of lisa-jira-evidence and lisa-github-evidence."
allowed-tools: ["Bash", "Skill"]
---

# Linear Evidence: $ARGUMENTS

Post verification evidence to a Linear Issue and transition it from the configured `claimed` build label to the configured `review` build label. This skill is the destination of the `lisa-tracker-evidence` shim when `tracker = "linear"`.

`$ARGUMENTS` is the Linear Issue identifier (e.g. `ENG-123`) and the path to the evidence directory. Caller passes both: `<IDENTIFIER> <evidence-dir>`.

## Workflow resolution

Resolve every lifecycle role through the shared resolver — never an inlined `read_role` helper. Twelve skills used to inline their own and produced **eleven different implementations**, which is how the vendors drifted apart on this exact contract.

```bash
resolve() {  # role, intent -> value on stdout; empty when an optional role is unset
  node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-lifecycle-role.mjs" \
    --role "$1" --vendor linear --intent "${2:-read}"
}

CLAIMED=$(resolve claimed write) || {
  echo "ERROR: failed to resolve the required Linear claimed role" >&2
  exit 1
}
[ -n "$CLAIMED" ] || {
  echo "ERROR: the required Linear claimed role resolved empty" >&2
  exit 1
}
REVIEW=$(resolve review write) || {
  echo "ERROR: failed to resolve the optional Linear review role" >&2
  exit 1
}
```

**`review` is OPTIONAL and has no default.** An empty `REVIEW` means the project does not run an agent review step, and this skill **skips the transition entirely**, leaving the Issue in `claimed` — the same behaviour `lisa-jira-evidence/scripts/post-evidence.sh` has always had. Do not substitute `In Review`, and do not fall back to a state resolved by `type` or board position: a fallback may inform a read but must never supply a write target (`config-resolution`, R2). Resolving a state nobody configured is how agents reach human-only review lanes.

## Configuration

Reads `linear.workspace`, `linear.teamKey`, and `linear.workflow.*` from `.lisa.config.json` (with `.local` override).

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

**If `$REVIEW` is empty, skip this phase entirely** — post the evidence comment and leave the Issue in `$CLAIMED`. Report it plainly (`No linear.workflow.review configured; leaving <ID> in its current (claimed) state`) so the skip is visible rather than silent. This is a supported configuration, not a failure.

When `$REVIEW` is non-empty, update labels via `lisa-linear-access operation: save-issue` to remove `$CLAIMED` and add `$REVIEW`. Resolve label IDs first via `lisa-linear-access operation: list-issue-labels` (create the label via `create_issue_label` if it doesn't exist on the team).

The native Linear `state` field is updated to `$REVIEW` **only when the resolver returned it from config**. Never resolve the state by searching the team for something review-shaped: on a board with more than one review-ish state that picks by position, not by intent, and the states most likely to be found that way are the human-only ones a project deliberately kept out of its config.

## Phase 6 — Report

Return:

- Linear Issue URL with new label state
- PR URL (if updated)
- List of uploaded evidence file URLs

## Rules

- Never modify the Issue description as part of evidence posting — comments only. Description edits go through `lisa-linear-write-issue`.
- Never skip the transition when `review` is configured. An empty `$REVIEW` is the one sanctioned skip (Phase 5): post the evidence comment, leave the Issue in `$CLAIMED`, and report the skip. Whenever `$REVIEW` is non-empty, the configured native state transition is mandatory.
- If `lisa-linear-access operation: save-comment` fails, retry once. If it fails again, surface the error — don't pretend the comment was posted.
- Do not delete prior comments. The history is the audit trail.

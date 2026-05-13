---
name: github-evidence
description: "Upload text evidence to the GitHub `pr-assets` release, update PR description, post a GitHub Issue comment with code blocks, and relabel the issue to `status:code-review`. Reusable by any skill that captures evidence and generates evidence/comment.md (and optionally evidence/comment.txt). The GitHub counterpart of lisa:jira-evidence."
allowed-tools: ["Bash"]
---

# GitHub Evidence Posting

Upload captured evidence and generated templates to the GitHub PR description and the originating GitHub Issue. This skill is the posting step — it assumes evidence files and a comment template already exist in the evidence directory.

## Arguments

`$ARGUMENTS`: `<ISSUE_REF> <EVIDENCE_DIR> <PR_NUMBER>`

- `ISSUE_REF` (required): GitHub issue ref — `org/repo#<number>` or full GitHub issue URL.
- `EVIDENCE_DIR` (required): Directory containing evidence and templates (e.g., `./evidence`).
- `PR_NUMBER` (required): GitHub PR number to update description.

## Prerequisites

- `gh` CLI authenticated (`gh auth status`).
- Evidence directory containing:
  - `NN-name.txt` or `NN-name.json` text evidence files (e.g., `01-health-check.json`)
  - `comment.md` — GitHub markdown body for both the issue comment and the PR description's `## Evidence` section.
  - (Optional) `comment.txt` — kept for parity with the JIRA path; not used here.

## Workflow

1. **Resolve refs**

   Parse `ISSUE_REF` into `<issue-org>/<issue-repo>#<issue-number>`. Parse the local repo (where the PR lives) via `gh repo view --json nameWithOwner --jq '.nameWithOwner'`.

2. **Ensure the `pr-assets` release exists in the IMPLEMENTATION repo**

   The `pr-assets` release is the asset CDN for evidence files. Each PR's evidence is uploaded with the PR number prefix in the asset name to keep them addressable.

   ```bash
   gh release view pr-assets --repo <impl-org>/<impl-repo> >/dev/null 2>&1 \
     || gh release create pr-assets --repo <impl-org>/<impl-repo> --title "PR Assets" --notes "CDN for PR evidence"
   ```

3. **Upload each evidence file**

   ```bash
   for f in "$EVIDENCE_DIR"/[0-9][0-9]-*.txt "$EVIDENCE_DIR"/[0-9][0-9]-*.json; do
     [ -f "$f" ] || continue
     name="pr-${PR_NUMBER}-$(basename "$f")"
     gh release upload pr-assets --repo <impl-org>/<impl-repo> --clobber "$f#$name"
   done
   ```

   The `#$name` syntax sets the asset name. `--clobber` lets re-runs overwrite.

4. **Update the PR description**

   Replace or append the `## Evidence` section in the PR body using `comment.md`:

   ```bash
   current_body=$(gh pr view "$PR_NUMBER" --repo <impl-org>/<impl-repo> --json body --jq '.body')
   evidence_section=$(cat "$EVIDENCE_DIR/comment.md")
   # Replace existing ## Evidence ... up to next ## or EOF; otherwise append.
   ```

   Use a Bash heredoc / temp file to compose the new body, then:

   ```bash
   gh pr edit "$PR_NUMBER" --repo <impl-org>/<impl-repo> --body-file /tmp/pr-body.md
   ```

5. **Post a comment on the originating issue**

   The issue may live in a different repo than the PR (cross-repo work):

   ```bash
   gh issue comment <issue-number> --repo <issue-org>/<issue-repo> --body-file "$EVIDENCE_DIR/comment.md"
   ```

6. **Relabel the issue to `status:code-review`**

   ```bash
   gh issue edit <issue-number> --repo <issue-org>/<issue-repo> \
     --remove-label status:in-progress \
     --add-label status:code-review
   ```

   If the current label is already `status:code-review`, skip. If neither `status:in-progress` nor `status:code-review` is present, log a warning and continue without changing labels — the issue may have been hand-managed.

## Evidence Naming Convention

```text
evidence/
  01-health-check.json          uploaded
  02-schema-after-migration.txt uploaded
  03-rate-limit-response.txt    uploaded
  comment.md                    used for issue comment + PR description
```

Asset names in the release are prefixed with `pr-<number>-` so multiple PRs' evidence coexists without collision.

## Troubleshooting

### Evidence not appearing in GitHub PR or issue

Check:
- `gh auth status` succeeds.
- The PR / issue refs are correct.
- The `pr-assets` release exists in the implementation repo.

### `gh issue edit` returns 404

The issue may live in a different repo than the PR — pass `--repo <issue-org>/<issue-repo>` explicitly. The implementation repo and the destination tracker repo can differ when `tracker = "github"` is set on a project that ships from a separate codebase.

## Notes

- This skill is symmetric with `lisa:jira-evidence` — the evidence directory layout and `comment.md` content are identical so a single template generator can serve both vendors.
- The PR's `## Evidence` section is the canonical link for reviewers; the issue comment is for the PRD/PM thread.

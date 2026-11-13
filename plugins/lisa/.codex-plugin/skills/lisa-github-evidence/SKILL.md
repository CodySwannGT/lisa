---
name: lisa-github-evidence
description: "Upload text evidence to the…"
allowed-tools: ["Bash"]
---
Upload text evidence to the configured GitHub evidence release (default `pr-assets`), update PR description, and post a GitHub Issue comment with code blocks. Reusable by any skill that captures evidence and generates evidence/comment.md (and optionally evidence/comment.txt). The GitHub counterpart of lisa-jira-evidence.


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

## Comment-body preflight (required)

Before posting or updating anything, check the evidence body (`comment.md`, and `comment.txt` where this skill uses it):

- It contains a `## Not established` heading. That heading is **never omitted and never blank** — when nothing is outstanding it still renders `None outstanding — reviewed`; otherwise it names, in plain operator language, what the verification did not prove.
- The accompanying verdict carries `not_established_reviewed: true` (the list may be empty; the flag may never be omitted).
- It contains a `## Artifact identity` heading carrying **values, not placeholders** — the repository, the `head_sha` the verification observed, the `environment`, and per artifact its `sha256` digest and `captured_at`. **Refuse to post** a body whose identity heading is absent or unpopulated, or whose recorded `artifact_head_sha` disagrees with the verdict's `artifact.head_sha` — report the evidence id and **both SHAs**. Definition: the `claim-evidence-mapping` rule.

If either is missing, **refuse to post**: stop and report the missing Not-established review to the caller instead of publishing. Composing the body is `lisa-tracker-evidence`'s job (see its UI Evidence Checklist); this skill only refuses to publish one that omits the section. The section is defined by the `claim-evidence-mapping` rule and generalizes `lisa-improve-harness`'s required, never-empty `Known limits` field.

## Workflow

1. **Resolve refs**

   Parse `ISSUE_REF` into `<issue-org>/<issue-repo>#<issue-number>`. Parse the local repo (where the PR lives) via `gh repo view --json nameWithOwner --jq '.nameWithOwner'`.

2. **Resolve and ensure the evidence release in the IMPLEMENTATION repo**

   Evidence goes to the configured evidence release:
   `verification.completion.evidenceRelease` in `.lisa.config.json`, default
   `pr-assets`. A rotating name such as `pr-assets-{YYYY-MM}` keeps each
   release under GitHub's 1000-file limit. It is the asset CDN for evidence
   files; each PR's evidence carries the PR number prefix in the asset name to
   keep it addressable. From the implementation repo's root:

   ```bash
   RELEASE=$(node scripts/lisa-work-item.mjs evidence-release --ensure) || exit 1
   ```

   `--ensure` creates the release when it is absent, rolls over to the next
   overflow release (`<release>-2`, `-3`, …) when it is nearly full, and prints
   the release that has room. It stops with a plain message only when a pinned
   `LISA_EVIDENCE_RELEASE` is full, every overflow release is, or the release
   name is too long to roll over. Do not upload
   when it fails. A project
   without `scripts/lisa-work-item.mjs` uses `RELEASE=pr-assets`.

3. **Upload each evidence file**

   ```bash
   (
     set -e
     export LC_ALL=C
     : "${RELEASE:?Resolve the evidence release in step 2 first}"
     upload_dir=$(mktemp -d "${TMPDIR:-/tmp}/lisa-github-evidence.XXXXXXXX")
     trap 'rm -rf "$upload_dir"' EXIT
     expected_names="$upload_dir/expected-names.txt"
     basenames="$upload_dir/basenames.txt"
     : > "$expected_names"
     : > "$basenames"

     for f in "$EVIDENCE_DIR"/[0-9][0-9]-*.txt "$EVIDENCE_DIR"/[0-9][0-9]-*.json; do
       [ -f "$f" ] || continue
       base=$(basename "$f")
       if [[ ! "$base" =~ ^[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*\.(txt|json)$ ]]; then
         printf 'Invalid evidence filename; use a name like 01-health-check.json or 02-output.txt: %s\n' "$base" >&2
         exit 1
       fi
       printf '%s\n' "$base" >> "$basenames"
     done

     while IFS= read -r base; do
       name="pr-${PR_NUMBER}-${base}"
       cp "$EVIDENCE_DIR/$base" "$upload_dir/$name"
       gh release upload "$RELEASE" --repo <impl-org>/<impl-repo> --clobber "$upload_dir/$name"
       printf '%s\n' "$name" >> "$expected_names"
     done < "$basenames"

     gh release view "$RELEASE" --repo <impl-org>/<impl-repo> \
       --json assets --jq '.assets[].name' > "$upload_dir/asset-names.txt"
     while IFS= read -r name; do
       if ! grep -Fxq -- "$name" "$upload_dir/asset-names.txt"; then
         printf 'Expected evidence asset is missing: %s\n' "$name" >&2
         exit 1
       fi
       printf 'Uploaded evidence asset: %s\n' "$name"
     done < "$expected_names"
   )
   upload_status=$?
   if [ "$upload_status" -ne 0 ]; then
     printf 'Evidence upload failed; stop before posting.\n' >&2
     exit "$upload_status"
   fi
   ```

   Validate the complete input batch before uploading anything: use numbered,
   ASCII kebab-case names such as `01-health-check.json`. GitHub can
   [normalize special characters in asset names](https://docs.github.com/en/rest/releases/assets#upload-a-release-asset),
   so invalid names are refused rather than renamed into another asset.

   An asset takes its name from the uploaded file's basename. A `#` suffix only
   sets its display label; it cannot rename the asset. Stage the copy under the
   intended name before uploading. The subshell stops on copy, upload or release
   read failure, checks every expected name, and removes staging on exit.
   Run steps 4 and 5 only if the upload block exits successfully. On failure,
   stop and report it without updating the PR or posting an issue comment.
   `--clobber` replaces an existing asset with that same PR-prefixed name.

   Link to the actual name:
   `https://github.com/<impl-org>/<impl-repo>/releases/download/<release>/pr-<number>-<file>`,
   where `<release>` is the `$RELEASE` resolved in step 2.

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

6. **Leave lifecycle labels unchanged**

   GitHub evidence posting is evidence-only. The caller that owns the build lifecycle (`lisa-github-build-intake` / `lisa-github-agent`) transitions the issue from the configured `claimed` label directly to the configured `done` label after a successful build. Do not apply `status:code-review` here.

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
- `node scripts/lisa-work-item.mjs evidence-release --ensure` succeeds in the implementation repo (it creates a missing release, rolls over past a full one, and names a full pinned one).

### `gh issue edit` returns 404

The issue may live in a different repo than the PR — pass `--repo <issue-org>/<issue-repo>` explicitly. The implementation repo and the destination tracker repo can differ when `tracker = "github"` is set on a project that ships from a separate codebase.

## Notes

- This skill is symmetric with `lisa-jira-evidence` — the evidence directory layout and `comment.md` content are identical so a single template generator can serve both vendors.
- The PR's `## Evidence` section is the canonical link for reviewers; the issue comment is for the PRD/PM thread.

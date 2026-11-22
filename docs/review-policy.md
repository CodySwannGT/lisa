# Pull request review policy

Projects can use `review` in `.lisa.config.json` to require one completed review of the exact pull request head. GitHub Actions evaluates the policy from the repository’s default branch and publishes `🕵️ Review policy verdict` on the head it inspected.

```json
{
  "review": {
    "providers": ["agent", "coderabbit", "greptile"],
    "minimumCount": 1
  }
}
```

Use `providers: ["agent"]` for independent agent review. Set `requiredProviders` to a subset of `providers` when a named provider must complete a review. `minimumCount` counts distinct authenticated GitHub actors. `minimumHumanApprovals` can add a floor for native human approvals at the same head. Branch protection can also require native approvals independently. Pending reviews, provider throttling, and skipped reviews earn no credit. Open change requests, unresolved threads, and hold labels keep the verdict red.

## Agent review

Have a separate agent session inspect the exact diff and record the outcomes of its findings. The report may be posted through the pull request author's GitHub account. The posting account needs repository write access.

Save a JSON report with `schema_version: 1`, `provider: "agent"`, `status: "completed"`, `head_sha`, `source_session`, `reviewer_session`, and `scope`, the list of reviewed paths. Include the substantive review text in `review` and its UTF-8 SHA-256 in `review_sha256`. Include a `findings` array with an `evidence` string and a `disposition` of `fixed`, `pushed-back`, or `non-blocking` for each finding.

```bash
node scripts/post-agent-review.mjs --repo "$repo" --pr "$pr" --report "$report"
```

The script submits a native GitHub review as a comment, verifies its author and head, and dispatches the policy workflow from the default branch. It returns the review ID and run ID. If dispatch fails after the review is recorded, rerun with the same report to reuse the review. The workflow run must finish before the verdict is available.

When evidence changes at the same head, dispatch the workflow again with that head. This also refreshes a verdict after an external reviewer finishes or someone resolves a thread.

```bash
gh workflow run review-policy.yml --repo "$repo" --ref "$default_branch" -f pr="$pr" -f sha="$head"
node scripts/check-review-policy-run.mjs --repo "$repo" --pr "$pr" --sha "$head" --run "$run_id"
node scripts/check-review-policy.mjs --repo "$repo" --pr "$pr" --sha "$head" --json
```

Run the last two commands from the trusted default-branch checkout. The first check verifies native workflow provenance and the head it evaluated. The second rereads live review evidence using the current policy. Re-evaluate after a new push or an update to the default branch.

## Adopt in an existing repository

1. Commit the installed `review-policy.yml` and `review-policy-activity.yml` workflows and the review declaration to the default branch through the repository’s current protected path.
2. Run the workflow on a disposable pull request. Verify both a red result without acceptable review and `REVIEWED` with an acceptable review. Use `check-review-policy-run.mjs` to verify the successful result belongs to the actual policy workflow. GitHub's check name and app pin alone identify the app, which can back more than one workflow.
3. Promote `🕵️ Review policy verdict` as an exact required context from GitHub Actions (app ID `15368`) using the repository’s ordinary ruleset update. Lisa can declare this as the `code-review` gate’s `pull-request.await`, with `level: "required"` and `posted_by: 15368`. Retire vendor-specific requirements only after the new context is visible and the ruleset update is approved. Preserve other required checks, approval counts, and conversation resolution.

## Provider details

- The agent adapter verifies an authenticated repository writer's review of the exact head, the reported session identifiers, and the submitted review text's digest. The writer attests that a separate agent session performed the review and can post it through the same GitHub account used to author the pull request.
- CodeRabbit uses its native check run first and falls back to its authenticated commit status where applicable. Projects can require it through `requiredProviders: ["coderabbit"]`. `review.adapters.coderabbit` can declare an alternate `context`, an explicit `appId` or `actorId`, and accepted `proof` and `no_work` phrases.
- Greptile uses the exact-head GitHub review from the native bot ID set in `review.adapters.greptile.actorId`. A native approval qualifies. A commented review must match a configured `proof` phrase after trimming the leading and trailing whitespace on both sides.

The activity workflow signals submitted, edited, and dismissed reviews. The default-branch workflow resolves the signal to the live pull request and evaluates its current head. Receipt verification waits for newer policy runs for the same pull request or its source branch. GitHub's required check reflects the last published evaluation until a refresh finishes. Lisa's merge path also checks the live review evidence before merging. If GitHub holds the activity run for fork approval, a repository writer can dispatch the default-branch workflow directly.

## Issue labels

When CodeRabbit is enabled, read `.coderabbit.yml` or `.coderabbit.yaml`. If `issue_enrichment.labeling.auto_apply_labels` is `true`, require a nonempty `labeling_instructions` allowlist that excludes every `status:`, `type:`, and `points:` label and the configured `github.labels.build.human_needed` label, matched case-insensitively. The fallback label is `human-needed`. Turn automatic labeling off or narrow the allowlist if any of those labels are present. `lisa apply` updates the unedited Lisa template shipped from February 11 to March 1, 2026, to turn this option off. Report unreadable or malformed local configuration as a failure. When neither file exists, state that the organisation setting was outside the scope of the check.

References for the hosted workflow and native evidence are in the GitHub documentation. [Workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) · [Review API](https://docs.github.com/en/rest/pulls/reviews?apiVersion=2022-11-28) · [Check-run API](https://docs.github.com/en/rest/checks/runs?apiVersion=2022-11-28)

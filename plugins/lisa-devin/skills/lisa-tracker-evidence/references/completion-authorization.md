# Accepted completion proof

Merging a pull request makes work available for delivery. It does not authorize
closing the work item. The canonical `scripts/lisa-work-item.mjs complete` and
GitHub applying sweep require the same accepted-for-completion record before
adding a terminal label, removing competing lifecycle labels, closing an issue,
or changing a Linear item to its terminal state. Jira completion remains
unsupported. Intermediate deployment roles retain their existing behavior.

An absent record or pending delivery leaves the item open with its current owner
and labels. The command names the pending obligation and asks for canonical
Verify/evidence. An invalid record, unreadable provider, or failed write is a
different outcome. A workflow must not file a delivery-failure issue merely
because verification has not finished.

## Publish after verification

The canonical tracker-evidence skill performs these steps after real evidence
uploads and exact readbacks:

1. Capture the delivered behavior, required hosted checks, actual configured
   delivery, and every local typed evidence marker. Keep historical RED captures
   and expected refusal exits as captures; current required claims and criteria
   must independently pass.
2. Write canonical Verify usage, including explicit unavailable metrics when
   needed. The future native completion time (`acceptedAt`) remains null.
3. Prepare the record input below from actual native source and uploaded asset
   identities. Attach a structured CONFORMS report for the complete requirement
   conjunctions and current full specification.
4. Execute the shipped producer:

   ```sh
   node scripts/lisa-work-item.mjs publish-completion-proof \
     --ref acme/code#42 --record evidence/completion-record.json
   ```

   Linear uses its configured identifier and implementation GitHub repository.
   Both providers use the implementation repository's existing `pr-assets`
   release. The producer reads current native requirements/configuration,
   validates the actual attachment bytes and source/delivery, uploads a uniquely
   hash-named JSON asset without replacement, reads it back, then posts and reads
   back an exact native-item locator. The locator alone proves nothing.
5. Run canonical completion. Record the real native terminal readback and usage
   acceptance afterward. A pending result is retryable after its named proof
   obligation is satisfied; it does not authorize a manual close.

For a journey requiring a pending-state screenshot or state dump, capture and
upload that nonempty Phase-A artifact before publication/completion. Keep it
immutable. Append the later real terminal readback as a separate Phase-B
postcondition. Historical pending text in the earlier artifact is valid.

When a final requirement includes the terminal event itself, retain its claim
as an explicit pending postcondition in the complete phase ledger. The
accepted record's conjunctions and CONFORMS report cover only actual transition
inputs; they do not claim the future event passed. Keep the full final-spec
report PARTIAL until native Phase B, then attach the actual readback and update
the final required claim. Never fabricate a future closed state to obtain
pre-transition CONFORMS.

## Record contract

Schema version 1 has kind `lisa-completion-authorization`. The producer derives
the stable record ID, monotonic revision, predecessor digest, capture timestamp,
native item ID/provider/scope, repository ID/name, publisher ID, production
environment/branch and current `spec_sha256`. Input supplies:

- `state`: `accepted-for-completion`, `pending`, or `revoked`. A newer trusted
  pending, revoked or malformed revision never falls back to an older accepted
  record. Untrusted comments cannot select or revoke a record.
- `source`: primary `pull_request`, `pr_head`, actual `tested_head`, `merge_sha`,
  `declaring_commits`, `production_snapshot_sha`, and `delivered_sha`. These are
  distinct identities with native reconciliation, not a requirement that all
  SHAs be equal. The primary PR and source commits must declare this exact work
  item. A supplied `--pr-url` must identify that primary PR. Timeline mentions
  and a different work item's accepted record cannot substitute.
- `evidence`: rows with `evidence_id`, canonical `kind`, native `asset_id`, actual
  `bytes`, `sha256`, `captured_at`, and `artifact_head_sha`.
- `manifest`: one `{name, kind, evidence_id}` row for every local marker.
  `EVIDENCE-REF` is non-claiming and cannot satisfy a local marker.
- `verdicts`: actual native JSON asset pointers (`asset_id`, `bytes`, `sha256`)
  with role `remote` or `quality`. Each is schema2 PASS with passing criteria,
  positively established required claims, attached reaching evidence and
  `not_established_reviewed: true`. Each claim's evidence must also occur in its
  own verdict's evidence list with the same execution head and digest.
- `requirements`: unique `{requirement_id, operator: "all", claim_ids}` rows.
  Every required conjunct must be a validated required established claim.
  Canonical `required_evidence_kinds` remain alternatives; an explicit
  `evidence_operator: "all"` requires each listed kind.
- `obligations`: exactly `remote`, `conformance`, `typed_manifest`, `delivery`,
  `usage`, `linkage`, and `acceptance`. Each has an explicit boolean `required`
  and applicable status. Required values are `pass`, except conformance uses
  `CONFORMS` and acceptance uses `accepted-for-completion`.

The conformance obligation includes `requirement_ids` and a native `report`
asset pointer. Its JSON is `{verdict: "CONFORMS", work_item, spec_sha256,
requirements, scenario_names}`. Requirement rows include status `pass` and must
match the record's complete conjunction map; every primary acceptance scenario
must be covered. The usage obligation lists the actual canonical `entry_ids`.
The remote obligation lists empirical required `claim_ids` against the delivered
environment/source, beyond code-unit checks.

Runtime leaves require remote and delivery proof. Explicit doc-only,
config-only and type-only no-runtime declarations permit their corresponding
N/A reasons; no-local-markers permits only the empty manifest exemption.
Missing or duplicate environment declarations cannot grant an exemption.
Childless Story/Spike work remains a leaf. Container rollup is a separate path;
older blanket container wording in evidence guidance does not grant a new
terminal-writer bypass.

Attachments must be nonempty bounded actual native assets in this repository's
`pr-assets` release, with matching byte counts and SHA256. Canonical kinds are
screenshot, recording, http-transcript, cli-output, log-snippet, db-query-output,
perf-trace, test-run-log, deploy-log and state-dump. The reader validates actual
captured structure/header, not an extension. HTTP HEAD/204 and empty query rows
can be legitimate observations. Structure checks do not claim to evaluate the
visual truth of an image or the business meaning of every captured line.

## Delivery and publisher configuration

Configure the actual production delivery mechanism under
`verification.completion.delivery.<environment>`. For GitHub Actions, use
`mechanism: "github-actions"`, exact `workflow_path`, and permitted native
`events`. Records pin each actual run's `run_id`, `workflow_id`, `workflow_path`,
`event`, `attempt` and `head_sha`. The whole configured post-merge run must
finish successfully and reconcile with delivered source. Pre-merge CI and an
auxiliary green workflow cannot replace it. Artifact or external-deployment
projects declare their applicable mechanism and empirical attached
`evidence_refs`; npm, browser, cloud and device checks are not universal.

User publishers require fresh native repository write/maintain/admin permission
and matching stable native asset-uploader identity. Association labels, display
names and issue edit access are insufficient. `automationPublishers` defaults
to an empty array. A configured automation row requires stable Bot `user_id`,
`type: "Bot"`, `repository_id`, exact `workflow_id`, `workflow_path`, allowed
`events`, and branch `ref`. Its record producer additionally pins
`workflow_run_id`, `workflow_attempt`, and `workflow_head`.

The native asset belongs to the repository and uploader; exact native run
repository, workflow, ref, head, attempt and upload interval corroborate that
configured automation policy. This is not a cryptographic claim about which
step uploaded the asset. A bot can publish during its pinned attempt and gets
`published/pending-producer`. Completion remains pending until that exact native
attempt succeeds, without rewriting the asset. A failed/cancelled/timed-out
attempt cannot be upgraded by a later successful rerun. User records do not
gain an unnecessary producer-run requirement.

## Freshness and readbacks

The full primary specification is hashed except positively recognized canonical
accounting lines/tokens and closed-schema machine metadata. Unknown visible
prose and table rows inside the usage section remain hashed, including text
before its rollup. Fenced examples cannot declare runtime scope or machine
blocks. Duplicate declarations are refused.

Precisely delimited `lisa:completion-authorization` blocks exclude only the
JSON locator's six exact fields: `schema_version`, `record_id`, `revision`,
`repository`, `asset_id`, `sha256`. `lisa:completion-postcondition` blocks exclude
only JSON with `schema_version: 1`, `provider`, canonical `ref`, real `native_id`,
`record_sha256`, UTC `completed_at`, and native terminal `state` (`CLOSED` for
GitHub, `completed` for Linear). Unknown keys, prose, or visible requirements
inside either block remain part of the specification. These bookkeeping fields
must use the exact canonical compact or two-space JSON serialization; duplicate
keys and other raw forms remain hashed. These bookkeeping fields
never authorize completion or replace the actual native readback; publish them
only after observing the real terminal event. Do not add outside prose or
spacing as if it were part of the machine metadata block.

The reader checks the accepted production snapshot against a fresh native
branch tip and fully paginates native compare commits. Newer source declaring
this same item anywhere from delivered source through the accepted snapshot to
the current tip requires fresh proof; unrelated newer work does not invalidate
it. It re-reads the trusted record, native scope, canonical usage, backlink and
lifecycle state immediately before mutation, preserving freshly observed owner
and unrelated labels. This is bounded authoritative rereading and post-write
verification, not a distributed atomic transaction.

The shipped Node usage parser is the same implementation used by the TypeScript
facade and works in a host without application `dist`. Local advisory Stop-hook
files cannot authorize production writes. Protocol version 1.2.0 adds these
verdict semantics; normal generator checks maintain its dependent versions.

# Accepted completion proof

Merging a pull request makes work available for delivery. It does not authorize
closing the work item. The canonical `scripts/lisa-work-item.mjs finish` (alias `complete`) and
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
   Both providers use the implementation repository's configured evidence
   release (see Delivery and publisher configuration). The producer reads current native requirements/configuration,
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
config-only, type-only and test-only no-runtime declarations permit their
corresponding N/A reasons. That reason set is closed and is exactly
`NO_RUNTIME_REASONS` in `scripts/lib/completion-proof-shape.mjs`; any other
reason grants no exemption. No-local-markers permits only the empty manifest
exemption.
Missing or duplicate environment declarations cannot grant an exemption.
Childless Story/Spike work remains a leaf. Container rollup is a separate path;
older blanket container wording in evidence guidance does not grant a new
terminal-writer bypass.

Attachments must be nonempty bounded actual native assets in one of this
repository's accepted evidence releases, with matching byte counts and SHA256. Canonical kinds are
screenshot, recording, http-transcript, cli-output, log-snippet, db-query-output,
perf-trace, test-run-log, deploy-log and state-dump. The reader validates actual
captured structure/header, not an extension. HTTP HEAD/204 and empty query rows
can be legitimate observations. Structure checks do not claim to evaluate the
visual truth of an image or the business meaning of every captured line. Six
kinds must be captured as JSON with specific fields; see
[Typed capture shapes](#typed-capture-shapes).

Native JSON reads use a separate 16 MiB ceiling per response, including the
complete slurped output of a paginated listing. The immutable proof record
remains limited to 2 MiB. Page and row limits are additional bounds: a listing
with at most 100 pages or 10,000 comments can still exceed its byte ceiling and
must fail closed without a lifecycle write. Visible local evidence markers
claim attachments; fenced or indented examples and HTML comments do not. A
marker on a list item's continuation line is visible: indentation is measured
from the content column of the list item that holds it, so only a line four or
more columns past that, outside a paragraph, is an indented example. The
conformance check reads `## Acceptance Criteria` in any case, with any internal
spacing and optional closing `#`s. When no such heading exists but a visible
line names the criteria some other way (`### Acceptance Criteria`, a bold
`**Acceptance Criteria**`, `## Acceptance Criteria:`, or the name underlined
with `---` or `===`), the check refuses and
asks for the heading to be renamed rather than reading zero scenarios.

An ordinary pending result from `finish` or the applying sweep exits zero
because it preserves the nonterminal state. A refused `publish-completion-proof`
exits nonzero when no locator was published. A successful bot publication with
category `published/pending-producer` remains a successful publication; only
completion waits for its pinned producer attempt.

### Typed capture shapes

Some evidence kinds are checked for structure, not just presence. For those
kinds a plain-text capture is refused on purpose, even when it is a faithful
copy of what the terminal showed: text cannot be checked for the facts the
kind promises (which request was sent, which rows came back, which command
exited how). Save these captures as a JSON file with the fields below.

| Kind | What the JSON must contain |
|---|---|
| `http-transcript` | `request.method` and `request.url` (non-empty text), and `response.status` (a whole number from 100 to 599). `response.body` must be present (it may be empty) unless the status is 204 or the method is HEAD. |
| `db-query-output` | `query` (the query text, non-empty) and `rows` (a list; an empty list is a valid result). |
| `state-dump` | At least one of `state`, `data`, `response` or `records` (what was observed), and at least one of `id`, `source`, `command` or `captured_at` (where or when it was read). |
| `cli-output` | `command` (text, or a non-empty list of text), `stdout` and `stderr` (text; may be empty), and the exit code as a whole number under `exit_code`, `exitCode`, `exit` or `status`. |
| `deploy-log` | Either a finished pipeline run (`status: "completed"`, a non-empty `conclusion`, and a whole-number `id` or a `workflow_path`), or a `cli-output` shape whose `stdout` mentions a deploy, release or health check. |
| `perf-trace` | `methodology` (text or an object) and a non-empty `measurements` list where every item has `metric` (text), `value` (a finite number) and `unit` (text). |

`test-run-log` and `log-snippet` accept plain text. A test-run log needs two
things somewhere in the file:

- a count from the runner's summary: a number that is not zero followed by a
  space and `passed`, `passing`, `failed` or `failing` (any letter case, for
  example `3 passed` or `1 failed`), or a TAP line `# pass <n>` / `# fail <n>`
  whose count starts with 1–9. A failed run is still a real capture.
- a test marker: `✓`, `PASS` (capital letters), `ok <n>`, `testName`,
  `test_name`, `fullName`, or ` > ` (space, greater-than, space, as in
  `file > suite > test`).

A log snippet needs a timestamp whose date is written `YYYY-MM-DD`, followed by
`T` or a space and the time, for example `2026-11-13T08:00:01` or
`2026-11-13 08:00:01`. Syslog-style dates (`Nov 13 08:00:01`) and epoch numbers
(`1763020801`) are refused. As JSON, a log snippet can instead be
`{source, lines}` with at least one line.

For the JSON kinds, the fields may sit at the top of the file or inside other
objects or lists, nested up to 12 levels deep. That lets one file carry the raw
text you captured and where it came from (command, file path, checksum) beside
the typed object, for example
`{"raw": "<the terminal text>", "provenance": {...}, "capture": {<typed object>}}`.
For those kinds only the typed object is checked; the extra fields are kept for
readers. The text checks for `test-run-log` and `log-snippet` read the whole
file, wrapper included.

Minimal accepted examples:

<!-- capture-example: http-transcript -->
```json
{
  "request": { "method": "GET", "url": "https://example.invalid/health" },
  "response": { "status": 200, "body": "{\"ok\":true}" }
}
```

<!-- capture-example: db-query-output -->
```json
{
  "query": "SELECT id, status FROM orders WHERE id = 42",
  "rows": [{ "id": 42, "status": "shipped" }]
}
```

<!-- capture-example: state-dump -->
```json
{
  "source": "orders service GET /orders/42",
  "captured_at": "2026-11-13T08:00:00Z",
  "state": { "id": 42, "status": "shipped" }
}
```

<!-- capture-example: cli-output -->
```json
{
  "command": ["bun", "run", "check"],
  "stdout": "all checks passed\n",
  "stderr": "",
  "exit_code": 0
}
```

<!-- capture-example: deploy-log -->
```json
{
  "id": 123456789,
  "workflow_path": ".github/workflows/deploy.yml",
  "status": "completed",
  "conclusion": "success"
}
```

<!-- capture-example: perf-trace -->
```json
{
  "methodology": "500 sequential requests against staging from one client",
  "measurements": [{ "metric": "p95_latency", "value": 120, "unit": "ms" }]
}
```

<!-- capture-example: test-run-log -->
```text
 ✓ tests/unit/health.test.ts > health endpoint > returns 200
 Tests  1 passed (1)
```

<!-- capture-example: log-snippet -->
```text
2026-11-13T08:00:01.120Z INFO orders order 42 marked shipped
```

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

### CodePipeline (CDK hosts)

A CDK host's GitHub Actions workflow releases but does not deploy; its AWS
CodePipeline does. Declare the pipeline that delivers each environment:

```json
{
  "verification": {
    "completion": {
      "delivery": {
        "production": {
          "mechanism": "aws-codepipeline",
          "pipeline_name": "<pipeline name>",
          "region": "<aws-region>",
          "account_id": "<12-digit AWS account id>"
        }
      }
    }
  }
}
```

The accepted record's `obligations.delivery` pins the one execution that
delivered the change:

```json
{
  "required": true,
  "status": "pass",
  "mechanism": "aws-codepipeline",
  "pipeline_name": "<pipeline name>",
  "region": "<aws-region>",
  "account_id": "<the configured account_id, when one is set>",
  "execution_id": "<pipeline execution id>",
  "source_revision": "<the record's source.delivered_sha>"
}
```

Completion reads that one execution read-only, with
`aws codepipeline get-pipeline-execution --pipeline-name=<name> --pipeline-execution-id=<id> --region=<region> --output json`,
and decides from it:

- **Accepted**: the execution `Succeeded` and one of its `artifactRevisions` is
  the delivered commit. The completion report names the pinned execution.
- **`pending-proof`**: the execution is still `InProgress`, including one
  waiting at a manual approval. It is never reported as delivered, and the
  message names the waiting execution. The same category is returned when the
  configuration names the mechanism without `pipeline_name` and `region`.
- **`invalid-proof`**: the execution carried another commit (the message names
  both revisions); it ended `Failed`, `Stopped`, `Superseded` or `Cancelled`,
  or is `Stopping`; the record names another pipeline or region than the
  configuration; or its execution id is missing or malformed.
- **`read-error`**: the execution could not be read, or the reply carried no
  pipeline execution.

To find the execution id, list the pipeline's executions with
`aws codepipeline list-pipeline-executions --pipeline-name <name> --region <region>`
and pick the execution whose `sourceRevisions[].revisionId` is the delivered
commit. That listing needs `codepipeline:ListPipelineExecutions`; completion
itself needs only the `GetPipelineExecution` read.

`account_id` binds the delivery to one AWS account. Stage accounts often run
pipelines with the same name, so without it, credentials for a dev account can
read a dev execution as production delivery. When `account_id` is set, the
record must carry the same value, and completion first runs
`aws sts get-caller-identity --output=json`: credentials for another account
are refused (`invalid-proof`, naming both accounts) before any execution is
read. `sts:GetCallerIdentity` needs no IAM grant; every valid credential may
call it.

The verifier needs no write permission. Its credentials need
`codepipeline:GetPipelineExecution` on the pipeline, on top of the list grant
the observer role already carries (Lisa's remote-agent AWS setup). `lisa doctor`
warns about a CDK project whose `production` delivery is undeclared, and about
an `aws-codepipeline` delivery without a valid `account_id`.

Until a host configures this mechanism, it may declare
`mechanism: "external-deployment"` instead. Its record must then attach, as
empirically verified `evidence_refs`, the CodePipeline execution id, that
execution's source revision and its final status, captured read-only with the
same `aws codepipeline get-pipeline-execution` call. Lisa cannot check that
evidence against the pipeline, which is why the native mechanism is preferred.

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

`verification.completion.evidenceRelease` names the GitHub release proof and
evidence are uploaded to. It defaults to `pr-assets`. The token `{YYYY-MM}`
resolves to the current UTC year-month at publish time, so
`pr-assets-{YYYY-MM}` rotates monthly and keeps each release under GitHub's
1000-file limit. Names use letters, digits, `.`, `_` and `-`, at most 100
characters; `{YYYY-MM}` is the only placeholder. The publisher creates a
missing release (never marked Latest). When the resolved release already
holds 950 or more files it rolls over to the next overflow release,
`<release>-2`, then `-3`, up to `-99`, creating and capacity-checking each one
the same way, instead of failing on GitHub's raw HTTP 422. If an upload still
hits GitHub's limit (another publisher filled the release meanwhile), it rolls
over once more and retries. It refuses, in plain words, only when every
overflow release of the period is full, or when the release name is too long
to take an overflow suffix (GitHub allows 100 characters), in which case it
names the full release. Its advice leads with pruning
(`node scripts/lisa-evidence-prune.mjs --release <release>`) when the release
already rotates, and suggests a rotating name only when it does not. Nothing is
ever deleted to make room.
`node scripts/lisa-work-item.mjs evidence-release` prints the period's first
release name without touching GitHub; `--ensure` also creates the release,
rolls over past full ones, and prints the release that has room.

The validator accepts assets from the legacy `pr-assets` release, from any
release matching the configured name or template, and from any name or
template listed in `verification.completion.acceptedEvidenceReleases`, so
proof published before a rename or rotation keeps validating. Each of those
names also accepts its `-2` … `-99` overflow releases, so proof in an overflow
release, or in an earlier period's release, keeps validating on `finish`. Only
releases in the implementation repository are accepted.

`LISA_EVIDENCE_RELEASE` pins the concrete release for one run. Skills resolve
it once with `evidence-release --ensure`, stop when that refuses, and pass the
printed name inline (`LISA_EVIDENCE_RELEASE=<name>`) on every later command,
because some agent runtimes start a new shell for each command and lose an
exported value; that keeps links and uploads on the same release. It must be
one of the accepted releases. Every command honours it:
`evidence-release --ensure` creates and capacity-checks it, and
`publish-completion-proof` uploads the completion record to it and reads it
back from it. The publisher and `evidence-release` share one resolver, so the
release the publisher uploads to is always the one `evidence-release --ensure`
prints in the same environment; plain `evidence-release` does not roll over, so
after a rollover it can name the full release instead. A pin is an exact
choice: a full pinned release is refused and never rolls over. Unset `LISA_EVIDENCE_RELEASE` to let Lisa roll
over, or pin a release that has room.

Creating an evidence release is a real GitHub release: it fires `release`
webhook and workflow events and adds a git tag of the same name. Workflows
triggered `on: release` should skip evidence releases, for example with
`if: ${{ !startsWith(github.event.release.tag_name, 'pr-assets') }}` adapted to
the configured name. Lisa creates them with `--latest=false` and the release
notes "Evidence storage only — not a product release."

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

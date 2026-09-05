# Usage Accounting

> Demoted from the always-on eager tier by CodySwannGT/lisa#3992. The
> section below is the former eager head, preserved verbatim; the full
> contract follows it. Reachable on demand via `rules/eager/00-rule-index.md`.

## Usage Accounting (load-bearing)

Lisa attaches AI usage and cost telemetry to every artifact it creates/updates. The format is a single canonical managed section.

## Managed section

Every artifact with inline body content gets exactly one section:

```markdown
## Lisa Usage
```

**Canonical. Rewrite in place; never append a second usage section.** If the host can't safely edit body, write the same section in a comment and treat that comment as the managed artifact for future rewrites.

## Required field semantics

Each direct entry records ONE logical Lisa run on ONE artifact. `entry_id` is the stable dedupe key — rewriting the same logical run with the same `entry_id` updates in place; a different run gets a different `entry_id`.

- **`source`**: `observed` (runtime supplied) / `estimated` (derived from trustworthy metadata + pricing contract) / `measured-subset` (a trustworthy subtotal exists, but the complete run total is unknown) / `unavailable`.
- **`measured_subset_tokens`**: optional measured subtotal for `measured-subset` entries only. Omission is normalized to `null` for backward-compatible callers. Keep `total_tokens = null` so rollups do not treat a subset as a complete total.
- **`pricing_status`**: same trinary plus `missing` (cost not known but should be).
- **Absence ≠ zero.** `null` means unknown; `0` means explicitly zero. Always write the entry — never silently omit.
- Do NOT replace observed counts with estimates.

## Rollup

Container artifacts (Epic, PRD, etc.) roll up usage from their direct children. Roll-up is recursive — a parent's `## Lisa Usage` aggregates its descendants' direct entries. Re-writes are idempotent: re-running an intake or lifecycle skill must not duplicate entries.

Measured-child incompleteness is durable across ordinary rewrites through the optional
`lisa:usage-rollup-token-status` extension. Do not infer completeness merely because a rewrite did
not re-fetch child ledgers.

---

Lisa usage accounting is a vendor-neutral contract for attaching AI usage and cost telemetry to the artifacts Lisa creates or updates. It governs the section shape, machine-readable tokens, source/pricing semantics, rollup behavior, and idempotent rewrite rules. Writer skills and lifecycle skills attach telemetry by following this contract; they do not invent artifact-local formats.

## Managed section

Artifacts that support inline body/description content use a single managed section:

```markdown
## Lisa Usage
```

The section is canonical. Rewrite it in place; never append a second usage section under a different heading. If an artifact host cannot safely edit the body, write the same section format in a comment instead and treat that comment body as the managed usage artifact for future rewrites.

The visible body is for humans; the hidden tokens are for machines. Both are required.

## Direct-entry schema

Each direct usage entry records one logical Lisa run or sub-run on one artifact. The required semantic fields are:

| Field | Meaning |
|---|---|
| `entry_id` | Stable dedupe key for this logical usage entry. Unique within the artifact graph. |
| `flow` | `research`, `plan`, `implement`, `verify`, `debrief`, `intake`, `repair-intake`, `monitor`, or a command slug. |
| `run_id` | Runtime/session identifier when available; empty only when the runtime exposes no stable run id. |
| `provider` | Model provider name. |
| `model` | Model identifier. |
| `source` | `observed`, `estimated`, `measured-subset`, or `unavailable`. |
| `input_tokens` | Prompt/input tokens, or `null` when unavailable. |
| `cached_input_tokens` | Cached/reused input tokens, or `null` when unavailable/not exposed. |
| `output_tokens` | Output/completion tokens, or `null` when unavailable. |
| `reasoning_tokens` | Reasoning/internal tokens, or `null` when unavailable/not exposed. |
| `total_tokens` | Total trustworthy tokens for the entry, or `null`. |
| `measured_subset_tokens` | Optional trustworthy measured subtotal for a known subset of the run. Omission is normalized to `null` so callers written before this field remain source-compatible. |
| `cost` | Observed or estimated cost for this entry, or `null`. |
| `currency` | ISO currency code when `cost` is known, otherwise `null`. |
| `pricing_status` | `observed`, `estimated`, `missing`, or `unavailable`. |
| `pricing_source` | Runtime billing source, config/pricing snapshot ref, or `null`. |
| `artifact_ref` | Canonical ref of the artifact carrying the entry. |
| `parent_artifact_ref` | Canonical parent artifact ref when the entry is attached below a parent, otherwise empty. |

`entry_id` must be stable across rewrites of the same logical run. Rewriting an existing entry with the same `entry_id` updates it in place. A different run gets a different `entry_id` and is appended as a new direct entry.

## Source semantics

`source` describes how trustworthy the token counts are:

- `observed`: the runtime supplied the usage directly. Do not replace observed counts with estimates.
- `estimated`: Lisa derived counts or cost from trustworthy runtime metadata plus an explicit pricing contract. Estimates are allowed only when the derivation inputs are real and attributable to the run.
- `measured-subset`: Lisa measured a known subset of the run, but not enough to claim a complete `total_tokens` value. Preserve the subtotal in `measured_subset_tokens`, keep `total_tokens = null`, and keep rollup totals unknown instead of treating the subset as the whole run.
- `unavailable`: Lisa could not obtain trustworthy usage data. Write the entry anyway with `null` token/cost fields rather than silently omitting the row.

The absence of data is never treated as zero. `null` means unknown; `0` means explicitly observed or derived zero.

For example, an unavailable Verify run still records a direct entry with `source = unavailable`,
`pricing_status = unavailable`, and `null` token/cost fields so downstream readers can distinguish
"missing telemetry" from "zero usage." A Plan run with measured sub-agent usage but unmeasured
main-loop usage records `source = measured-subset`, `measured_subset_tokens = <subtotal>`, and
`total_tokens = null` so the subtotal is durable without being misrepresented as the complete run
total.

## Pricing semantics

`pricing_status` describes how trustworthy the money fields are:

- `observed`: runtime supplied a trustworthy monetary cost.
- `estimated`: Lisa calculated cost from trustworthy token counts plus explicit pricing metadata.
- `missing`: token counts are known but no trustworthy price source exists yet.
- `unavailable`: the runtime exposed neither trustworthy cost nor enough trustworthy token data to estimate cost.

Runtime-observed cost always wins over estimates. Estimated cost never overwrites an observed value. Missing pricing preserves token counts and a `null` cost.
Token completeness and cost trust are independent: a `measured-subset` entry may still carry an
observed trustworthy whole-run cost. Token rollups remain unknown, but that cost participates in
cost rollups under the normal pricing and currency rules.

## Machine-readable tokens

Every visible direct entry row has a corresponding backward-compatible 17-field primary token:

```text
<!-- lisa:usage-entry entry_id=<id> flow=<flow> run_id=<run-id> provider=<provider> model=<model> source=<source> input_tokens=<n|null> cached_input_tokens=<n|null> output_tokens=<n|null> reasoning_tokens=<n|null> total_tokens=<n|null> cost=<decimal|null> currency=<code|null> pricing_status=<status> pricing_source=<ref|null> artifact_ref=<ref> parent_artifact_ref=<ref-or-empty> -->
```

**Entry tokens are never rendered inside a table row.** They occupy their own lines below the
visible table, and they correlate to their rows by `entry_id`, not by position. Hosts that
normalize markdown re-serialize a table from its parsed cell model and discard anything that is
not a cell: measured against Linear on 2026-08-04, an HTML comment trailing a table row is
destroyed on write while the same comment on its own line round-trips byte-identically. The
row-trailing layout therefore produced a ledger that reported a successful write, rendered
correctly for humans, and enumerated **zero** entries — with a surviving rollup token still naming
them. Parsing is position-agnostic and always has been, so sections written in the historical
row-trailing layout still enumerate, and migrate to the own-line layout on their next rewrite.

The primary token is immediately followed on the same line by a correlated measured-subset
extension. Writers serialize an omitted value as `null` instead of `undefined`:

```text
<!-- lisa:usage-entry-measured-subset entry_id=<id> measured_subset_tokens=<n|null> -->
```

The primary field order is fixed and deliberately matches the pre-measured-subset contract so
legacy 17-field readers continue to enumerate entries. Current readers correlate the extension by
its percent-encoded `entry_id`. They also accept the `@codyswann/lisa@2.222.0` transitional marker,
which placed `measured_subset_tokens` between `total_tokens` and `cost`, and migrate it to the
primary-plus-extension layout on rewrite. Only that transitional additive field accepts the literal
`undefined` emitted by an older caller and normalizes it to `null`; established numeric fields
remain strict. String fields are percent-encoded before rendering and decoded after parsing, so
whitespace, commas, and HTML comment terminators inside source values cannot split or truncate the
token.

Every managed section also ends with exactly one rollup token:

```text
<!-- lisa:usage-rollup direct_entry_ids=<csv> child_entry_ids=<csv> child_refs=<csv> direct_tokens=<n|null> child_tokens=<n|null> total_tokens=<n|null> direct_cost=<decimal|null> child_cost=<decimal|null> total_cost=<decimal|null> currency=<code|null> -->
```

- `direct_entry_ids` enumerates the entries attached directly to the current artifact.
- `child_entry_ids` enumerates deduped descendant entry ids included in the rollup.
- `child_refs` enumerates the child artifacts consulted for the rollup.
- `total_*` fields equal direct plus child totals over the deduped entry set.

If a direct entry or freshly resolved child entry is `measured-subset`, the corresponding token
scope and combined `total_tokens` are `null`; a measured subtotal is never added to complete token
counts. Other established nullable-entry behavior is unchanged. Cost rollups are computed
independently, so a trustworthy whole-run cost is not discarded merely because token completeness
is unknown.

When freshly resolved child work contains a measured subset, the primary rollup token is followed
by this optional backward-compatible extension:

```text
<!-- lisa:usage-rollup-token-status child_tokens_incomplete=true -->
```

The extension preserves child-token incompleteness across ordinary direct-entry rewrites that do
not resolve children again. It is omitted when child token totals are not known to be incomplete,
so legacy rollup objects and readers retain their established shape.

The rollup token is the machine-readable summary. The visible rollup table mirrors it for humans. List fields are comma-delimited after encoding each item independently; commas inside an item are encoded as data, not treated as separators.

## Visible rendering contract

The canonical body layout is:

```markdown
## Lisa Usage

_Managed by Lisa. Regenerated on each usage update; do not edit by hand._

### Direct Usage

| Flow | Model | Source | Tokens | Cost |
|---|---|---|---:|---:|
| ...human-readable rows, cells only, no tokens... |

<!-- lisa:usage-entry ... --> <!-- lisa:usage-entry-measured-subset ... -->

### Rollup

| Scope | Tokens | Cost |
|---|---:|---:|
| Direct | ... | ... |
| Child | ... | ... |
| Total | ... | ... |

<!-- lisa:usage-rollup ... -->
```

Every machine-readable token sits on its own line, outside every table. One entry contributes one
token line; multiple entries contribute consecutive token lines in the same order as their visible
rows.

Writers may add host-specific surrounding prose, but they must preserve the heading, the managed-note line, the direct-entry tokens, and the single rollup token.

## Write verification

A write surface can accept a section, report success, and silently destroy part of it. **Verify
every managed write by reading the stored bytes back and parsing them — never by the mutation's
return value.** A write is successful only when the stored surface satisfies the rollup/entry
agreement invariant below. A caller that cannot verify a surface must fall back to one it can, or
fail loudly; it must never report success over an unreadable ledger.

- Every `entry_id` in the rollup's `direct_entry_ids` resolves to a parseable direct entry in the
  same section.
- Every parseable direct entry in the section appears in the rollup's `direct_entry_ids`.
- Every entry the caller just wrote is parseable from the stored surface.

`verifyLisaUsageSectionIntegrity` in the shared utility layer implements exactly these checks and
returns structured issue codes (`missing-section`, `missing-entry-token`, `missing-rollup-token`,
`unrecorded-entry`). Callers run it against the read-back body, not against the payload they sent.

## Rollup and dedupe behavior

Rollups aggregate descendant usage from native tracker hierarchy, documented generated-work references, and explicit `parent_artifact_ref` links. Within one artifact rollup:

- Dedupe strictly by stable `entry_id`.
- Count each `entry_id` at most once even if the same descendant is discoverable through more than one path.
- Preserve direct totals separately from child totals.
- Exclude descendant entries whose `entry_id` is already present in the artifact's direct-entry set.

Concrete example: if child artifact A and child artifact B both surface descendant entry
`verify-123`, the parent rollup lists `verify-123` once in `child_entry_ids`. If the parent also
records `verify-123` directly, exclude that descendant copy from child totals and keep the entry in
the direct half only.

The rollup contract is additive across the hierarchy: PRDs may roll up Epics/Stories/leaves, and leaves may roll up evidence or verification artifacts, without double counting shared descendants.

## Idempotent rewrite rules

- There is exactly one managed `## Lisa Usage` section per artifact body/comment.
- Recompute the entire section on every write; never append ad hoc rows.
- Sort direct entries deterministically by `(flow, run_id, entry_id)`.
- Preserve existing entries with unchanged `entry_id` and refreshed field values.
- Re-running with the same logical entry set must produce byte-identical output. Rewriting a legacy
  primary-only marker or the 2.222.0 transitional marker migrates once to the canonical
  primary-plus-extension layout; subsequent rewrites are byte-identical.
- Do not include timestamps in the section preamble or token lines.

Idempotency is enforced by `entry_id` for direct entries and by the fixed rollup token field order for totals.

---
name: lisa-usage-accounting
description: "Shared usage-ledger utility for…"
allowed-tools: ["Skill", "Read", "Bash"]
---

# Usage Accounting: $ARGUMENTS

Single chokepoint for Lisa usage-ledger writes. Caller skills (`research`, `plan`,
`implement`, `verify`, `debrief`, `intake`, `prd-source-write`, `tracker-write`,
`tracker-evidence`, later rollup/monitor flows) MUST delegate usage-entry writes and
rollup refreshes through this skill rather than hand-editing artifact bodies or comments.

This skill does not define the ledger format itself. The durable schema, token order,
rewrite invariants, and rollup semantics live in the `usage-accounting` rule. This skill
applies that contract to real artifacts and chooses the safest writable surface.

## Invocation contract

The caller passes exactly one operation plus its arguments:

```text
operation: record
artifact_ref: github:CodySwannGT/lisa#729
artifact_kind: github-issue
entry: { ...LisaUsageEntry fields... }

operation: rollup
artifact_ref: github:CodySwannGT/lisa#724
artifact_kind: github-issue
child_refs:
  - github:CodySwannGT/lisa#729
  - github:CodySwannGT/lisa#730

operation: record_and_rollup
artifact_ref: github:CodySwannGT/lisa#724
artifact_kind: github-issue
entry: { ...LisaUsageEntry fields... }
child_refs:
  - github:CodySwannGT/lisa#729
```

Required arguments:

- `operation`: one of `record`, `rollup`, or `record_and_rollup`.
- `artifact_ref`: canonical artifact identifier for the target being updated.
- `artifact_kind`: the writable host surface (`github-issue`, `github-pr-comment`, `jira-ticket`,
  `linear-issue`, `notion-page`, `confluence-page`, `markdown-file`, or another caller-defined
  host string with a matching read/write adapter).

Operation-specific arguments:

- `record` requires `entry`.
- `rollup` requires `child_refs` (empty is allowed when the caller wants a direct-only refresh).
- `record_and_rollup` requires `entry` and may also pass `child_refs`.

Optional arguments:

- `attachment_preference`: `body-first` (default) or `comment-only`.
- `comment_ref`: existing managed comment identifier when the ledger already lives in a comment.
- `parent_artifact_ref`: explicit parent for callers that need to anchor descendant rollups.
- `existing_body`: caller-supplied body snapshot when it already owns a fresh read.

The `entry` payload MUST satisfy the canonical usage-entry contract from the rule: stable
`entry_id`, `flow`, `run_id`, provider/model, source semantics, token fields, pricing fields,
and artifact refs. Callers do not get to omit the "unavailable" case; when trustworthy usage is
missing they still pass an explicit entry with `source: unavailable` and nullable token/cost
fields.

When the runtime exposes only a trustworthy subtotal, callers MUST use `source: measured-subset`,
write the subtotal to `measured_subset_tokens`, and leave `total_tokens: null`. Do not coerce a
known subset into `total_tokens`; rollups use `total_tokens` only for complete totals.

## Return shape

Return structured output so callers can persist or log what happened without reparsing prose:

```yaml
outcome: updated | comment-fallback | no-op | blocked
artifact_ref: "github:CodySwannGT/lisa#729"
surface:
  kind: body | comment
  ref: "<artifact or comment identifier>"
entry_ids:
  direct:
    - "<entry-id>"
  child:
    - "<rolled-up-child-entry-id>"
rollup:
  direct_tokens: 1200
  child_tokens: 450
  total_tokens: 1650
  direct_cost: 0.42
  child_cost: 0.17
  total_cost: 0.59
warnings:
  - "<warning text>"
error:
  code: "<stable-code>"
  message: "<exact failure text>"
  remediation: "<next step>"
```

- `updated` means the preferred writable surface was updated successfully.
- `comment-fallback` means body/description edits were unsafe, so the canonical ledger landed in a
  managed comment instead.
- `no-op` means the requested operation produced byte-identical ledger output.
- `blocked` means the caller asked for a write that could not be completed; preserve the exact host
  failure text.

## Workflow

### Step 1 — Read the current managed surface

1. Resolve the target artifact from `artifact_ref` / `artifact_kind`.
2. Prefer a caller-supplied `existing_body` when present and trustworthy for this write.
3. Otherwise read the current body/description from the host's native adapter.
4. If the caller passed `comment_ref`, read that managed comment body too.

Never guess the prior ledger state. Always start from the current managed body/comment so rewrite
idempotency is preserved.

### Step 2 — Choose the writable surface

Default policy is **body first**:

- If the host body/description is writable by the caller's normal writer path, update the body in
  place and keep the canonical `## Lisa Usage` section there.
- If direct body edits are unsafe, unavailable, or likely to clobber other writer-owned content,
  fall back to a **single managed comment** containing the same canonical section.
- If the caller explicitly passes `attachment_preference: comment-only`, skip the body attempt and
  write the managed comment directly.

The fallback is part of the contract, not an error. Writers should prefer the artifact body they
already own, but evidence comments, immutable PR descriptions, or size-limited hosts may require
the managed comment path.

### Step 3 — Apply the requested operation

All three operations use the shared utilities and rule contract; they differ only in which inputs
they require and whether they recompute child totals:

- `record`: upsert exactly one direct usage entry on the target artifact. Rewrite the entire
  `## Lisa Usage` section in place using the canonical serializer; never append ad hoc rows.
- `rollup`: recompute the rollup token and visible totals from the target's current direct entries
  plus usage discovered from `child_refs`. Dedupe strictly by stable `entry_id`.
- `record_and_rollup`: first upsert the direct entry, then refresh totals against `child_refs` in
  the same managed write so callers do not produce split-brain ledger states.

The implementation path should use the shared utility layer (`parseLisaUsageSection`,
`mergeLisaUsageEntries`, `createLisaUsageRollup`, `upsertLisaUsageSection`) rather than duplicating
token parsing or markdown rendering in each caller.

### Step 4 — Persist and report

1. If the rendered ledger body is byte-identical to the current managed surface, return `outcome:
   no-op`.
2. Otherwise write the body or managed comment through the host adapter.
3. Return the exact writable surface used, direct entry ids, rolled-up child entry ids, totals, and
   any fallback warning.

If the host write fails, preserve the exact error text in `error.message`. Do not collapse write
failures into a generic "usage update failed."

## Rules

- Never invent a per-flow usage format. All usage-ledger writes go through this skill and the
  canonical `usage-accounting` rule.
- Never append a second `## Lisa Usage` section or a second managed usage comment.
- Never treat missing usage as zero. Callers must record explicit `source: unavailable` entries.
- Never skip rollup dedupe. Child totals are keyed by stable `entry_id`, not by child ref count.
- Never silently drop to comments. Return `outcome: comment-fallback` so the caller can surface the
  writable surface that actually holds the ledger.
- Never overwrite unrelated artifact body content. Rewrite only the managed usage section/comment.

---
name: usage-accounting
description: "Attach and roll up Lisa token/cost usage ledgers on PRDs, tickets, evidence, debrief docs, and intake summaries. Reads the usage-accounting rule for the canonical ledger schema; records observed usage when available, explicit estimates when configured, and unavailable rows instead of fabricating token counts."
allowed-tools: ["Skill", "Bash", "Read", "Edit", "Write", "Grep"]
---

# Usage Accounting: $ARGUMENTS

Attach or refresh the `## Lisa Usage` ledger for a lifecycle artifact.

This skill implements the `usage-accounting` rule. Read that rule for the canonical ledger schema, source semantics, cost formula, and rollup behavior; do not invent another format.

## Input

Pass a structured block:

```yaml
operation: record | rollup | record_and_rollup
artifact_ref: "<vendor-qualified ref>"
artifact_type: "prd|epic|story|task|sub-task|bug|spike|improvement|pr|evidence|debrief|intake-cycle"
parent_ref: "<optional parent artifact ref>"
flow: "research|plan|implement|verify|debrief|intake|repair-intake|monitor"
run_id: "<runtime session/run id or generated id>"
provider: "<provider or unknown>"
model: "<model or unknown>"
source: observed | estimated | unavailable
usage:
  input_tokens: 0 | null
  cached_input_tokens: 0 | null
  output_tokens: 0 | null
  reasoning_tokens: 0 | null
  total_tokens: 0 | null
  estimated_cost: "0.00" | null
  currency: "USD"
pricing:
  status: observed | priced | partial | missing | unavailable
  ref: "<runtime-billing-export | config:usage.pricing.models.<model> | none>"
children:
  - "<child artifact ref>"
```

If usage is not available, set `source: unavailable` and all token/cost fields to `null`. Do not guess.

## Workflow

1. **Validate source semantics.**
   - `observed` requires runtime/API/CLI/billing usage data in the current context.
   - `estimated` requires a named tokenizer/model or another explicit estimation source.
   - `unavailable` requires token and cost fields to be `null`.
   - If the source and values conflict, stop and correct the record before writing.
2. **Resolve pricing when needed.**
   - If `estimated_cost` is already runtime-observed, preserve it and set `pricing.status: observed`.
   - Otherwise read `.lisa.config.local.json` then `.lisa.config.json` `usage.pricing.models[provider/model]`.
   - If pricing is present, calculate cost with the formula in `usage-accounting`.
   - If pricing is missing, keep `estimated_cost: null` and set `pricing.status: missing`.
3. **Fetch the artifact body or comment target.**
   - PRD source artifacts: use the source's native read/write path (Notion / Confluence / GitHub / Linear / file) or the PRD writer that already owns the artifact.
   - Tracker work items: use `lisa:tracker-read` for reads and the matching vendor writer/update path for safe description edits. If the vendor path forbids description edits in this context, post a comment with the same ledger instead.
   - Evidence artifacts: update `evidence/comment.md` / `comment.txt` before `tracker-evidence` posts them.
   - Debrief docs and files: use `Read` + `Edit` / `Write`.
4. **Parse existing entries.**
   - Read existing `<!-- lisa:usage-entry ... -->` tokens from the artifact body and comments available in context.
   - Deduplicate by `entry_id`.
   - Preserve entries for other flows/runs unless an incoming entry has the same `entry_id`.
5. **Render the managed section.**
   - Update or append `## Lisa Usage`.
   - Include the readable table and machine-readable `lisa:usage-entry` tokens.
   - Do not add timestamps outside `run_id`; deterministic reruns with the same entries should be byte-stable.
6. **Compute rollup when requested.**
   - Enumerate children from explicit `children`, `lisa:gw` generated-work tokens, native hierarchy, and `parent_ref` fields.
   - Recursively collect descendant `lisa:usage-entry` tokens when available.
   - Deduplicate by `entry_id`.
   - Render one `lisa:usage-rollup` token with direct, child, and total tokens/cost.
7. **Write back.**
   - Prefer updating the body/description when the active writer owns that artifact.
   - Fall back to an artifact comment when body edits are unsafe or disallowed.
   - Surface any write failure; do not pretend usage was attached.

## Output

Return a compact summary:

```text
Usage attached: <artifact_ref>
Entry: <entry_id> (<flow>, <source>, tokens=<total|null>, cost=<currency amount|null>)
Rollup: direct=<n|null>, child=<n|null>, total=<n|null>, cost=<currency amount|null>
Attachment: body | description | comment | evidence-comment | file
```

## Rules

- Never fabricate token counts or cost.
- Never hard-code provider prices; use runtime cost or `usage.pricing.models`.
- Never leave a created/updated lifecycle artifact without either a usage row or an explicit `unavailable` row.
- Never count the same `entry_id` twice in a rollup.
- Never treat the user-facing table as authoritative; parse the `lisa:usage-entry` and `lisa:usage-rollup` tokens.

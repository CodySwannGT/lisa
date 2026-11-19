# Work-item token estimate

Every work item carries a **token estimate** and a **recommended model** before work begins, and,
once done, the actual tokens and dollar cost from the usage ledger next to that estimate
(CodySwannGT/lisa#4952). This reference is the contract; `scripts/lisa-estimate.mjs` (shipped to
every host and run the same way by every agent) renders and checks it.

## Config

`workItem.estimate` in `.lisa.config.json` (`.lisa.config.local.json` overrides per key):

| Key | Default | Meaning |
|---|---|---|
| `required` | `true` | Whether an estimate is required. An absent key is `true`; a non-boolean value fails safe to `true`. `false` turns every estimate gate off. |
| `models` | `claude-fable-5-2`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `fable`, `opus`, `sonnet`, `haiku` | Allowed recommended-model values: exact ids or families, from any vendor. A project on another runtime lists its own. |
| `tokenMix` | `input` 0.1, `cachedInput` 0.85, `output` 0.05 | Shares of an estimate billed at each rate, used to turn tokens into dollars. An assumption about agent work (it rereads far more than it writes), not a measurement. |

`lisa sync` writes `required` and `models` into the host config and refuses invalid values.
`node scripts/lisa-estimate.mjs config` prints the effective settings.

## Pricing

Dollar ranges use `usage.pricing.models` (the existing usage-accounting pricing key, keyed
`<provider>/<model>`) when it prices the model. Otherwise they use the shipped default table in
`scripts/lib/work-item-estimate-config.mjs`: Anthropic's first-party API list prices as published
in the Claude API reference on 2026-11-03 (USD per million tokens; a family is priced as its
current model). A model neither table prices gets `pricing_status=missing` and no dollar range —
never a guessed price.

## The section

One managed section per item, rewritten in place, never appended twice:

```markdown
## Lisa Estimate

_Managed by Lisa. Rewritten in place on each estimate or tally; do not edit by hand._

| Row | Tokens | Cost | Model |
|---|---:|---:|---|
| Estimate | 2M–4M | $3.14–$6.28 USD | claude-opus-5-5 |

Basis: no calibration history

<!-- lisa:estimate tokens_low=2000000 tokens_high=4000000 cost_low=3.14 cost_high=6.28 currency=USD pricing_status=estimated pricing_source=anthropic-api-list-prices%402026-11-03 model=claude-opus-5-5 basis=no%20calibration%20history -->
```

The token sits on its own line outside the table, for the same reason the usage ledger's do:
hosts that re-serialize tables drop anything that is not a cell. String fields are
percent-encoded. Render it, never hand-write it:

```bash
node scripts/lisa-estimate.mjs render --tokens-low 2M --tokens-high 4M \
  --model claude-opus-5-5 --basis "<one line>" --body-file <body.md>
```

With `--body-file` it prints the whole body with the section replaced or appended; without it,
just the section. After writing the body back, read it back from the host and run the check on the
stored bytes.

## When it is required

- **Creation and ready time:** not required. Deterministic sources (Sentry, New Relic, monitors)
  file items they cannot estimate. Validator gate S21 (`lisa-estimate.mjs check`) refuses only an
  estimate that is present and wrong: no parseable token, an inverted range, a model outside
  `models`, or a dollar range that disagrees with the price table the token names.
- **Before work begins:** required. `lisa-track` step 4, which every dispatch path runs right
  after the claim, checks with `lisa-estimate.mjs check --phase claim`. A claimed item without an
  estimate fails that check, and the claiming agent estimates it and writes it before doing any
  work. It never asks a person.

## Calibration

Estimates improve by learning from finished work. Before rendering, the claiming agent fetches up
to 20 comparable finished items (same repository, same type, carrying a `## Lisa Estimate`
section) as a JSON array of bodies and runs:

```bash
node scripts/lisa-estimate.mjs calibrate --tokens-low 1M --tokens-high 2M --history-file <items.json>
```

For each item with both an estimate and a complete actual (its `## Lisa Usage` rollup
`total_tokens`), the ratio is the actual over the estimate's midpoint. The median ratio scales the
new range, and the printed `basis` (for example "calibrated x2 (median actual/estimate) from 3
comparable finished item(s)") goes into the section. Items whose actual is unknown — no ledger,
`unavailable` telemetry, or a `measured-subset` total — are skipped, never counted as zero. With
no usable history the range is unchanged and the basis says "no calibration history".


## Done: the actual beside the estimate

When the work is done, the section also shows what it really cost (CodySwannGT/lisa#4956). The
actual is the item's `## Lisa Usage` ledgers, on the body and on any comment — the same ledger
every flow already records into, not a second one. Runs recorded in both places are added together;
a ledger copied whole into a comment is counted once:

```markdown
| Estimate | 2M–4M | $3.14–$6.28 USD | claude-opus-5-5 |
| Actual | 3M | $4.71 USD | — |

Actual: the Lisa Usage ledger total over 2 usage entries (source: observed); 1x the estimate's midpoint.

<!-- lisa:estimate-actual tokens=3000000 cost=4.71 currency=USD sources=observed entries=2 ratio=1 -->
```

After the Verify usage entry is written (`lisa-tracker-evidence` step 3) and before the accepted
completion proof is published, tally it and write the body back:

```bash
node scripts/lisa-estimate.mjs tally --body-file <body.md> [--usage-file <comment.md>]
node scripts/lisa-estimate.mjs check --phase done --body-file <stored-body.md> [--usage-file <comment.md>]
```

Pass `--usage-file` to both commands whenever a ledger lives in an evidence comment, alone or beside
the body's: the check then reads the same ledgers the tally counted. A total that any run leaves
unknown (`unavailable` telemetry, a `measured-subset` entry, incomplete child totals) is shown as
`unknown`, never as zero, never as the sum of only the known runs, and never guessed. An item that reached done with no estimate shows
`none recorded` in the estimate row rather than an invented range.

`lisa-work-item complete` enforces it: when `required` is true, it refuses (as `pending-proof`) an
item with no usage entry, with no tally, or with a tally that no longer matches the ledger. The
estimate section is machine-owned metadata, so rewriting it does not change the specification
digest the accepted completion proof is bound to. Only the exact lines `lisa-estimate` writes are
left out; every other line a person adds inside it still counts, even one that starts with
`Actual:` or `Basis:`.

## When the config is off

Nothing about estimates blocks. Every check reports `N/A`, and `complete` skips the done gate.

The recommended model is recorded only. It does not choose which model or agent runs the work.

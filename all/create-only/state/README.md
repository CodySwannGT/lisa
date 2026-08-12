# State contract

`state-contract.json` is this project's declaration of every persistent entity and the reset policy
that governs it, required by Lisa's `reset-seed-coverage` rule.

Copy `state-contract.example.json` to `state-contract.json` and fill it in. Until that file exists,
the state-classification check reports `not-adopted` — adoption is an explicit act, so no repo
silently passes a gate it never wired.

```bash
node scripts/check-state-classification.mjs
```

Schema: `scripts/schemas/lisa-state-contract.v1.schema.json`.

## The two things the template cannot do for you

**Classify by provenance, not by observation.** "The table looked empty" is not evidence it is
unused. Row-count statistics are approximations, and a table nobody has analyzed reports rows it
holds. Ask who writes it and whether anything can put it back. Prefer `preserve` when unsure — an
over-preserved entity leaks; an over-cleared one destroys.

**Include state that is not rows.** Identity-provider objects, object-storage prefixes, search
indexes, queues and dead-letter backlogs, caches with a persistence tier, derived and materialized
views, runtime-created jobs, and outbound side effects all belong in `entities`. Leaked test state is
most expensive exactly where nobody thought to look.

## The four policies

| Policy | Meaning |
|---|---|
| `fixture-owned` | The reset may delete records it owns here. Requires an `ownership` predicate and a `sweptBy` routine — an entity the suite creates but nothing removes is the leak this contract exists to catch. |
| `preserve` | Left untouched. Catalog, reference data, anything a migration seeds, anything belonging to someone real. |
| `derived-rebuild` | Recomputed from its sources after the reset, then proven converged. |
| `forbidden` | The reset must be structurally unable to touch it. Requires `enforcedBy` naming a control outside the reset process — a role, a revoked grant, a credential boundary. "The script does not touch it" is not an enforcement. |

## No persistent state at all?

Set `"mode": "declared-noop"` and fill in the `noop` block (reason, owner, capability-manifest
reference) instead of `entities`. The check verifies that claim against the repository rather than
trusting it: a repo showing persistence signals may not declare a reset noop.

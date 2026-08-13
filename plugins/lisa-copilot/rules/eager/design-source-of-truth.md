# Design Source of Truth (load-bearing)

**Figma is the design source of truth, and every UI surface a change touches declares where its design came from.** A changed UI surface that neither cites a Figma node nor carries the designated marker is a contract violation — and so is a surface whose declaration the gate cannot resolve.

**One vendor-neutral contract, cited by** `lisa-implement`, `lisa-tdd-implementation`, `lisa-review-local`, `lisa-quality-review`, and `lisa-tracker-source-artifacts` (the `leaf-only-lifecycle` / `repo-scope-split` precedent: one shared slug, never divergent per-skill prose).

## Membership

Membership is **surface, not repo name or file extension**: a file is in scope the moment a change makes it render something user-observable — a screen, component, layout, style token, visual state, or markup a user reads. Barrels, pure-logic modules, tests, stories, generated output, and vendored code are out. Projects narrow or widen the default detection through `designSource.include` / `designSource.exclude` in `.lisa.config.json`; they never turn the obligation off.

## The two declarations

Exactly one of these, written as an ordinary comment in whatever syntax the file uses:

| Form | Means |
|---|---|
| `DESIGN-SOURCE: <figma-url>` | The surface is backed by a Figma node — it already existed there, or it was synced back. |
| `DESIGN-SOURCE: none — not in Figma` | The surface is deliberately not captured at the design source. |

The marker's spelling is fixed and load-bearing; a drifted spelling silently disarms the gate. An optional trailing ` — <reason>` records why. Only a `figma.com` URL seals a surface: a link to a screenshot, a Slack thread, or any other mock is **malformed**, not proof.

## Sync-back is the default; the marker is the exception, not the default

When the flow has proven Figma access (the `tool-access-gate` probe), reflecting the surface in Figma and citing the node is the expected outcome. Reach for the marker only when the surface genuinely does not belong in the design source — a debug affordance, a dev-only playground, a throwaway internal tool. The gate reports every marked exception so review can challenge it, and reports a reasonless exception separately when Figma access was available.

## Host design-system rules stay authoritative

Projects that carry their own design-system rules (`figma-design-system`, `design-system`, `use-the-design-library`, or an equivalent) keep them. This contract never restates component hierarchy, token vocabulary, or reuse policy, and never overrides them. It asks one orthogonal question the host rules do not: is the design source declared?

## The gate fails closed

`scripts/design-source-gate.mjs` decides the change deterministically. It fails on an undeclared surface, a malformed annotation, a file that both cites Figma and denies having a source, a changed file it could not read, and a diff it could not compute. **A design-source violation is a blocking review finding, never a warning** — it is not demoted to "optional", "if cheap", or a follow-up. A gate that passes on what it could not read proves nothing, so it never does.

## Bootstrap and degradation

Adoption never demands a retroactive backfill: the gate judges **only the surfaces this change touched**. Pre-existing unannotated UI is burndown, recorded and worked down, not this work item's blocker. If a project has no Figma at all, that is not an exemption — every changed surface carries the marker, and the resulting exception list is the honest record of how much of the product lives outside its design source. Behavior obligations for the same surfaces are unchanged and still governed by `bdd-e2e-coverage`.

Full contract (marker grammar, gate semantics, host-rule precedence, bootstrap procedure): [reference/design-source-of-truth.md](../reference/design-source-of-truth.md).

# Design Source of Truth

> Demoted from the always-on eager tier by CodySwannGT/lisa#3992. The
> section below is the former eager head, preserved verbatim; the full
> contract follows it. Reachable on demand via `rules/eager/00-rule-index.md`.

## Design Source of Truth (load-bearing)

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

---

Design has always leaked in one direction. A ticket arrives with a Figma frame, the frame gets
built, and then — during implementation, during a bug fix, during a "quick" empty state nobody
specified — new UI gets invented directly in code. Nothing ever carries it back. A year later the
Figma file describes a product that no longer exists, and the only way to answer "what is this
screen supposed to look like?" is to read the code, which is precisely the question the design
source was supposed to answer.

Lisa had every design obligation conditioned on a design artifact *already existing*. Ticket gate
S12 fires only `when artifacts_attached = true`. `work-item-definition-of-ready` requires
design-source precedence "when artifacts exist". `lisa-implement` treats a linked Figma file as a
required tool and hard-stops when access to it fails. The nearest adjacent behavior —
`lisa-tracker-source-artifacts` asking UI tickets to flag design-vs-code divergence — files that
divergence as a *ticket comment*, which closes with the ticket.

Every one of those is about UI that has a source. **None of them govern UI that has none.** That is
the gap this contract closes, and it closes it on the code side, where the invented UI actually
lives.

## What the contract asks

One question, per UI surface a change touches: **where did this design come from?**

Not "is it pretty", not "does it use the right token", not "should this component exist" — those are
the host design system's questions, and it answers them far better than a vendor-neutral contract
could. This contract asks only whether the answer to the provenance question is written down.

## Membership

A file is a UI surface when a change makes it render something user-observable: a screen,
component, layout, style token, visual state, or markup a user reads. The gate's default detection
is two-tier, and the split is deliberate:

- **Extensions that always render** — `.tsx`, `.jsx`, `.vue`, `.svelte` — count wherever they live.
- **Markup and style extensions** — `.css`, `.scss`, `.sass`, `.less`, `.styl`, `.html`, `.erb`,
  `.haml`, `.slim`, `.swift`, `.kt`, `.dart`, `.xml` — count only inside a rendering directory
  (`components`, `screens`, `views`, `pages`, `ui`, `widgets`, `layouts`, `templates`, `atoms`,
  `molecules`, `organisms`).

The second tier is why a `.ts` barrel under `components/` is out: `src/components/atoms/index.ts`
re-exports and renders nothing, so demanding a design source from it would be noise, and noise is
how a gate earns its way into an ignore list. Tests, specs, stories, snapshots, `.d.ts` declarations,
`node_modules`, and build output are excluded for the same reason.

Projects tune this in `.lisa.config.json`:

```json
{
  "designSource": {
    "include": ["**/*.mjml"],
    "exclude": ["src/legacy/**"]
  }
}
```

`include` widens the surface; `exclude` narrows it. Neither turns the obligation off — a project that
excluded its whole UI tree would be declaring it has no UI, which review can see.

## The marker grammar

Exactly one declaration per file, written as an ordinary comment in whatever syntax the file already
uses. The gate reads the annotation, not the comment characters around it, so all of these are the
same declaration:

```tsx
// DESIGN-SOURCE: https://www.figma.com/design/AbC123/Checkout?node-id=412-1187
```

```css
/* DESIGN-SOURCE: none — not in Figma */
```

```svelte
<!-- DESIGN-SOURCE: none — not in Figma — internal-only debug affordance -->
```

### `DESIGN-SOURCE: <figma-url>` — sealed

The surface is backed by a design node. Only a `figma.com` URL counts. A screenshot link, a Slack
permalink, a Jira attachment, or a path to a PNG in the repo is **malformed**, not proof: those are
copies of a design, and a copy cannot be updated when the design changes. Prefer a URL carrying a
`node-id` so the citation resolves to the frame rather than the file.

### `DESIGN-SOURCE: none — not in Figma` — the recorded exception

The spelling is fixed, including the em dash, and it is load-bearing: the gate, the rule, the review
path, and the implement path all cite the same string, so a drifted spelling silently disarms the
gate rather than failing loudly. An optional trailing ` — <reason>` records why the surface is not
captured at the source, and the gate surfaces reasonless markers separately (below).

### Everything else

`DESIGN-SOURCE:` followed by anything that is neither form is **malformed** and fails. This is not
pedantry — it is what stops the annotation from degrading into a comment that says "design source:
ask Priya" and passes. **Silence is a violation, never a pass.**

A file that carries both a Figma URL and the none-marker is **conflicting** and fails. It is
asserting two contradictory things about the same surface, and the gate does not pick a winner.

## Sync-back is the default

The order of preference is not decorative:

1. **The surface already exists in Figma.** Cite the node. Nothing else to do.
2. **Figma access is available and the surface belongs in the design source.** Reflect it in Figma,
   then cite the node. This is the expected outcome for real product UI, and the whole reason the
   `tool-access-gate` probe enumerates Figma as a required tool when the work item links one.
3. **The surface genuinely does not belong in the design source.** Mark it. Debug affordances,
   dev-only playgrounds, internal tooling, and diagnostics live here.

The marker is the exception, not the default. When Figma access has been proven and a marked
exception records no reason, the gate reports it under `syncBackPreferred` — non-blocking, because
turning a preference into a second hard gate would make the honest exception more expensive than a
copy-pasted Figma link, which is exactly the wrong incentive. It is a review prompt: *you could have
synced this back — why didn't you?*

## Host design-system rules stay authoritative

Several Lisa host projects already carry a design-system rule of their own —
`figma-design-system.md`, `design-system.md`, `use-the-design-library.md`. Those files are
**host-owned**. They define the component hierarchy, the closed token vocabulary, the atom layer,
the escape hatches, and the lint manifest that enforces all of it, and they are specific to a product
in ways no shared contract can or should be.

**This contract governs whether the design source is declared, never what to build.** It adds one
orthogonal obligation on top of whatever the host rule already says. Where a host rule already
mandates a Figma mapping, this contract is satisfied by that mapping — cite the node and move on.

Two consequences worth stating plainly:

- **Do not duplicate host content into this contract, and do not rewrite host rules to restate this
  one.** Wire them: the host rule points at this slug for the provenance obligation, this contract
  points at the host rule for everything else.
- **Several host design-system rules are generated artifacts** carrying a "generated from
  `docs/design-system-rfc.md` — do not edit this file directly" provenance header. Respect it:
  **amend the RFC and regenerate.** A hand-edit to a generated rule is lost on the next
  regeneration, which is worse than not making the change at all, because it looks like it shipped.

## Gate semantics

`scripts/design-source-gate.mjs` is the executable arm of this contract, and it **fails closed**.

```
node design-source-gate.mjs --base=origin/main [--head=HEAD] [--figma-access] [--json]
```

Exit `0` = PASS, `1` = FAIL, `2` = usage error. It classifies every changed file into one status:

| Status | Verdict | Meaning |
|---|---|---|
| `figma-source` | pass | Sealed by a Figma node. |
| `marked-exception` | pass | Explicitly declared as not captured at the source. |
| `not-applicable` | pass | Not a UI surface, or a deletion — nothing to declare. |
| `undeclared` | **fail** | A UI surface with no annotation at all. |
| `malformed` | **fail** | An annotation whose value is neither form. |
| `conflicting` | **fail** | Cites Figma *and* denies having a source. |
| `unreadable` | **fail** | The changed file could not be read. |

Plus two change-level failures that exist purely so the gate cannot pass on ignorance:
`changed-files-unresolved` (the file list never materialized) and `diff-unresolved` (git could not
compute the range). **A gate that returns PASS when it could not look proves nothing.** This is the
same discipline `claim-evidence-mapping` applies to verification evidence and `bdd-e2e-coverage`
applies to a missing runner: the absence of a check is never a passing check.

The gate aggregates — it reports every violating file, not the first one — so a single run tells the
implementer everything they need to fix.

## Where it is enforced

- **`lisa-implement`** — building or changing a UI surface includes declaring its design source, and
  the sync-back preference applies while the work is being done, when reflecting the surface in Figma
  is cheap. The `tool-access-gate` probe already establishes whether Figma access exists.
- **`lisa-tdd-implementation`** — the declaration lands with the implementation, in the same commit
  as the surface it describes.
- **`lisa-review-local` and `lisa-quality-review`** — the gate runs on the branch diff, and a FAIL is
  a **blocking** finding. It qualifies under `convergent-review` because it names a concrete failure
  scenario: the design source silently diverges from the shipped product, and nobody can tell which
  one is authoritative.
- **`lisa-tracker-source-artifacts`** — its existing design-vs-code divergence note covers the
  *ticket* side of the same event. It points here for the code side, so the two are one behavior
  rather than two half-behaviors.

## Bootstrap and degradation

Adoption is never a backfill project. The gate judges only the surfaces the current change touched,
so a repository with hundreds of unannotated legacy components can adopt the contract on a Tuesday
and be green on Tuesday. Pre-existing unannotated UI is **burndown**: recorded, worked down
opportunistically as files are touched, never treated as the current work item's blocker.

A project with no Figma at all is not exempt. Every changed surface carries the marker, and the
resulting exception list is the honest, mounting record of how much of the product lives outside its
design source — which is far more useful than an exemption flag that makes the question disappear.
Deleting or excluding a surface to make the gate green is a violation of the same kind as deleting a
BDD scenario to improve coverage: mark it, do not drop it.

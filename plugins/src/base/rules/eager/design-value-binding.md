# Design Value Binding (load-bearing)

**Values come from design variables where a variable system exists.** Visual measurement is supplemental there, and it is the legitimate primary source where no variable system exists. Missing design information blocks the work item; it is never worked around.

**One vendor-neutral contract, cited by** `lisa-design-intake`, `lisa-implement`, `lisa-tdd-implementation`, `lisa-review-local`, and `lisa-quality-review` (the `leaf-only-lifecycle` / `repo-scope-split` precedent: one shared slug, never divergent per-skill prose).

This is **not** `design-source-of-truth`. That contract asks whether a changed surface *declares where its design came from*. This one asks whether the *values on it are bound*. A surface can cite a perfectly valid design node and still paint a literal that no variable backs — the design looks finished and has nothing to extract. Both apply; neither substitutes for the other.

## Regime is per-dimension, not per-project

Resolve the source of truth **per-axis** — colour, spacing, typography, radius, elevation, motion — from what the design source **actually publishes**. **Never by asking a human**, and never once per project.

The axis vocabulary is fixed, and the identifiers are what the config and the lint rule use: `color`, `spacing`, `typography`, `radius`, `elevation`, `motion`. Projects declare which of them are typed; they never invent a seventh.

| axis has a published variable collection | source of truth | an unbound value means |
|---|---|---|
| yes (**typed**) | the variable | **block** |
| no (**untyped**) | visual measurement | measure it, and record what you derived |

A library with a mature colour system and no spacing scale is the common case and must work: colour blocks while spacing gets measured, in the same work item, without contradiction.

**Asking the design tool "which collections are published?" does not work headlessly, and that is measured.** The Variables REST endpoint returns names but is Enterprise-plan only; the design-tool MCP returns names on every plan but authenticates by browser OAuth, which cron, CI, and a subagent cannot perform. A gate built on either runs interactively and silently no-ops everywhere else. So the regime is derived from a **committed variable-id map**: `/v1/files/:key/nodes` reports every binding as an opaque `VariableID`, that id→name mapping is static, and `design-variable-ids.mjs` resolves it once interactively so `design-bindings-probe.mjs` runs headlessly on a plain access token forever after. An axis is typed when the committed map names at least one variable in its namespace.

**Staleness is self-detecting, and that is what makes a committed map safe to trust.** An id the map has never seen fails loudly telling you to regenerate; it never silently resolves to the wrong variable.

**Measure the subtree you are implementing, not the enclosing screen.** A frame-level read counts the chrome behind a modal and over-reports — one measured work item scored 14 bound values at frame level and zero inside the modal subtree it actually had to build.

## Block on *unbound*, never on *unsure*

This distinction is the whole contract. "I cannot tell what they meant" is a judgment call, and an agent asked to make it blocks on everything or nothing. "The design does not bind a value I need" is objective and decides the same way twice.

**Block conditions — five, all objectively checkable:**

1. **A named token does not exist.** The work item or frame references a variable the library does not have.
2. **A value is hardcoded in the design file itself, in a typed axis.** The most important and easiest to miss: the frame paints a literal instead of binding a variable, so the design looks finished and there is nothing to extract.
3. **The component is not published.** Local to a draft file, so there is no stable reference.
4. **A required state has no design.** The work item specifies disabled/error/loading and the component set has no such variant.
5. **Two sources disagree.** The bound token says one value, the frame renders another. Never guess which is right.

**Explicit non-block list — equally load-bearing, or the gate fires constantly:**

- Anything in an **untyped** axis. Measure it.
- One-off values that are not semantic (an illustration's exact offset).
- Anything where a token exists and is bound — the happy path.
- **Aesthetic uncertainty.** If every value needed is bound and the agent merely finds the design ambiguous or ugly, that is an opinion, not a block.

## What visual matching is for, precisely

In a **typed** axis it is *verification*: build from the variable, screenshot, confirm agreement — and a disagreement is condition 5, not a licence to trust the pixels. In an **untyped** axis it is *derivation*, and legitimate. The rule is never "do not look at pixels"; it is **"do not derive a value from pixels when a binding exists."**

## Derived values are recorded, not just used

When measuring in an untyped axis, record the derived values on the work item. Over time that accumulates a free inventory of what the token system is missing, ranked by what people actually needed.

## Escalation is configured, never hardcoded

The escalation target, label, and authoritative design source are host configuration — `design.escalation.assignee`, `design.escalation.label`, `design.tokens.source`. **An unset `assignee` is itself a block condition**: a blocked item assigned to nobody is an item nobody sees. Escalation routes through the vendor-neutral tracker abstraction per `config-resolution` — Linear lifecycle is native state, GitHub uses labels, JIRA uses status — never a hardcoded label call.

The blocked comment is written for the non-technical operator standing at the gate: plain language, no engineering vocabulary, naming the specific missing artifact and what to do about it.

## A design source is OPTIONAL; a configured one fails closed

**Most projects have no designs, and this contract must not break them.** No configured design source, no access token, or no committed id map is **SKIPPED** — loudly, exit 0. A mandatory gate on an absent integration breaks every non-design project on upgrade, which is a worse outcome than any drift it would have caught.

Where a design source *is* configured, the gate fails closed: `scripts/design-bindings-probe.mjs` gathers the facts, `scripts/design-intake-gate.mjs` decides deterministically, and `/lisa:design:intake` carries the judgment between them. Facts it could not gather are a block with a named reason, never a quiet pass. The threshold is **100% by default** — the rule as written — with a `--min` flag so any relaxation is an explicit reviewable decision on the command line rather than a quiet softening in code.

The lint rung (`ui-standards/no-unbound-design-value`) catches the same defect at authoring time, and is silent on any axis the project has not declared typed.

## Every failure names an OWNER

Conflating these sends the wrong person the wrong work.

| Owner | Failure | What happens |
|---|---|---|
| **design** | Values are unbound. | Block the work item with the exact bind-list. |
| **us** | The committed id map is stale or ambiguous. | The values ARE bound; regenerate the map. Not the designer's problem. |

An ambiguous id is still a failure even though nothing is wrong in the design: two variables share a value, our map cannot say which one is meant, and guessing is exactly what this contract forbids.

Full contract (axis vocabulary, the five conditions in detail, config schema, comment grammar, escalation routing): [reference/design-value-binding.md](../reference/design-value-binding.md).

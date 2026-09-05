# Design Value Binding — full contract

> Demoted from the always-on eager tier by CodySwannGT/lisa#3992. The
> section below is the former eager head, preserved verbatim; the full
> contract follows it. Reachable on demand via `rules/eager/00-rule-index.md`.

## Design Value Binding (load-bearing)

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

**Measure the subtree you are implementing, not the enclosing screen.** A frame-level read counts the chrome behind a modal and over-reports — one measured work item scored 14 bound values at frame level and zero inside the modal subtree it actually had to build. **That distinction is decision-changing, not a refinement**: applying it moved 5 of 11 real work items between build and block.

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

## Why this is a block and not a warning — the measured case

An agent that had read this contract, and cited it in the briefing it wrote for its own build agents, instructed them in that same briefing to **"snap unbound dimensions via the snap tables (ties round down) and flag the rest."** A block downgraded to a warning, by the agent enforcing it, inside the document enforcing it — not from ignorance, but from reasoning around it under delivery pressure with eleven work items queued and blocking feeling like not-shipping. It took a human restating the rule as an absolute for the instruction to be withdrawn.

Coverage measured afterwards, on the subtrees actually being implemented:

| frames | colour | spacing | radius | reality |
|---|---|---|---|---|
| compliance screens | 96-100% | 82-97% | 88-93% | design-system composed |
| edit-KPI / target dialogs | **100%** | **0%** | **0%** | colours bound, geometry never bound |
| planning mockups | **1-4%** | **0-2%** | **0-3%** | hand-drawn, effectively unbound |

**Five of the eleven items blocked back to design; six proceeded.** One modal's subtree contained **zero variable references** — under snap-and-flag an agent would have produced a complete, lint-clean, tested component **in which every style value was invented**, and shipped it with a note. Five view files were written before it was stopped.

Blocking cost far less than it appeared it would: the non-visual half of the blocked work — domain types, adapters, CRUD, formatters — was completed and preserved. That is the answer to the delivery-pressure reasoning that produced the softening. And the contract holds once it is absolute rather than advisory: one agent withdrew a radius class it had already applied on finding `radius/none` was the only radius bound in its subtree; another refused to build an icon disc whose diameter and radius were both unbound rather than pick a size.

**A gate that depends on an agent choosing to honour it under delivery pressure is not a gate.** That is why this contract has an executable, headless rung at all — the judgment-based version demonstrably failed in the hands of an agent that had read the rule and agreed with it.

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

---

The eager head is [eager/design-value-binding.md](../eager/design-value-binding.md). This body carries the axis vocabulary, the five block conditions in detail, the configuration schema, the comment grammar, and the escalation routing.

## Why this exists separately from `design-source-of-truth`

The two contracts ask different questions about the same file, and both have to be answered.

| Contract | Question | Failure it catches |
|---|---|---|
| `design-source-of-truth` | Does this changed surface **declare where its design came from**? | UI invented straight into code, with no design behind it at all. |
| `design-value-binding` (this) | Are the **values on it bound** to the design system? | A surface with a perfectly valid design-node reference that still paints a literal no variable backs. |

The second failure is invisible to the first, and it is the more common one on a mature product. The design looks finished, the node reference is real, review sees a screenshot that matches — and the codebase has quietly acquired a number that will drift the next time the palette moves. Nothing else in Lisa governs it: every other design obligation is conditioned on a design artifact existing, and here one does.

## The axes

Six, fixed. Projects declare which of them are typed; they never invent a seventh, because the vocabulary has to mean the same thing in the config, the lint rule, and the intake gate.

| Axis | Covers |
|---|---|
| `color` | fills, strokes, text colour, tints, shadow colour |
| `spacing` | padding, margin, gap, layout offsets |
| `typography` | family, size, weight, line height, letter spacing |
| `radius` | corner radii |
| `elevation` | shadow geometry and opacity, elevation levels |
| `motion` | durations, delays, easing |

## Regime detection

**Derive the regime per-axis from what the design source actually publishes. Never ask a human, and never assume.**

An axis is **typed** when the design source publishes a variable collection covering it, and **untyped** when it does not.

### The obvious implementation does not work headlessly

This is measured, not assumed, and it is load-bearing for everything below.

| Route | Gives names? | Usable headlessly? |
|---|---|---|
| Variables REST (`/v1/files/:key/variables/local`) | yes | **no** — Enterprise-plan only. The read scope is not offered in the token scope picker on other plans, so no token change unlocks it. |
| Design-tool MCP (`get_variable_defs`) | yes, every plan | **no** — browser OAuth. Cron, CI, and a subagent cannot perform it. |
| `/v1/files/:key/nodes` | **no** — opaque `VariableID:106:15` | **yes**, on a plain personal access token |

A gate built on either of the first two works in an interactive session and silently no-ops in cron and CI — a control that reports success while inert, which is the exact defect class this repository exists to remove.

### The committed id map

The id→name mapping is **static**. So it is resolved once, interactively, by `design-variable-ids.mjs`, committed to the repo, and `design-bindings-probe.mjs` runs headlessly against the access token alone forever after. An axis is typed when the committed map names at least one variable in its namespace (`space/`, `radius/`, `content/`, … — overridable through `design.tokens.namespaces`, because the namespace vocabulary belongs to the design system, not to Lisa).

The generator joins MCP `{name: value}` against REST `{VariableID: value}` on the same nodes. Value alone is ambiguous wherever two variables share a value, so three signals separate them: **property kind** (a padding can only bind a spacing variable), the **light+dark signature** (same-valued variables in light mode diverge in dark — this is the signal that takes the map to complete), and **single occupancy** (a node containing exactly one tied id and exactly one tied name forces the pairing). A tie that survives all three is recorded as ambiguous, never resolved by taking the first candidate.

### Staleness is self-detecting

An id the committed map has never seen makes the probe **fail loudly**, naming the id and telling you to regenerate. It never silently resolves to the wrong variable. That property is the entire reason a committed map is safe to trust, and it is why an unknown id is a block rather than a warning.

### Two API traps that silently under-report

Both cost a real measurement, and both fail green rather than loudly, which is worse.

1. **`rectangleCornerRadii` binds as an object keyed by corner constants** — `{RECTANGLE_TOP_LEFT_CORNER_RADIUS: {type,id}, …}`. It is neither an array nor itself a reference, so a reader handling only the scalar and array shapes reports **zero bound radii on a fully bound file**. Normalise all three shapes.
2. **Figma omits zero-valued properties from the REST payload.** Boundness must be read from `boundVariables` directly, never inferred from a resolved value being present — otherwise a padding bound to a zero-valued spacing variable vanishes. Reading it correctly moved one measured frame from 55% to 82%.

### Measure the subtree, not the enclosing screen

A frame-level read counts the chrome behind a modal and over-reports. One measured work item scored 14 bound values at frame level and **zero** inside the modal subtree it actually had to build; applying this rule changed 5 of 11 real work-item verdicts. Probe the node you will build.

### Why the lint rung takes the regime as configuration instead

ESLint runs on source text with no network and no design-tool session, so `ui-standards/no-unbound-design-value` cannot read the map at all. It takes the typed axes as its `typedAxes` option, which mirrors `design.tokens.axes`, and reports nothing when that list is empty.

**How the option is armed (#2807).** The managed `eslint.config.ts` reads `design.tokens.axes` out of `.lisa.config.json` at ESLint **config** load — alongside `eslint.thresholds.json` and `eslint.ignore.config.json`, which it has always read there — and hands the list to the config factory, which emits `["error", { typedAxes }]` for a non-empty list and `"off"` for an empty one. **Declaring an axis is therefore sufficient to arm the rule; nothing has to be written into `eslint.config.local.ts`.** Before this the rule shipped severity `"off"` with no path from configuration to activation at all, so a project could declare every axis, install the policy, pass every test, and enforce nothing — a control installed, adopted, green and inert.

An axis name outside the six is passed straight through to ESLint's own schema validation, which rejects it by name. Filtering it out instead would turn a typo into silent non-enforcement, which is the same failure one layer down.

The intake probe's regime is **observed**; the lint rule's is **declared**, and the declared list can go stale relative to the map. It is still the correct division — an over-firing lint rule is a disabled lint rule, and a rule that silently skipped an axis it could not verify would be worse than one that skips an axis nobody declared. Intake is the arm that sees the truth; lint is the arm that catches the same defect at authoring time on the axes the project has already committed to.

## A design source is optional

**This matters more than any other requirement in this contract.** Most projects have no designs at all. Detect and skip cleanly:

| Condition | Outcome |
|---|---|
| `design.tokens.source` unset | **SKIPPED**, exit 0, reason printed |
| No access token in the environment | **SKIPPED**, exit 0, reason printed |
| No committed id map | **SKIPPED**, exit 0, with the command to create one |

Never a silent pass, and never a block. A mandatory gate on an absent integration breaks every non-design project on upgrade, which is a worse outcome than any drift it would have caught.

## Every failure names an owner

Three failures, two owners. Conflating them sends the wrong person the wrong work.

| Owner | Failure | Meaning | Action |
|---|---|---|---|
| **design** | Unbound values | The design paints literals where variables exist. | Block the work item with the exact bind-list, most frequent first. |
| **us** | Unknown id | Our committed map is stale. The value IS bound. | Regenerate the map. Never the designer's problem. |
| **us** | Ambiguous id | Two variables share a value; our map cannot say which. | Disambiguate with a dark-mode reference frame, or record the choice by hand. Still a failure — guessing is what the contract forbids. |

## The threshold is 100%, and relaxing it is visible

The default is the contract as written: any literal in a required axis fails. A `--min` flag exists so that a deliberate, reviewable policy decision can be made **on the command line where it is visible**, rather than by quietly softening the gate in code — which is the exact failure the gate was written to prevent.

## The five block conditions

Every one is a fact about the design, checkable the same way twice by two different agents.

### 1. A named token does not exist

The work item or frame names a variable — `surface/raised`, `space/gutter` — that the library does not publish. Do not substitute the nearest name and do not invent it.

### 2. A value is hardcoded in the design file itself, in a typed axis

The frame paints a literal where the axis has a variable collection. **This is the most important condition and the easiest to miss**, because nothing about the artifact looks wrong: the design is finished, the component renders, and the only symptom is that there is no variable to extract. An agent that treats "I can see the value" as "I have the value" will copy it and produce exactly the drift this contract exists to prevent.

### 3. The component is not published

It lives in a draft or local file, so there is no stable reference to build against. A component that may be renamed, restructured, or deleted without a version event is not a handoff artifact.

### 4. A required state has no design

The work item specifies disabled, error, loading, empty, or another state, and the component set has no variant for it. Do not invent the state; do not derive it by dimming the default.

### 5. Two sources disagree

The bound token resolves to one value and the frame renders another. **Never pick a side.** Either the binding is stale or the frame is overridden, and which one is correct is a design decision, not an implementation one.

## The explicit non-block list

This half is as load-bearing as the conditions. Without it the gate fires on everything, and a gate that fires on everything is turned off.

- **Anything in an untyped axis.** Measure it. This is not a concession — it is the correct source of truth for that axis.
- **One-off values that are not semantic.** An illustration's exact offset, a one-time hero crop. These were never going to be tokens.
- **Anything where a token exists and is bound.** The happy path, which is most of the work.
- **Aesthetic uncertainty.** If every value needed is bound and the agent merely finds the design ambiguous, unusual, or ugly, that is an opinion. Build it.

The distinction the whole contract rests on: **block on *unbound*, never on *unsure*.** "I cannot tell what they meant" is a judgment call, and an agent asked to make it will block on everything or nothing depending on temperament. "The design does not bind a value I need" is objective.

## Visual matching, precisely

| Axis regime | What a screenshot is for | A mismatch means |
|---|---|---|
| typed | **verification** — build from the variable, then confirm | block condition 5 |
| untyped | **derivation** — measure, then record | nothing; that is the workflow |

The rule is never "do not look at pixels". It is **"do not derive a value from pixels when a binding exists."** In a typed axis the pixels are the check, not the source.

## Derived-value recording

Every value measured in an untyped axis is recorded on the work item, with its axis and where it was measured. This costs nothing at the time and produces something no design-system audit produces on its own: an inventory of what the token system is missing, **ranked by what people actually needed**, accumulated from real work rather than from a survey.

## Configuration

Read from `.lisa.config.json`, with `.lisa.config.local.json` overriding per key, exactly as `config-resolution` specifies.

| Key | Required | Description |
|---|---|---|
| `design.tokens.source` | to run intake | The authoritative design source — the file key whose published variables define the regime. **Absent means SKIPPED, not blocked.** |
| `design.tokens.idMap` | no | Path to the committed variable-id map. Defaults to `docs/design-system/figma-variable-ids.json`. |
| `design.tokens.namespaces` | no | Axis → variable-name prefixes, deciding which axis a variable belongs to. The namespace vocabulary is the design system's, not Lisa's, so this overrides the defaults rather than extending them. |
| `design.tokens.nameMap` | no | Variable name → repo token name. Identity-ish by default (`a/b` → `a-b`), because the mapping is project vocabulary. |
| `design.tokens.axes` | no | Axes the project declares typed. Mirrors what the map publishes; consumed by the lint rung, which cannot read the map. Absent means the lint rule reports nothing. |
| `design.escalation.assignee` | **yes** | Who a blocked item is assigned to. |
| `design.escalation.label` | no | Additive marker applied alongside the `blocked` role. |

**No person's name, handle, or identity appears in any Lisa artifact.** These are host configuration keys and nothing else. Lisa ships the key, the host supplies the value.

### An unset assignee is itself a block

If `design.escalation.assignee` is unset, intake blocks on that before anything else, and says so in those terms. This is not defensive pedantry: a blocked item assigned to nobody is an item nobody sees, which is operationally identical to having skipped the block entirely — except that it also consumed the work item. Guessing an assignee is worse still, because it routes a design question to whoever happened to be nearby.

## Escalation routing

Escalation goes through the vendor-neutral tracker abstraction (`lisa-tracker-write`, `lisa-tracker-sync`, `lisa-tracker-claim`), never a hardcoded label call. Per `config-resolution`, the `blocked` role resolves differently per vendor:

- **Linear** — a native workflow **state**.
- **GitHub** — a **label** (`status:blocked`), because GitHub Issues has no workflow-state field.
- **JIRA** — a workflow **status**.

`design.escalation.label` is an **additive marker**, applied alongside the `blocked` role, never instead of it — the same shape as the `human_needed` marker. A project that does not define it inherits nothing and the add is a no-op.

Design blocks generally do warrant `human_needed` as well: a missing variable, an unpublished component, and a token/frame disagreement all require a person to make a design decision, and none of them self-heal on a retry.

## The blocked comment

Plain language, no engineering vocabulary, naming the specific missing artifact and what to do about it. The house standard is that a non-technical operator is the one standing at the gate.

> The 'Raised card' component uses the colour #3A7BD5 directly rather than a colour variable. I need that colour published as a variable so the app and the design stay in sync — otherwise I'd be copying a number that changes without warning.

Three things make that comment work, and all three are required:

1. **It names the artifact** — the component, by the name it has in the design file, not a node id.
2. **It names the specific value** — so the reader can find it without a hunt.
3. **It says what to do and why it matters in consequences**, not in vocabulary. "Published as a variable" is an action; "unbound token reference in a typed axis" is a diagnosis nobody outside the factory can act on.

Words that must not appear: token, binding, unbound, axis, typed, regime, variable *collection*, node id, AST, lint. They are all correct and all useless to the person being asked.

## Interaction with host design-system rules

Projects that carry their own design-system rules (`figma-design-system`, `design-system`, `use-the-design-library`, or an equivalent) keep them, and they stay authoritative. This contract never restates component hierarchy, token vocabulary, or reuse policy, and never overrides them. It asks one orthogonal question those rules do not: **is the value bound to what the design system publishes?**

## Bootstrap and degradation

Adoption never demands a retroactive backfill. Intake judges the work item in front of it, and the lint rung judges the code being written. Pre-existing unbound values are burndown — recorded, worked down, and increasingly visible through the derived-value inventory — not this work item's blocker.

A project with a design source but no variable system at all is not exempt and not blocked: every axis is untyped, everything is measured, and every measurement is recorded. The resulting inventory is the honest record of what a variable system would need to cover, which is exactly the input the project needs before it builds one.

A project with **no design source at all** is SKIPPED entirely — see "A design source is optional" above. That is not a weaker form of the same treatment; it is the correct answer, and getting it wrong breaks every project that has no designs.

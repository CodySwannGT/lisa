# Design Value Binding — full contract

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

**Query the published variable collections, per-axis. Never ask a human, and never assume.**

An axis is **typed** when the authoritative design source (`design.tokens.source`) publishes a variable collection covering it, and **untyped** when it does not. Detection runs per work item, not once per project, because a design system grows: the axis that was untyped last month may be typed today, and the answer has to come from the live collections rather than from a cached judgment.

Regime detection is the one step that must never degrade quietly. If the collections cannot be listed — no access, an unreachable source, an ambiguous file reference — the axes are **unknown**, and unknown is a block, not a default to untyped. Defaulting to untyped on a failed query converts every access problem into silent permission to hardcode.

### Why the lint rung takes the regime as configuration instead

ESLint runs on source text with no network and no design-tool session, so `ui-standards/no-unbound-design-value` cannot perform this query. It takes the typed axes as its `typedAxes` option, which mirrors `design.tokens.axes`, and reports nothing when that list is empty.

This is a real difference in kind, and it is worth being precise about: the intake gate's regime is **observed**, the lint rule's regime is **declared**. The declared list can go stale relative to the published collections. It is still the correct division — an over-firing lint rule is a disabled lint rule, and a lint rule that silently skipped an axis it could not verify would be worse than one that skips an axis nobody declared. Intake is the arm that sees the truth; lint is the arm that catches the same defect at authoring time on the axes the project has already committed to.

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
| `design.tokens.source` | to run intake | The authoritative design source — the file or library whose published variable collections define the regime. |
| `design.tokens.axes` | no | Axes the project declares typed. Mirrors what the collections publish; consumed by the lint rung, which cannot query. Absent means the lint rule reports nothing. |
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

A project with no variable system at all is not exempt and not blocked: every axis is untyped, everything is measured, and every measurement is recorded. The resulting inventory is the honest record of what a token system would need to cover, which is exactly the input the project needs before it builds one.

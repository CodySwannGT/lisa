---
name: lisa-design-intake
description: "Design-handoff gate for a work item with a UI surface. Resolves the source of truth PER AXIS (colour, spacing, typography, radius, elevation, motion) by querying the published variable collections of the configured design source — never by asking a human — then judges the work item against the five objectively checkable block conditions of the `design-value-binding` rule. Values come from design variables where a variable system exists; visual measurement is supplemental there and the legitimate primary source where none exists. Blocks on UNBOUND, never on UNSURE: aesthetic uncertainty with everything bound is not a block. Escalates a block through the vendor-neutral tracker abstraction to the configured `design.escalation.assignee`, with a plain-language comment a non-technical operator can act on, and records every value derived in an untyped axis so the gaps in the variable system accumulate on their own."
allowed-tools: ["Skill", "Bash", "Read", "Write"]
---

# Design Intake: $ARGUMENTS

`$ARGUMENTS` is one canonical work-item reference (JIRA key, Linear ref, `org/repo#123`), optionally followed by a design reference. With no arguments, resolve the work item from the worktree binding (`node scripts/lisa-work-item.mjs current`).

Run one design-handoff cycle against that work item: resolve the regime per axis, gather the facts, let `scripts/design-intake-gate.mjs` decide, and either escalate a block or hand back a proceed with the derived values recorded.

This skill carries the **judgment**. It does not carry the **policy** — that is the `design-value-binding` rule, which it cites rather than restates. Read the rule; do not re-derive its conditions here.

## What this is not

`design-source-of-truth` and `scripts/design-source-gate.mjs` already ask whether a changed surface **declares where its design came from**. This asks the orthogonal question: are the **values on it bound**. Both apply. A surface can cite a perfectly valid design node and still paint a literal that no variable backs — that is the case this skill exists for, and it is invisible to the other gate.

## Phase 0 — Is there a design source at all?

**A design source is optional, and this is the most important step in the skill.** Most projects have no designs. Run the probe and read its verdict:

```bash
node "${CLAUDE_PLUGIN_ROOT:-.}/scripts/design-bindings-probe.mjs" --json
```

A `SKIPPED` verdict means one of: `design.tokens.source` is unset, no access token is present, or no committed variable-id map exists. **Say so and stop cleanly — do not block.** A mandatory gate on an absent integration breaks every project that has no designs, which is a worse outcome than any drift it would have caught.

If a design source *is* configured, then per `tool-access-gate` a failed probe **against a configured source** is a block, not a reason to fall back to reading pixels: post the Access Needed comment, move the item to the configured `blocked` role with the `human_needed` marker, and stop.

## Phase 1 — Resolve configuration

Read `.lisa.config.local.json` first, then `.lisa.config.json`; local overrides global per key. Use `jq` — never hand-parse JSON.

```bash
read_key() {
  local key="$1" local_v global_v
  local_v=$(jq -r "$key // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r "$key // empty" .lisa.config.json 2>/dev/null)
  printf '%s' "${local_v:-$global_v}"
}
tokens_source=$(read_key '.design.tokens.source')
escalation_assignee=$(read_key '.design.escalation.assignee')
escalation_label=$(read_key '.design.escalation.label')
```

| Key | Missing means |
|---|---|
| `design.tokens.source` | Stop and report: the authoritative design source is not configured, so there is nothing to resolve the regime against. |
| `design.escalation.assignee` | **A block condition in its own right.** Do not guess a person, do not skip the escalation, do not assign to the current user. The gate raises `escalation-target-unset` and the run ends blocked. |
| `design.escalation.label` | Nothing. The label is an additive marker; absent means no marker is added. |

**Never write a person's name, handle, or identity into any artifact this skill produces.** These are config keys; the host supplies the values.

## Phase 2 — Resolve the regime, per axis

For each of the six axes — `color`, `spacing`, `typography`, `radius`, `elevation`, `motion` — determine whether the design source publishes variables covering it. **Never ask a human.**

**Do not try to list the published collections.** That route does not exist headlessly, and the measurement is worth carrying:

| Route | Gives names? | Headless? |
|---|---|---|
| Variables REST (`/v1/files/:key/variables/local`) | yes | **no** — Enterprise-plan only; the read scope is not offered in the token scope picker on other plans, so no token change unlocks it |
| Design-tool MCP (`get_variable_defs`) | yes, every plan | **no** — browser OAuth, which cron, CI, and a subagent cannot perform |
| `/v1/files/:key/nodes` | no — opaque `VariableID:106:15` | **yes**, on a plain access token |

A gate built on either of the first two runs interactively and silently no-ops everywhere else. So the regime is derived from the **committed variable-id map**, which `design-variable-ids.mjs` produced once, interactively, and which `design-bindings-probe.mjs` reads headlessly. An axis is typed when the map names at least one variable in its namespace.

`result.regime` from Phase 0 already carries this. Use it; do not re-derive it.

A mixed regime is the expected case, not an error state. Colour blocking while spacing gets measured, in the same work item, is the design working correctly.

**Probe the subtree you are implementing, not the enclosing screen.** Pass `--node` for the component you will actually build. A frame-level read counts the chrome behind a modal and over-reports — one measured work item scored 14 bound values at frame level and **zero** inside the modal subtree, and applying this rule changed 5 of 11 real work-item verdicts.

### When the map cannot name what it saw

The probe reports `owner: "us"` when a `VariableID` is unknown (the map is stale) or ambiguous (two variables share a value). **Neither is the designer's fault** — those values ARE bound. Do not escalate them to design. Regenerate the map:

```bash
FIGMA_ACCESS_TOKEN=… FIGMA_MCP_TOKEN=… \
  node "${CLAUDE_PLUGIN_ROOT:-.}/scripts/design-variable-ids.mjs" \
  --file <key> --light <nodes> --dark <nodes>
```

Pass `--dark` wherever the library has a dark mode: the light+dark signature is what separates variables that share a value, and without it more ids stay ambiguous. An ambiguous id is still a failure — guessing which variable a value came from is exactly what this contract forbids.

## Phase 3 — Gather findings

The probe already produced `hardcoded-in-design` and `bound` findings for every value in the subtree, with the two silent-under-reporting traps handled: the corner-keyed `rectangleCornerRadii` shape is normalised, and boundness is read from `boundVariables` directly rather than inferred from a resolved value (Figma omits zero-valued properties, so a padding bound to a zero-valued variable would otherwise vanish).

Add the findings the probe cannot see from a node payload — a named variable that does not exist, an unpublished component, a missing state, a source disagreement — plus the two non-blocking observations. **Findings are observations, not verdicts** — do not pre-judge them; the gate decides.

| `kind` | Emit when | Required fields |
|---|---|---|
| `bound` | A variable exists and the design binds it. The happy path. | `axis`, `component` |
| `hardcoded-in-design` | The frame paints a literal instead of binding a variable. | `axis`, `component`, `value` |
| `measured` | You read the value off the rendering rather than from a variable. | `axis`, `component`, `value` |
| `missing-token` | The item or frame names a variable the library does not publish. | `axis`, `component`, `name` |
| `unpublished-component` | The component lives in a draft or local file. | `component` |
| `missing-state` | A required state (disabled / error / loading / empty) has no design. | `component`, `state` |
| `source-disagreement` | The bound variable resolves to one value and the frame renders another. | `axis`, `component`, `tokenValue`, `frameValue` |
| `one-off` | A value that was never going to be shared — an illustration's exact offset. | `axis`, `component`, `value` |
| `aesthetic-concern` | You find the design ambiguous, unusual, or ugly, and every value you need is bound. | `component`, `note` |

Two of these rows carry most of the weight.

**`hardcoded-in-design` is the condition most often missed**, because nothing about the artifact looks wrong. The design is finished, the component renders, review sees a screenshot that matches — and the only symptom is that there is nothing to extract. Treating "I can see the value" as "I have the value" is precisely the failure this gate exists to catch.

**`aesthetic-concern` is a finding, not a block, and it must still be emitted.** Recording the observation without stopping on it is what keeps the gate from firing on opinion. If you find yourself reaching for a block because the design seems off rather than because a value is missing, that is an `aesthetic-concern` and the work proceeds.

Emit no finding kind outside this table. The gate throws on an unrecognised kind rather than inventing a verdict for facts it did not understand.

## Phase 4 — Let the gate decide

Merge the probe's findings with your own, write them to a JSON payload, and run the gate. Do not reimplement the decision in prose — a verdict reasoned out fresh each time is a verdict that decides differently on Tuesday.

```bash
node "${CLAUDE_PLUGIN_ROOT:-.}/scripts/design-intake-gate.mjs" --findings=design-facts.json --json
```

Payload shape:

```json
{
  "config": { "design": { "escalation": { "assignee": "…", "label": "…" } } },
  "regime": { "color": "typed", "spacing": "untyped" },
  "findings": [ { "kind": "hardcoded-in-design", "axis": "color", "component": "Raised card", "value": "#3A7BD5" } ]
}
```

Omit `config` to have the gate read the merged project config itself. Exit 0 = PROCEED, 1 = BLOCK, 2 = usage. **The gate fails closed**: an unreadable payload is a BLOCK with a named reason, never a quiet pass, because a gate that returns PROCEED on what it could not look at proves nothing.

## Phase 5a — BLOCK

1. **Post the comment.** Use `result.comment` **verbatim**. It is written for the non-technical operator standing at the gate: plain language, naming the specific missing artifact and what to do about it, with no factory vocabulary. Do not "improve" it into engineering terms — the vocabulary ban is enforced by the gate's own tests, and rewriting the comment is how it gets lost.

   > The 'Raised card' component uses the colour #3A7BD5 directly rather than a colour variable. I need that colour published as a variable so the app and the design stay in sync — otherwise I'd be copying a number that changes without warning.

2. **Transition to the configured `blocked` role** through `lisa-tracker-sync` / `lisa-tracker-write`. Never call a vendor label API directly — per `config-resolution`, Linear resolves `blocked` to a native workflow **state**, GitHub to a **label**, JIRA to a **status**, and hardcoding any one of them breaks the other two.

3. **Assign to `result.assignee`.** If it is `null`, the `escalation-target-unset` condition is already in `result.blocks` and the comment says so — post it and leave the item unassigned. Do not substitute a person.

4. **Add `result.label` as an additive marker** alongside the `blocked` role when one is configured, never instead of it. Add `human_needed` as well: a missing variable, an unpublished component, and a source disagreement all need a person to make a design decision, and none of them clear on a retry.

5. **Stop.** Do not partially build the surfaces that were fine. Design decisions arrive together, and half a screen built against half a design is rework.

**Route by owner.** Only `owner: "design"` reaches a designer. A stale or ambiguous id is `owner: "us"` — regenerate the map (Phase 2) and re-run. Sending that to a designer is the wrong person and the wrong work, and it teaches them to ignore the next one.

## Phase 5b — PROCEED

1. **Record the derived values** from `result.derived` on the work item — axis, component, and value for everything measured in an untyped axis. This costs nothing now and accumulates into an inventory of what the variable system is missing, **ranked by what people actually needed**, which no design-system audit produces on its own.
2. Build. In a **typed** axis, bind the variable and use a screenshot only to *verify*; a disagreement you find at that point is `source-disagreement` and sends the item back through this skill. In an **untyped** axis, measure — that is the correct source there.

The rule is never "do not look at pixels". It is **"do not derive a value from pixels when a binding exists."**

## Contract

- **Block on unbound, never on unsure.** Every block traces to one of the eight conditions in `BLOCK_CONDITIONS`. If you cannot name the condition, it is not a block.
- **The regime is per-axis**, derived from the committed variable-id map. Never per-project, never asked of a human, and never from a live collection query — that route does not run headlessly.
- **A design source is optional.** No source, no token, or no map is SKIPPED at exit 0, never a block.
- **Every failure names an owner.** Unbound values are design's; a stale or ambiguous map is ours.
- **The threshold is 100%.** Relax it only with an explicit `--min` on the command line, never by softening anything in code.
- **Never guess an escalation target**, and never proceed without one.
- **Never pick a side in a disagreement.** Which source is right is a design decision.
- **Never name a person** in a comment, a commit, or any artifact. Config keys only.
- **Never work around missing design information.** Substituting a nearby value, inventing a state, or narrowing scope to dodge the gap are all forbidden — same standard as `tool-access-gate`.
- Host design-system rules (`figma-design-system`, `design-system`, `use-the-design-library`, or the project's equivalent) stay authoritative about *what* to build. This skill never overrides them.

Full policy: the `design-value-binding` rule.

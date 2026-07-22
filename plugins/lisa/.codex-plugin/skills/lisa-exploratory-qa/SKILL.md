---
name: lisa-exploratory-qa
description: "First-time-user exploratory QA…"
---

# Exploratory QA

## Overview

Experience the product the way a **brand-new end user** would: drive its real consumer-facing interface and actually try to use it, then surface anything **confusing, broken, or hard to understand**. This is a usability/experience pass, **not** a test-coverage audit (for that, use `e2e-coverage-gaps`). Every finding is filed as a tracked work item so it enters the Lisa lifecycle — no static report file.

**How you drive the product is owned by the `use-the-product` core skill.** Invoke it first: it detects the product type (web / API / game / CLI / IaC), resolves the target environment and its **mutation policy** (so you never mutate production without an explicit, justified opt-in), and discovers the project's **personas** so you can explore as each one. This skill supplies the **QA lens** — what to look for and how to file it.

## Parameters

- **`target-url | env`** (first positional) — what to explore (passed through to `use-the-product`).
- **`ready=true|false`** — the build-ready state for the tickets this pass creates.
  - `ready=true` → created build-ready, so `lisa-intake` / the build-intake scanner auto-picks them up.
  - `ready=false` (**default**) → created in the backlog for a human to review and promote.

## 1. Set up

- **Invoke `use-the-product`** to detect the product type, resolve the environment + mutation policy, and discover personas/subagents. Everything about *how* to drive the product, *where*, and *how much you may mutate* comes from there — do not re-derive it.
- For a DOM web app whose resolved non-production environment has mutation policy `full`, check the optional Kane provider with `lisa kane probe`. If ready, invoke `lisa-kane-browser` for self-contained journeys and use its screenshots, HAR/network, console, and normalized verdict as evidence. Keep the run on a directly controlled browser for `read-only`/`forbidden` environments. Treat `tool_failed`/`timed_out` as provider findings, never as product bugs.
- **Confirm the tracker is configured.** Findings are filed as tickets, so read `tracker` from `.lisa.config.json` (local overrides global). If unset, stop and report that the tracker must be configured (`/lisa:setup:jira` / `:github` / `:linear`) before exploratory QA can file findings — do not silently fall back to a report file.
- Read the `ready` flag (default `false`).

## 2. Arrive cold and use it like a human

- Start with **no prior knowledge** — do not pre-read the codebase to learn the intended flows; discover them the way a user would. Form a first impression: is it obvious what this product is, what to do first, and where to go next?
- Then actually attempt real tasks through the interface (per `use-the-product`'s per-type playbook), exercising representative controls/endpoints/commands — a first-time user explores, makes mistakes, and tries the obvious thing.

## 3. The QA lens — what to look for

Cover at least these dimensions unless the user narrows scope. Most are universal; the web-specific ones are marked and have per-type equivalents in §4.

- **Comprehension & labeling:** user-facing copy must read like something a normal first-time user understands. Flag machine-style/developer labels (raw IDs, enum keys, `snake_case`, `null`/`undefined`, untranslated i18n keys), admin/database terms ("metadata", "rows", "record", "entity"), unexplained jargon, unclear button/menu names, and meaningless icons. If a label would make a non-technical user ask "what does that mean?", file a clarity ticket.
- **Data usefulness & context:** facts, metrics, and tables must help a person understand the surface, not just prove extraction happened. If a user can't tell what a number or field refers to without rereading the raw source, file a ticket to add context (excerpts, labels, grouping, provenance) or hide it.
- **Data volume & trust:** compare visible data to what the surface promises. A rich view with only a few items can read as broken/filtered/still-loading. File a finding when sparse data isn't explained (result counts, active filters, reset affordances, coverage status, sample labeling).
- **Controls & mental model:** controls must match what they do (sort ≠ filter; search ≠ facet; finite domains want selects/typeaheads, not blank text inputs). Flag controls that make users guess spelling/casing, hide the option universe, or use the wrong component.
- **Flow completeness & expected counterparts:** a screen that gates access or shows one side of a standard paired flow must offer the other side, or a clear path to it. A new user must never hit a dead end with no next step. Flag: **sign-in with no sign-up** (or vice-versa), **no account recovery** ("Forgot password?", resend verification), **no exit from a state** (no sign-out; a modal/wizard with no back/close/cancel), **one-way actions** (create with no edit/delete where both are expected), **unreachable entry points** (a feature only reachable by guessing a URL; an empty state with no primary action). When the missing counterpart makes a core task impossible for a class of users, file a `Bug`; otherwise a usability `Improvement`.
- **Action preconditions & incomplete end-states:** an action that needs multiple inputs or a prerequisite (compare, merge, bulk-edit) should guide the user to satisfy it — disable/explain until met, collect inputs first, or give the destination an in-place control. Actually trigger these and watch where they land; flag when a primary action fires under-satisfied and strands the user, lands on an empty/partial end-state with no next step, or is offered where it cannot succeed. Left unable to finish → `Bug`; works but confusing → `Improvement`.
- **Navigation clarity:** is it obvious how to get somewhere and back? Flag dead ends, hidden entry points, surprising redirects, broken links, no clear "home", and duplicated nav that competes for space without page-specific value.
- **Behavior correctness:** does the obvious action do what a user expects? Confusing errors, silent failures, disabled controls with no explanation, state that doesn't persist.
- **Affordance clarity:** can the user tell what is clickable, required, in-progress, or complete?
- **Load & responsiveness:** long/unclear loads, blank or skeleton-only shells, spinners with no progress. Flag surfaces that report "loaded" but where meaningful content arrives much later. Capture user-perceived timings (shell visible, first meaningful content, stable content); if the delay is noticeable, file it even when the eventual content is correct.
- **Visual/layout quality (DOM web):** cut-off/truncated text, overlap, cramped density, offscreen controls, accidental horizontal scroll. **Do not judge by eyeballing a screenshot alone** — confirm with the layout-integrity sweep in §4.
- **Consistency / standard UX:** components, spacing, terminology, and interaction patterns should be consistent and follow common conventions. Flag anything non-standard or screen-to-screen drift.

## 4. Type-specific depth

- **DOM web app — breakpoints & layout integrity.** Sweep a range of widths, including the *in-between* ones where clipping appears (e.g. 360, 390, 414, 600, 768, 834, 1024, 1280, 1440 plus ~900–1180 steps), and re-walk key paths at each. At every width, in addition to looking, take DOM measurements and treat as findings: **container overflow** (`documentElement.scrollWidth > clientWidth`); **clipped/offscreen controls** (a control's `getBoundingClientRect()` falling outside the viewport or an `overflow:hidden|clip|auto|scroll` ancestor — e.g. a submit button cut off by its filter card); **truncated meaningful text** (`scrollWidth > clientWidth` / ellipsis on text that carries meaning); **colliding controls** (label overlapping an adjacent control with no gap). A primary/interactive control that is clipped, offscreen, or unreachable is a **`Bug`**, not an Improvement.
- **HTTP / API backend.** Judge the *contract as a consumer experiences it*: unclear/inconsistent status codes, error responses with no actionable message, payloads exposing internal shapes (raw enums, DB column names), missing pagination/among-counts, endpoints that 500 on obvious edge inputs. A broken/incorrect response is a `Bug`; a confusing-but-working contract is an `Improvement`.
- **Canvas game.** Judge readability at gameplay scale, input responsiveness/latency, game-feel, unclear objectives, and silent state changes — not DOM breakpoints. A soft-lock or lost progress is a `Bug`; unclear-but-playable friction is an `Improvement`.
- **CLI / library.** Judge help/output clarity, error messages, discoverability of commands, and surprising side effects. A wrong result / crash is a `Bug`; confusing UX is an `Improvement`.
- **IaC / CDK (read-only).** From `cdk synth`/`diff`: over-broad IAM, missing/opaque stack outputs, resources that don't serve their stated purpose, drift. A security-relevant misconfiguration is a `Bug`; unclear-but-correct infra is an `Improvement`.

## 5. Mutation

Whether you may create/edit/delete — and as which account — is set by the `use-the-product` mutation policy (`read-only` vs `full`, `identity`, production rules). Follow its **Mutation Discipline** when the policy is `full` (prefixed test data, identify + verify cleanup, record residue). Never mutate an env the policy marks `read-only` or `forbidden`; if a finding can only be confirmed by a forbidden mutation, file it as observed-and-blocked rather than escalating.

## 6. File findings as tracked work

No report file. Every finding becomes a **leaf work item** via `lisa-tracker-write` (the vendor-neutral writer — it dispatches to the configured tracker and runs the validation gate; never call a vendor `*-write-*` skill directly):

Kane never files the work item itself. Even when it marks a failure as a confirmed product bug, run Lisa's marker-based duplicate search, apply the QA lens, and route the finding through `lisa-tracker-write` exactly as for every other controller.

| Finding | `issue_type` | `build_ready` |
|---|---|---|
| User-visible **bug** (broken behavior) | `Bug` | the `ready` flag (default `false`) |
| **Usability / UX / clarity issue** | `Improvement` | the `ready` flag (default `false`) |

Each finding is a flat leaf, so `build_ready` applies directly — pass it explicitly on every create. Each ticket MUST be a complete spec (the validator rejects thin tickets): a **three-audience description**; for a **bug**, exact reproduction steps, observed-vs-expected, the env / account / interface it occurred at, and evidence; for a **usability issue**, the observed friction, who it affects, **where**, and the proposed improvement; and **Gherkin acceptance criteria** for the fixed behavior.

### Idempotency — don't spam duplicates

Re-running a pass must not refile the same finding. Before creating a ticket, search the tracker for a ticket carrying a stable marker `[lisa-exploratory-qa] <finding-key>` in its body (the `<finding-key>` is a stable slug of surface + symptom, e.g. `settings-modal/horizontal-overflow@tablet`). Per the `rejection-detection` rule's **Proposal rejection memory** section, that marker search MUST cover **open AND closed** tickets (with a body-enumeration fallback on search-index lag), and **match by the marker, never by title.** Then split on how any prior ticket closed:

- **Open** ticket carrying the marker → reference/update it instead; do not create a second.
- **Closed as _completed_** → does **not** suppress. A recurrence after a fix is a genuine **regression**, so file the finding.
- **Closed as _not planned_** (GitHub `stateReason == "not_planned"`; the config-resolved won't-do/canceled equivalent on JIRA/Linear, including a Linear `duplicate` state) → a human **declined** this finding, so **suppress it**. Re-file only with evidence that **postdates the decline**, carrying BOTH the machine token (`declined <date>; recurred <date> in <ref>`) and a human acknowledgment sentence (`You declined this on <date>. It has recurred (<date>, <ref>), so we're raising it once more for your review.`).

Every filed finding ticket MUST end with the `rejection-detection` **operator footer** as a visible prose line so the operator knows which close-reason silences it:

> To stop this from being raised again, close it as **Not planned**. Close it as **Completed** if it was fixed — a later recurrence may be re-filed as a regression.

## Output

No report file. Emit a concise in-session summary:

- **Scope:** product type, target env + mutation level, persona(s) explored as, tool, build/version if visible, date.
- **First impression:** could a new user tell what the product is and what to do first?
- **Findings filed**, bucketed by type — each with its **created or referenced ticket ref** and **build-ready state**.
- **Observed but not filed:** anything noticed but intentionally not ticketed (including forbidden-mutation blocks), with why.

## Run outcome

As the registered `exploratory-bugs` automation loop, this pass conforms to the
`automation-runbook-contract` rule: every invocation ends in **exactly one** of the six run outcomes
and records it, so a quiet run and a broken run are never mistaken for each other.

| This cycle's exit path | Run outcome |
|---|---|
| Findings filed — one or more `Bug` / `Improvement` tickets created or referenced (§6) | `candidate-proposed` |
| Clean pass — explored the personas and surfaces, nothing worth filing — **or** every candidate was suppressed by a prior decline (`rejection-detection` **Proposal rejection memory**): the summary MUST name the suppression count | `nothing-needed` |
| Tracker unconfigured — the §1 stop path; findings cannot be filed — **or** the open-and-closed rejection-memory marker search could not run (tracker unreachable / credentials revoked): a memory check that could not run is a broken loop, never a silent `nothing-needed` | `recovery-required` |
| The runbook's **Retirement condition** tripped — the trailing quiet window is empty AND this pass found nothing to file AND the project no longer ships an exploratory-qa surface — this row supersedes the `nothing-needed` row when it applies | `policy-obsolete` |
| A degradation that still let the pass explore (e.g. Kane unavailable, one persona unreachable) | the outcome it actually reached above, with the summary **leading with the degradation** — degradation never mints a seventh token |

Before invoking the run-record CLI, evaluate the **Retirement condition** first. If it applies,
select `policy-obsolete` as the sole outcome and do not record a prior `nothing-needed` result;
otherwise select the ordinary outcome from the table.

Record **exactly one** outcome per invocation through the run-record CLI, naming this loop's runbook
(the `--summary` is the operator-readable one-liner in the contract's exemplar voice — plain,
specific, actionable, e.g. `Explored 4 personas; nothing confusing to file.` — or, when a decline suppressed the only candidates, `Explored 4 personas; 2 candidates suppressed by a prior decline — nothing new to propose.` — for `nothing-needed`; and for a `recovery-required` from an unreadable decline check, `Tracker unreachable during the decline check — restore credentials; nothing was filed this run.`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/automation-run-record.mjs" \
  --loop-id exploratory-bugs --outcome candidate-proposed \
  --summary "Explored 4 personas; filed 3 findings from the checkout flow — awaiting your flip to ready." \
  --runbook .lisa/automations/exploratory-bugs.runbook.md [--ref <ticket-url>]...
```

If `${CLAUDE_PLUGIN_ROOT}` is unset, resolve the plugin scripts directory directly — the built copy
`plugins/lisa/scripts/automation-run-record.mjs` or the source
`plugins/src/base/scripts/automation-run-record.mjs`. If recording still fails, **degrade, never
abort** (per `automation-runbook-contract`): note the recording failure in the run output and finish
the cycle — a recording failure is a degradation to report, never a reason to block the loop.

**Retirement evaluation (every run).** Evaluate this loop's runbook **Retirement condition** on
every run, exactly as the `automation-runbook-contract` rule's Retirement section defines it — this
skill conforms to that text and never restates or diverges from it. On top of the contract's two
conditions the runbook seeds a third **domain conjunct** — the project no longer ships an
exploratory-qa command surface to explore — which only tightens the test and never replaces it: a
quiet month on a product nobody broke is quality holding, not a reason to stop looking. Evaluate all
three. When all three hold, record `policy-obsolete` and file **exactly ONE** marker-deduped
teardown proposal through `lisa-tracker-write` (per `tracked-work` + `integration-access-layer`):

- **Marker** `<!-- [lisa-automation-retire] key=exploratory-bugs -->` plus a visible prose line;
  matched on the marker, never the title; searched **open AND closed** per `rejection-detection`'s
  **Proposal rejection memory**. Treat matches by close state: **open** suppresses another proposal;
  **Not planned** suppresses another proposal unless new evidence postdates the rejection;
  **Completed** means the prior approved action happened, so a later recurrence may be re-filed.
  When an existing proposal suppresses filing, **the run still records `policy-obsolete` and files
  nothing** — the outcome describes this run, while the ticket is filed exactly once.
- **Labels** `status:blocked` + `human-needed`, carrying the contract's decision-ready packet. The
  `human-needed` label marks the proposal human-owned: `lisa-repair-intake` recognizes it and never
  re-dispatches it as stalled work.
- **Evidence** the date-filtered search result, this run's summary, **the loop's current cadence**
  (the baseline an operator needs to choose a longer one), and a one-line summary of recent runs
  read from `.lisa/automations/runs/exploratory-bugs.jsonl`. Fill the rest of the packet the same
  way every time: *Work already attempted* is the searches this run ran, and *Risk of inaction* is
  that the loop keeps consuming schedule slots and tokens for nothing.
- **How to answer** names the three operator responses: **approve** — run
  `/lisa:tear-down-automations exploratory-bugs` and only that loop registration goes away;
  **decline** — close the proposal as
  **Not planned** (closing it as **Completed** leaves a later re-file open) and the loop simply
  continues; **re-cadence** — pick a longer cadence off that evidence and re-register with
  `/lisa:setup-automations` instead of tearing down.
- **Operator footer**, verbatim, as on every loop-filed proposal (`rejection-detection`):
  > To stop this from being raised again, close it as **Not planned**. Close it as **Completed** if it was fixed — a later recurrence may be re-filed as a regression.

The loop **keeps running at its normal cadence** until a human acts, and never deletes its own
registration.

## Quality bar

- Explore as a true first-time user — judge clarity, not whether you (who can read the code) can figure it out.
- Every ticket must stand alone for an implementer who was not in the session.
- Do not claim cleanup succeeded unless verified.
- File per the `ready` flag (default: backlog for human triage).
- Route automated-coverage gaps to `e2e-coverage-gaps`; preserve unrelated repo changes.

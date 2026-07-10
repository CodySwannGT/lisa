---
name: lisa-product-walkthrough
description: "Methodology for evaluating the…"
allowed-tools: ["Skill", "Bash", "Read", "mcp__plugin_playwright_playwright__browser_navigate", "mcp__plugin_playwright_playwright__browser_snapshot", "mcp__plugin_playwright_playwright__browser_take_screenshot", "mcp__plugin_playwright_playwright__browser_click", "mcp__plugin_playwright_playwright__browser_type", "mcp__plugin_playwright_playwright__browser_select_option", "mcp__plugin_playwright_playwright__browser_fill_form", "mcp__plugin_playwright_playwright__browser_press_key", "mcp__plugin_playwright_playwright__browser_hover", "mcp__plugin_playwright_playwright__browser_navigate_back", "mcp__plugin_playwright_playwright__browser_resize", "mcp__plugin_playwright_playwright__browser_tabs", "mcp__plugin_playwright_playwright__browser_console_messages", "mcp__plugin_playwright_playwright__browser_network_requests", "mcp__plugin_playwright_playwright__browser_wait_for", "mcp__plugin_playwright_playwright__browser_close"]
---

# Live Product Walkthrough

Reading a PRD or a mock without seeing the current product produces tickets that misjudge the change. This skill defines how to evaluate the live product *before* planning tickets, so the work is grounded in what actually exists today.

**How you drive the product is owned by the `use-the-product` core skill** — it detects the product type (web / API / game / CLI / IaC), resolves the target environment and its **mutation policy** from `.lisa.config.json`, and discovers the project's **personas**. A walkthrough is read-leaning: prefer the policy's **read-only** actions, and only mutate when both the policy allows it (`full`) and a flow genuinely can't be understood without it. This skill adds the **planning lens** below.

## When to invoke

Always run a walkthrough when the work touches user-facing surfaces:

- The PRD describes a change to an existing screen, flow, or interaction
- The PRD adds something *next to* existing functionality (entry points, navigation, related surfaces)
- A mock or prototype implies a re-style or re-flow of something currently shipped
- The change is a "bug" framed as a fix to current behavior — you must see the current behavior before reasoning about the fix

Skip when the work is purely internal (type-only, doc-only) or affects a surface that does not yet exist in production / dev.

## 1. Plan the walkthrough

Before driving anything, list the surfaces the change will touch:

- Which screens/routes/endpoints are involved (current and new)?
- Which user roles need to be exercised (admin / customer / etc.)?
- Which states matter (signed-out, signed-in, empty, populated, error, loading)?
- For a DOM web app, which viewports matter (desktop always; mobile when responsive)?

Write this list down. If you can't, the PRD is too vague — note it as a coverage smell and surface it as an Open Question on the resulting ticket.

## 2. Drive the current product

**Invoke `use-the-product`** to detect the type, resolve the environment + mutation policy, and discover personas — then drive the surfaces from step 1 through its per-type playbook (browser for DOM, `curl` for an API, canvas+input for a game, `cdk synth`/`diff` for IaC). Capture evidence as you go: for a DOM app, a `browser_snapshot` (accessibility tree — best for reasoning) and a `browser_take_screenshot` (visual) per surface and per state, plus `browser_console_messages` / `browser_network_requests` after interactions; for an API, representative request/response pairs; for a game, screenshots of each state. If the project defines personas, walk the surfaces as the relevant archetype(s).

Honor the mutation gate: on a `read-only` env, observe without submitting; never walk a `forbidden` env (production defaults to forbidden). Treat console errors, 4xx/5xx, and unexpected calls as findings.

## 3. Record findings

For every walkthrough, record:

- **What exists today**: a short prose description of the current flow, the components/endpoints in use (identify them from the snapshot/routes where you can), and the states observed.
- **What the PRD changes**: explicit delta — added / removed / modified surfaces, new/removed states.
- **Existing-component reuse candidates**: components or endpoints in the current product that could absorb the new behavior (see `lisa-tracker-source-artifacts` §7).
- **Design-vs-current-product divergence**: where the mock/prototype materially diverges from what's shipped. Each divergence is a discussion item, not an automatic rebuild (see `lisa-tracker-source-artifacts` §3).
- **Coverage smells**: states the PRD doesn't address that exist today (e.g. the mock shows the empty state but ignores the populated state 90% of users see).
- **Behavioral surprises**: anything that doesn't match the PRD's assumptions about current behavior — usually the most valuable findings, because they invalidate parts of the PRD.

## 4. Attach evidence and close

Capture evidence so the originating ticket / Notion comment / PRD review can reference it. Close the session when done (`browser_close` for a browser) — walkthroughs are short, focused, and one-shot.

- For **PRD intake**: include a "Current Product" comment on the Notion PRD with the findings prose and inline screenshots alongside each affected surface.
- For **ticket creation**: include the findings under `## Current Product` in the ticket description (Story or Epic). Reference screenshots as remote links or attachments.
- For **change-impact analysis**: produce a short report; the consuming skill decides where it lands.

## Findings format

Use this structure when emitting walkthrough findings, so consuming skills can splice them into tickets / comments unchanged. The `## Current Product` heading matches what `lisa-jira-write-ticket` Phase 4e expects to inherit — keep the heading exact.

```text
## Current Product

**Environment**: <target> as <account/role> (<mutation level>)
**Explored as**: <persona(s) or "generic representative user">
**Viewports exercised**: Desktop 1512×768, Mobile 375×812   (DOM web only)

### Surfaces walked
1. <route/endpoint/screen> — <one-line current behavior>
2. <route/endpoint/screen> — <one-line current behavior>

### What exists today
<2-4 sentence prose summary of the current flow and components/endpoints in use>

### Delta vs. PRD
- ADDED: <new surface/state from PRD>
- MODIFIED: <existing surface, with the change>
- REMOVED: <existing surface PRD removes>
- UNCHANGED-BUT-IMPACTED: <existing surface PRD doesn't mention but will be affected>

### Existing-component reuse candidates
- <component / endpoint / screen> — could absorb <new behavior>

### Design-vs-current-product divergence
- <mock or prototype reference> diverges from <current surface> in: <specific dimension>
- Recommendation: <reuse / new build / discussion>

### Coverage smells & behavioral surprises
- <smell or surprise>

### Evidence
- <list of screenshots/snapshots/request-response pairs, with captions>
```

## Rules

- Walk before you write. If the work touches existing user-facing surfaces and the walkthrough wasn't done, the resulting ticket is missing context — don't ship it.
- Never walk a `forbidden` environment (production is forbidden by default). Use `dev`/`staging` per the `exploration` config, and default to read-only for a planning walkthrough.
- Treat console errors and unexpected network calls as findings — they often reveal undocumented behavior the PRD assumes is fine.
- Findings drive `## Open Questions` on tickets, not silent assumptions. If the current product contradicts the PRD, surface it as a BLOCKER.
- This skill captures observations; it does not edit the tracker or the PRD. Consuming skills decide where findings land.

---
name: product-walkthrough
description: "Methodology for evaluating the live product via a real browser (Playwright MCP) when planning work or evaluating a PRD. Reading a PRD or a mock without seeing the current product produces tickets that misjudge the change — this skill grounds the analysis in what actually exists today. Invoke this skill from notion-to-tracker (Phase 2b live-product walkthrough), jira-create, and any PRD intake flow whose work touches existing user-facing surfaces."
allowed-tools: ["Skill", "Bash", "Read", "mcp__plugin_playwright_playwright__browser_navigate", "mcp__plugin_playwright_playwright__browser_snapshot", "mcp__plugin_playwright_playwright__browser_take_screenshot", "mcp__plugin_playwright_playwright__browser_click", "mcp__plugin_playwright_playwright__browser_type", "mcp__plugin_playwright_playwright__browser_select_option", "mcp__plugin_playwright_playwright__browser_fill_form", "mcp__plugin_playwright_playwright__browser_press_key", "mcp__plugin_playwright_playwright__browser_hover", "mcp__plugin_playwright_playwright__browser_navigate_back", "mcp__plugin_playwright_playwright__browser_resize", "mcp__plugin_playwright_playwright__browser_tabs", "mcp__plugin_playwright_playwright__browser_console_messages", "mcp__plugin_playwright_playwright__browser_network_requests", "mcp__plugin_playwright_playwright__browser_wait_for", "mcp__plugin_playwright_playwright__browser_close"]
---

# Live Product Walkthrough

Reading a PRD or a mock without seeing the current product produces tickets that misjudge the change. This skill defines how to use a real browser (via Playwright MCP) to evaluate the live product *before* planning tickets, so the work is grounded in what actually exists today.

## When to invoke

Always run a walkthrough when the work touches user-facing surfaces:

- The PRD describes a change to an existing screen, flow, or interaction
- The PRD adds something *next to* existing functionality (entry points, navigation, related screens)
- A mock or prototype implies a re-style or re-flow of something currently shipped
- The change is a "bug" framed as a fix to current behavior — you must see the current behavior before reasoning about the fix

Skip when the work is purely backend with no user-visible surface, type-only, doc-only, or affects a screen that does not yet exist in production / dev.

## Configuration

Required inputs (ask if not set):

| Variable | Purpose | Example |
|----------|---------|---------|
| `E2E_BASE_URL` | Frontend base URL to walk through | `https://dev.example.io/` |
| Sign-in account | Test user to sign in as for the affected flows | from PRD config / 1Password / env |
| Sign-in credentials | How to obtain (1Password item, env vars) | `E2E_TEST_PHONE`, `E2E_TEST_OTP` |

Walk through `dev` (or the env named in the PRD) — never `prod` for exploratory walkthroughs unless explicitly asked.

## Process

### 1. Plan the walkthrough

Before opening the browser, list the surfaces the change will touch:

- Which screens/routes are involved (current and new)?
- Which user roles need to be exercised (admin / customer / etc.)?
- Which states matter (signed-out, signed-in, empty, populated, error, loading)?
- Which viewports matter (desktop always; mobile when responsive; tablet rarely)?

Write this list down. If you can't, the PRD is too vague — note this as a coverage smell and surface it as an Open Question on the resulting ticket.

### 2. Open the browser and sign in

1. `browser_navigate` to `E2E_BASE_URL`.
2. `browser_resize` to the primary viewport (default desktop 1512×768).
3. Sign in via the test account. Use `browser_fill_form` and `browser_click`. Capture the post-login screen with `browser_snapshot` or `browser_take_screenshot`.

### 3. Walk the affected surfaces

For each surface from step 1:

1. Navigate to it. Capture a `browser_snapshot` (accessibility tree — better for reasoning) and a `browser_take_screenshot` (visual evidence).
2. Exercise the relevant interactions. Capture state transitions.
3. Capture each state that matters (empty, populated, error, loading) — explicitly trigger them where possible.
4. For responsive changes, `browser_resize` to the secondary viewport (mobile 375×812) and re-capture.
5. `browser_console_messages` and `browser_network_requests` after each interaction — surface any errors, 4xx/5xx, or unexpected calls.

### 4. Record findings

For every walkthrough, record:

- **What exists today**: a short prose description of the current flow, the components in use (if you can identify them from the DOM via `browser_snapshot`), and the states observed.
- **What the PRD changes**: explicit delta — added screens, removed screens, modified components, new states, removed states.
- **Existing-component reuse candidates**: components in the current product that could absorb the new behavior. The PRD-vs-current-product comparison drives which existing components a developer should reuse instead of building new (see `lisa:tracker-source-artifacts` §7).
- **Design-vs-current-product divergence**: places where the mock/prototype materially diverges from what's shipped. Each divergence is a discussion item, not an automatic "rebuild from scratch" — see `lisa:tracker-source-artifacts` §3 (mocks define visual intent, not implementation shortcut).
- **Coverage smells**: states the PRD doesn't address that exist today (e.g., the mock shows the empty state but ignores the populated state that has 90% of users).
- **Behavioral surprises**: anything that doesn't match the PRD's assumptions about current behavior — these are usually the most valuable findings, because they invalidate parts of the PRD.

### 5. Attach evidence to the originating context

Capture screenshots/snapshots in a way that the originating ticket / Notion comment / PRD review can reference them.

- For **PRD intake**: include a "Current Product" comment on the Notion PRD with the findings prose and inline screenshots of the current state alongside each affected screen mentioned in the PRD.
- For **ticket creation**: include the findings under `## Current Product` in the ticket description (Story or Epic). Reference the screenshots as remote links if hosted, or inline them as attachments.
- For **change-impact analysis**: produce a short report; the consuming skill decides where it lands.

### 6. Close the browser

`browser_close` when done. Walkthroughs are short, focused, and one-shot — do not leave a session open across phases.

## Findings format

Use this structure when emitting walkthrough findings, so consuming skills can splice them into tickets / comments unchanged. The `## Current Product` heading matches what `lisa:jira-write-ticket` Phase 4e expects to inherit — keep the heading exact.

```text
## Current Product

**Environment**: <E2E_BASE_URL> as <account/role>
**Viewports exercised**: Desktop 1512×768, Mobile 375×812

### Surfaces walked
1. <route> — <one-line current behavior>
2. <route> — <one-line current behavior>

### What exists today
<2-4 sentence prose summary of the current flow and components in use>

### Delta vs. PRD
- ADDED: <new surface/state from PRD>
- MODIFIED: <existing surface, with the change>
- REMOVED: <existing surface PRD removes>
- UNCHANGED-BUT-IMPACTED: <existing surface PRD doesn't mention but will be affected>

### Existing-component reuse candidates
- <component or screen> — could absorb <new behavior>

### Design-vs-current-product divergence
- <mock or prototype reference> diverges from <current screen> in: <specific dimension>
- Recommendation: <reuse / new build / discussion>

### Coverage smells & behavioral surprises
- <smell or surprise>

### Evidence
- <list of screenshots/snapshots, with captions>
```

## Rules

- Walk before you write. If the work touches existing user-facing surfaces and the walkthrough wasn't done, the resulting ticket is missing context — don't ship it.
- Never walk `prod` for exploratory analysis. `dev` (or the env named in the PRD) only.
- Treat console errors and unexpected network calls as findings — they often reveal undocumented behavior the PRD assumes is fine.
- Findings drive `## Open Questions` on tickets, not silent assumptions. If the current product contradicts the PRD, surface it as a BLOCKER.
- This skill captures observations; it does not edit JIRA or the PRD. Consuming skills decide where findings land (ticket description, Notion comment, validator input).

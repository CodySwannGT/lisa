---
name: e2e-coverage-gaps
description: "Playwright/e2e coverage-gap…"
---

# E2E Coverage Gaps

## Overview

Find where the automated end-to-end (Playwright) suite is **blind**: routes with no test at all, and
flows that only assert the **happy path** while ignoring error, permission, empty, loading, and edge
cases. Inventory the app's routes and the existing tests, explore the running app to confirm each gap
is real and reachable, then file each gap as a **build-ready missing-test work item** so it enters the
Lisa lifecycle.

This skill is purely about **automated-coverage gaps**. It does not judge whether the UI is confusing
or pretty — for human usability findings, use the `lisa-exploratory-qa` skill.

## Parameters

- **`target-url | env`** (first positional) — the app to inventory and explore.
- **`ready=true|false`** — build-ready state for the missing-test tickets (**default `true`**). Adding
  missing coverage is safe to queue, so these default to build-ready; pass `ready=false` to leave them
  in the backlog for human triage.

## Core Workflow

### 1. Establish Scope

- Identify the target environment, account type, and browser requirement, and read the `ready` flag
  (default `true`).
- **Confirm the tracker is configured.** Gaps are filed as tickets, so read `tracker` from
  `.lisa.config.json` (local overrides global). If it is unset, stop and report that the tracker must
  be configured (via `/lisa:setup:jira` / `:github` / `:linear`) before gaps can be filed.

### 2. Inventory App Routes

- Enumerate every route/screen from the project's routing source — filesystem routes, the router
  config, navigation definitions, or a generated sitemap.
- For each route capture: its path + params, the auth/role it requires, and the primary user actions
  reachable from it (forms, mutations, filters, flows).

### 3. Inventory Existing Playwright Coverage

- Inspect the Playwright config, auth/setup projects, fixtures, constants, selectors, spec directories,
  skipped/TODO/flaky tests, retries, and viewport/device projects.
- For each spec, record which route(s)/flow(s) it exercises and whether it asserts **behavior** or just
  **presence**.
- Use existing test helpers/selectors when exploring — they reveal intended flows and stable hooks.

### 4. Compute the Gap Matrix

Map routes/flows against existing coverage and classify each gap:

- **Uncovered route/flow:** no test touches it at all.
- **Happy-path-only:** the success case is tested but the non-happy paths are not — missing
  error/validation, permission/denied, empty/zero-state, loading/slow, and boundary/edge scenarios.
- **Assertion-thin:** a test exists but asserts presence rather than behavior/outcome.
- **Skipped/TODO/flaky:** coverage exists but is disabled or unreliable.
- **Breakpoint gap:** a flow is only tested at a single viewport when behavior changes across
  breakpoints.

### 5. Explore to Confirm

- Navigate each candidate gap in the running app to confirm it is real, reachable, and worth a test.
  Discard gaps that aren't actually reachable or are intentionally out of scope.

### 6. File One Ticket Per Gap

Each confirmed gap becomes a leaf **missing-test** work item created via `lisa-tracker-write` (the
vendor-neutral writer — it dispatches to the configured tracker and runs the validation gate; never
call a vendor `*-write-*` skill directly), `issue_type: Task`, **build-ready per the `ready` flag
(default `true`)**. Pass `build_ready` explicitly on every create. Each ticket MUST specify:

- The **route/flow** and the exact **user behavior the test must assert**.
- **Which scenario is missing** (uncovered vs which non-happy path: error / validation / permission /
  empty / loading / edge / breakpoint).
- The **stable selector / fixture / flow** to use — concrete and automatable.
- **Three-audience description** + **Gherkin acceptance criteria** describing the test to add.

### Idempotency — don't spam duplicates

Before creating a ticket, search the tracker for an **open** ticket carrying a stable marker
`[lisa-e2e-coverage-gaps] <gap-key>` in its body (the `<gap-key>` is a stable slug of route + missing
scenario, e.g. `checkout/payment-declined` or `dashboard/empty-state@mobile`). If one exists, reference
it instead of duplicating. **Match by the marker, never by title.** A *closed* prior ticket does not
suppress a genuine new gap.

## Output

No report file. Emit a concise in-session summary:

- **Route inventory:** count of routes/screens discovered.
- **Existing coverage:** strengths and thin areas (skipped/flaky, assertion-thin, single-viewport).
- **Gap matrix:** uncovered vs happy-path-only vs breakpoint gaps.
- **Tickets filed:** each gap with its created/referenced ticket ref and build-ready state.

## Quality Bar

- Distinguish **no coverage** from **happy-path-only** — both are gaps, but the ticket must say which.
- Every ticket must stand alone for an implementer who was not in the session and must be concretely
  automatable (named route, behavior, and stable hook).
- Do not refile gaps already covered or already ticketed (marker check).
- This skill is about automated coverage only — route human usability issues to `lisa-exploratory-qa`.
- Preserve unrelated repo changes.

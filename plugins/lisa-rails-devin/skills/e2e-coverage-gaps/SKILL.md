---
name: e2e-coverage-gaps
description: Playwright/e2e coverage-gap explorer that FEEDS THE LIFECYCLE. Use when asked to find paths the automated end-to-end suite does NOT cover — routes with no test at all, or flows that are only happy-path tested (missing error, validation, permission, empty, loading, and edge states). It inventories the app's routes and the existing Playwright tests, explores the running app to confirm each uncovered or under-covered path is real and reachable, and files bounded build-ready work for worthwhile test gaps via lisa-tracker-write. For human usability/experience issues (confusing, cramped, or broken UI), use the lisa-exploratory-qa skill instead.
---

# E2E Coverage Gaps

On runtimes without the rule tree (Antigravity), read **Worth doing** in `lisa-track` for the same value and decline policy.

## Overview

Find where the automated end-to-end (Playwright) suite is **blind**: routes with no test at all, and
flows that only assert the **happy path** while ignoring error, permission, empty, loading, and edge
cases. Inventory the app's routes and the existing tests, explore the running app to confirm each gap
is real and reachable, then group worthwhile gaps into **bounded build-ready missing-test work items** so it enters the
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

- Apply `do-it-now`'s **Worth doing** guidance: missing coverage alone is not a defect. Identify a required behavior or credible material risk; decline low-value gaps without filing and group related accepted gaps.
- Navigate each candidate gap in the running app to confirm it is real, reachable, and worth a test.
  Discard gaps that aren't actually reachable or are intentionally out of scope.

### 6. File Bounded Work for Accepted Gaps

Each accepted gap or coherent group becomes a leaf **missing-test** work item created via `lisa-tracker-write` (the
vendor-neutral writer — it dispatches to the configured tracker and runs the validation gate; never
call a vendor `*-write-*` skill directly), `issue_type: Task`, **build-ready per the `ready` flag
(default `true`)**. For `ready=true`, pass `build_ready: true`. For `ready=false`,
pass `human_gate: "Coverage work explicitly held for operator prioritization"` instead.
Each ticket MUST specify:

- The **route/flow** and the exact **user behavior the test must assert**.
- **Which scenario is missing** (uncovered vs which non-happy path: error / validation / permission /
  empty / loading / edge / breakpoint).
- The **stable selector / fixture / flow** to use — concrete and automatable.
- **Three-audience description** + **Gherkin acceptance criteria** describing the test to add.

### Idempotency — don't spam duplicates

Before creating a ticket, follow `rejection-detection` — **Proposal rejection memory**:
use `<!-- [lisa-e2e-coverage-gaps] key=<candidate-key> -->` with the normalized route +
missing scenario hashed deterministically by that rule's existing formula. Search open AND
closed tickets, including its body-enumeration fallback for search-index lag. Match by the
marker for any constituent gap, never by title alone. Reuse open matches. For legacy issues
without a marker or with the older `[lisa-e2e-coverage-gaps] <gap-key>` slug marker, read
bodies and closing discussions to establish a semantic match; title similarity
alone is insufficient. A **Not planned** decision suppresses the same accepted
limitation, even when seen again later. Re-propose only for a materially changed
consequence, requirement, or risk that addresses the decline. A completed fix may
have a real regression, which must be verified before filing. Grouped work retains
the constituent gap markers so a later pass can find it.

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

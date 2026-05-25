---
name: exploratory-qa
description: Playwright-backed exploratory QA workflow for web apps that FEEDS THE LIFECYCLE. Use when asked to audit an app with Playwright/e2e tests, find human-noticeable bugs and usability issues, identify gaps in automated test coverage, test responsive breakpoints, observe slow or unclear load states, or exercise mutable workflows with cleanup. Instead of writing a report file, it files every finding as a tracked work item via lisa:tracker-write (bugs, usability suggestions, and missing Playwright tests). A `ready` parameter controls whether bug and suggestion tickets are created build-ready (auto-picked-up by lisa:intake) or in the backlog for human triage (default); missing-test tickets are always created build-ready.
---

# Exploratory QA

## Overview

Run a human-style exploratory QA pass informed by the existing Playwright suite, then **file every finding as a tracked work item** in the project's configured tracker so it enters the Lisa lifecycle. The goal is to find issues users notice and machines often miss — bugs, usability friction, and coverage gaps — and turn each into actionable, automatable work, not a static report.

## Parameters

- **`target-url | env`** (first positional) — what to audit.
- **`ready=true|false`** — the build-ready state for the **bug** and **usability/suggestion** tickets this pass creates.
  - `ready=true` → created build-ready, so `lisa:intake` / the build-intake scanner auto-picks them up.
  - `ready=false` (**default**) → created in the backlog (not build-ready) for a human to review and promote into the queue.
  - **Missing Playwright test tickets are ALWAYS created build-ready, regardless of this flag** — adding missing coverage is always safe to queue.

`ready` maps directly to the `build_ready` write-control input on `lisa:tracker-write`.

## Core Workflow

### 1. Establish Scope

- Identify the target environment, account type, browser requirement, and the `ready` flag value (default `false`).
- **Confirm the tracker is configured.** Findings are filed as tickets, so read `tracker` from `.lisa.config.json` (local overrides global). If it is unset, stop and report that the tracker must be configured (via `/lisa:setup:jira` / `:github` / `:linear`) before exploratory QA can file findings — do not silently fall back to a report file.
- If credentials, tenant, seed data, or mutation boundaries are missing and cannot be discovered safely, ask a concise clarifying question.
- Treat production-like environments conservatively. Do not mutate production data unless the user explicitly approves it.
- Prefer a test user, dev/staging environment, or isolated seeded account for mutation testing.

### 2. Research Existing Playwright Coverage

- Inspect Playwright config, auth/setup projects, fixtures, constants, selectors, test directories, skipped tests, retries, and viewport/device projects.
- Summarize:
  - Number and shape of specs/tests.
  - Major workflows covered well.
  - Skipped/flaky/TODO coverage.
  - Viewports and browser projects used.
  - Mutating tests and their cleanup strategy.
  - Areas where tests assert presence instead of behavior.
- Use existing test helpers/selectors when exploring the app. They reveal intended flows and stable hooks.

### 3. Choose Browser Tools

- Use the user's requested browser/tool when specified.
- Use a real profile browser when the task depends on existing cookies, SSO, extensions, or a logged-in session.
- Use Playwright automation when exact viewport sizing, repeatable navigation, screenshots, console logs, traces, or route timing are needed.
- Do not let automation hide human observations. Screenshots, visible text, layout, latency, scrollability, and affordance clarity matter.

### 4. Explore Like A Human

Cover at least these dimensions unless the user narrows scope:

- **Navigation:** direct URLs and visible click paths.
- **Responsive behavior:** supported breakpoints, plus boundary widths where layout changes.
- **Visual/layout quality:** cutoff text, overlap, offscreen controls, accidental horizontal scroll, empty space, awkward density, hidden stale content.
- **Load states:** blanks, skeletons, spinners, `Loading...`, `Connecting...`, delayed hydration, and whether delays exceed a human-acceptable threshold.
- **Behavior correctness:** sorting, filtering, saving, deleting, disabled states, permissions, tab persistence, URL canonicalization.
- **Accessibility/testability:** hidden or off-canvas content exposed to accessibility/text locators, duplicate inactive route content, zero-sized interactive elements.
- **Console/network health:** errors, missing assets, failed requests, noisy expected errors that could bury real failures.
- **Data hygiene:** repeated test artifacts, stale seeded content, polluted shared accounts.

## Mutation Discipline

Exploratory QA should exercise mutable workflows when the environment is safe.

- Prefer high-value user workflows: create/edit/delete records, lists, boards, tags, notes, comments, scenarios, uploads, messages, settings, invitations, or assignments.
- Use unique names with a clear prefix such as `qa-`, `pw-`, or `codex-`.
- Before mutating, identify the cleanup path. After mutating, make a best effort to clean up through the UI, then verify cleanup.
- If UI cleanup is unavailable, file that as a product/test gap (a finding — see below). Use documented API cleanup only if appropriate for the project and account.
- Record all mutations performed, cleanup attempts, and residue left behind.
- Avoid destructive bulk actions unless the user explicitly asks or the test account is clearly disposable.

## Breakpoint Strategy

- Discover breakpoints from the codebase, design tokens, CSS, docs, or Playwright constants when possible.
- Test each named breakpoint and the boundary on both sides of important cutoffs.
- If breakpoints are unknown, use a practical baseline: phone, tablet/narrow, desktop, and any app-specific cutoff discovered during research.
- For each breakpoint, assert both user-visible behavior and automation-relevant state:
  - Expected shell/navigation variant.
  - Route-specific loaded content.
  - Critical controls visible and reachable.
  - No unintended document-level horizontal overflow.
  - Intentional scroll containers remain usable.
  - Hidden/off-canvas UI is not exposed as active content.

## Load-State Strategy

Measure perceived latency, not just eventual success.

- Track time to shell, time to meaningful route content, and time spent in blank/loading/spinner/connecting states.
- Note when a page is technically interactive but still visually incomplete.
- Treat long waits without clear progress, error, retry, or cancellation as bugs or test gaps.
- Do not overfit exact milliseconds unless the project has defined budgets. Use practical labels such as noticeable, slow, or unacceptable and include observed durations when available.

## Filing findings as tracked work

This skill does **not** write a report file. Every finding becomes a **leaf work item** created via `lisa:tracker-write` (the vendor-neutral writer — it dispatches to the configured tracker and runs the validation gate; never call a vendor `*-write-*` skill directly). Map each finding to a type and a build-ready state:

| Finding | `issue_type` | `build_ready` |
|---------|--------------|---------------|
| User-visible **bug** | `Bug` | the `ready` flag (default `false`) |
| **Usability / UX issue** (suggestion) | `Improvement` | the `ready` flag (default `false`) |
| **Missing Playwright test** (coverage gap) | `Task` | **`true` (always)** |

Each finding is a flat leaf (no children), so `build_ready` applies directly. Pass it explicitly on every create — `build_ready: <ready flag>` for bugs and suggestions, `build_ready: true` for missing tests.

Each ticket MUST be a complete spec (`lisa:tracker-write` runs the validator and rejects thin tickets):

- **Three-audience description** (context / business value, technical approach, stakeholder impact).
- **For a bug:** exact reproduction steps, observed-vs-expected, the env / account / breakpoint it occurred at, and console/network evidence.
- **For a usability issue:** the observed friction, who it affects, and the proposed improvement.
- **For a missing test:** the user behavior the test must assert and the stable selector/flow to use — concrete and automatable.
- **Gherkin acceptance criteria** describing the fixed (bug / usability) or added (test) behavior.

### Idempotency — don't spam duplicates

Re-running a QA pass must not refile the same finding. Before creating a ticket, search the tracker for an **open** ticket carrying a stable marker `[lisa-exploratory-qa] <finding-key>` in its body (the `<finding-key>` is a stable slug of surface + symptom, e.g. `settings-modal/horizontal-overflow@tablet`). If one exists, reference/update it instead of creating a duplicate; only create when none exists. **Match by the marker, never by title** (titles get edited). A *closed* prior ticket does not suppress a new one — a recurrence after a fix is a genuine regression.

## Output

No report file. Emit a concise in-session summary:

- **Scope:** target URL/env, browser/tool, account type, build/version if visible, date.
- **Existing Playwright coverage:** strengths and thin areas observed during research.
- **Findings filed**, bucketed by type — bugs, usability suggestions, missing tests — each with its **created or referenced ticket ref** and its **build-ready state** (`ready` vs `triage/backlog`).
- **Observed but not filed:** anything noticed but intentionally not ticketed, with why.

## Quality Bar

- Be honest about what was and was not tested.
- Distinguish user-visible bugs from missing automated coverage — they map to different issue types (`Bug` vs `Task`).
- Prefer concrete, reproducible findings. Every ticket must stand alone for an implementer who was not in the session.
- Do not claim cleanup succeeded unless verified.
- Do not let broad locators pass against hidden/inactive content.
- File missing-test tickets build-ready; file bug and usability tickets per the `ready` flag (default: backlog for human triage).
- Preserve unrelated repo changes.

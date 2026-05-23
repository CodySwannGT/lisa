---
name: exploratory-qa
description: Playwright-backed exploratory QA workflow for web apps. Use when asked to audit an app or project with Playwright/e2e tests, find human-noticeable bugs, identify gaps in automated test coverage, test responsive breakpoints, observe slow or unclear load states, exercise mutable workflows with cleanup, or produce a QA gaps report.
---

# Exploratory QA

## Overview

Run a human-style exploratory QA pass informed by the existing Playwright suite. The goal is to find issues users notice and machines often miss, then translate those observations into actionable Playwright coverage gaps.

## Core Workflow

### 1. Establish Scope

- Identify the target environment, account type, browser requirement, and requested report path.
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
- If UI cleanup is unavailable, record that as a product/test gap. Use documented API cleanup only if appropriate for the project and account.
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

## Report Structure

Write the report to the user's requested path. If none is specified, use a clear local name such as `PLAYWRIGHT_GAPS.md` or `EXPLORATORY_QA_REPORT.md`.

Include:

- Scope: target URL/env, browser/tool, account type, build/version if visible, date.
- Existing Playwright coverage: strengths, thin areas, skipped tests, viewport/browser matrix, mutation coverage.
- Exploratory findings: steps, observed behavior, impact, why existing tests miss it, recommended test.
- Breakpoint findings: exact viewports tested and boundary behavior.
- Load-state findings: observed delays, blank/spinner/connecting states, suggested budgets/tests.
- Mutation findings: data created, behavior observed, cleanup attempt, cleanup result, residue.
- Missing Playwright tests to add: prioritized, concrete, and automatable.
- Maintenance notes: selector scoping, fixture cleanup, flaky/stale-state risks.

## Quality Bar

- Be honest about what was and was not tested.
- Distinguish user-visible bugs from missing automated coverage.
- Prefer concrete examples over vague recommendations.
- Do not claim cleanup succeeded unless verified.
- Do not let broad locators pass against hidden/inactive content.
- Preserve unrelated repo changes and keep report edits scoped.

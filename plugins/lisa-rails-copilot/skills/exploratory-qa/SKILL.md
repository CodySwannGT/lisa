---
name: exploratory-qa
description: First-time-user exploratory QA walkthrough for web apps that FEEDS THE LIFECYCLE. Use when asked to experience an app the way a brand-new human user would — landing cold on the home page and clicking through to find anything confusing, broken, or hard to understand (human-facing jargon, contextless extracted data, machine-style labels, slow or unclear loads, late meaningful content, cramped or cut-off UI, inconsistent/non-standard UX, awkward scroll behavior, unclear affordances, dead-end flows that strand a user — e.g. a login page with no way to register or recover a password) across all breakpoints. Instead of writing a report file, it files every finding as a tracked work item via lisa:tracker-write (bugs and usability/UX issues). A `ready` parameter controls whether those tickets are created build-ready (auto-picked-up by lisa:intake) or left in the backlog for human triage (default). For gaps in the automated Playwright test suite, use the e2e-coverage-gaps skill instead.
---

# Exploratory QA

## Overview

Experience the app the way a **brand-new human user** would: land cold on the home page with no prior
knowledge, then click through and actually try to use it — just like a real person. The goal is to
surface anything **confusing, broken, or hard to understand**, and to do so at **every breakpoint**.

This is a usability/experience pass, **not** a test-coverage audit. It does not look at the Playwright
suite or hunt for coverage gaps — for that, use the `e2e-coverage-gaps` skill. Here, every finding is
filed as a tracked work item so it enters the Lisa lifecycle — no static report file.

## Parameters

- **`target-url | env`** (first positional) — what to explore.
- **`ready=true|false`** — the build-ready state for the tickets this pass creates.
  - `ready=true` → created build-ready, so `lisa:intake` / the build-intake scanner auto-picks them up.
  - `ready=false` (**default**) → created in the backlog (not build-ready) for a human to review and
    promote into the queue.

## Core Workflow

### 1. Establish Scope

- Identify the target environment, account type, and browser requirement, and read the `ready` flag
  (default `false`).
- **Confirm the tracker is configured.** Findings are filed as tickets, so read `tracker` from
  `.lisa.config.json` (local overrides global). If it is unset, stop and report that the tracker must
  be configured (via `/lisa:setup:jira` / `:github` / `:linear`) before exploratory QA can file
  findings — do not silently fall back to a report file.
- If credentials, tenant, or seed data are missing and cannot be discovered safely, ask one concise
  clarifying question.
- Treat production-like environments conservatively. Do not mutate production data unless the user
  explicitly approves it. Prefer a test user, dev/staging environment, or isolated seeded account.

### 2. Arrive Cold

- Start at the home/landing page with **no prior knowledge of the app**. Do **not** pre-read the
  codebase to learn the intended flows — discover them the way a user would, by looking and clicking.
- Form a first impression: is it obvious what this app is, what to do first, and where to go next?

### 3. Use It Like a Human

Click through the visible paths and actually attempt real tasks — a first-time user explores, makes
mistakes, and tries the obvious thing. Cover at least these dimensions unless the user narrows scope:

- **Comprehension & labeling:** human-facing copy must sound like something a normal first-time user
  would understand. Flag machine-style or developer labels shown to users (raw IDs, enum keys,
  `snake_case`, `null`/`undefined`, untranslated i18n keys), admin/database terms such as
  "metadata", implementation identifiers such as slugs, unexplained domain jargon, unclear
  button/menu names, and icons with no discernible meaning. If a heading, label, or field would make a
  non-technical user ask "what does that mean?", file a usability/clarity ticket with plainer wording.
- **Data usefulness & context:** extracted facts, metrics, summaries, and structured tables must help
  a person understand the surface. Flag machine residue that only proves extraction happened, such as
  repeated generic fields (`Money Mention`, `Entity`, `Record`) paired with values but no sentence,
  source, category, or explanation of why the value matters. If a user cannot tell what a number,
  fact, or field refers to without rereading the raw source, file a usability/clarity ticket to hide it
  from the default UI or add context such as excerpts, labels, grouping, or provenance.
- **Navigation clarity:** is it obvious how to get somewhere and back? Dead ends, hidden entry points,
  surprising redirects, broken links, no clear "home".
- **Flow completeness & expected counterparts:** a screen that gates access or shows one side of a
  standard paired flow must offer the other side — or a clear path to it. A brand-new user must never
  hit a dead end with no next step. Flag missing companion actions, especially on auth and entry
  screens:
  - **Sign-in with no sign-up:** a login page with no "Create account" / "Register" link strands
    anyone who does not already have an account; likewise a registration page with no link back to
    sign in.
  - **No account recovery:** login with no "Forgot password?", no way to reset, and no way to resend a
    verification email.
  - **No exit from a state:** a signed-in app with no visible sign-out, or a modal / wizard / detail
    view with no back, close, or cancel.
  - **One-way actions:** create/add with no matching edit or delete (or the reverse) where a user
    would reasonably expect both.
  - **Unreachable entry points:** a feature only reachable by guessing a URL, or an empty state with
    no primary action to populate it.
  When the missing counterpart makes a core task impossible for a whole class of users (e.g. a new
  user literally cannot create an account), file a `Bug`; otherwise file a usability `Improvement`.
- **Visual/layout quality:** cut-off or truncated text, overlap, cramped/crowded density, offscreen or
  unreachable controls, accidental horizontal scroll, awkward empty space. **Do not judge this by
  eyeballing a screenshot alone** — a control clipped by a few pixels or pushed just past a container
  edge looks fine in a thumbnail. Confirm it with the programmatic layout-integrity sweep in §5 at
  every width.
- **Consistency / standard UX:** components, spacing, button styles, terminology, and interaction
  patterns should be consistent across the app and follow common conventions. Flag anything
  non-standard or that differs screen-to-screen.
- **Load & responsiveness:** long or unclear load times, blank screens, skeleton-only shells, spinners
  / `Loading...` / `Connecting...` with no progress, anything that feels slow or janky. Flag pages
  where the browser reports `loaded` / `complete` but meaningful content arrives much later, or where
  the visible shell appears quickly while the real task content remains missing. Capture user-perceived
  timings: shell visible, first meaningful content, and stable/complete content. If the delay is
  noticeable, file a usability/performance ticket even if the eventual content is correct.
- **Scroll behavior:** unexpected scroll position, scroll jumps, nested or locked scroll, sticky
  elements that cover content, content that cannot be reached.
- **Behavior correctness:** does the obvious action do what a user expects? Confusing errors, silent
  failures, disabled controls with no explanation, state that does not persist.
- **Affordance clarity:** can the user tell what is clickable, required, in-progress, or complete?

### 4. Cover All Breakpoints

- Discover breakpoints from the app (design tokens, CSS, responsive layout changes) when possible; if
  unknown, use a practical baseline: phone, tablet/narrow, desktop, plus any app-specific cutoff.
- **Do not test only the named breakpoints.** Clipping and overflow most often appear at the
  *in-between* widths — where a row can no longer fit its contents but has not yet collapsed to the
  next layout. Sweep a range of widths (e.g. 360, 390, 414, 600, 768, 834, 1024, 1280, 1440) plus a
  few intermediate steps (e.g. ~900–1180) and re-check the key paths at each.
- At each width, walk the key paths again and confirm the experience holds: expected
  shell/navigation variant, critical controls visible and reachable, no unintended horizontal
  overflow, intentional scroll containers still usable, nothing cut off or crowded.

### 5. Run Layout-Integrity Checks — Don't Eyeball Alone

A screenshot glance misses controls clipped by a few pixels or pushed just past a container edge. At
**every width**, in addition to looking, take DOM measurements via the browser automation tool
(Playwright, Chrome MCP, etc.) and treat any of these as a finding:

- **Document / container overflow:** `document.documentElement.scrollWidth > clientWidth`, or a
  horizontal scrollbar on a container that should not scroll → accidental horizontal overflow.
- **Clipped or offscreen controls:** for every interactive control (buttons, links, inputs, selects,
  menu items), compare its `getBoundingClientRect()` against the viewport and against each ancestor
  that has `overflow: hidden | clip | auto | scroll`. If any edge of the control falls outside those
  bounds, it is partially or fully clipped / unreachable — even when the page looks fine in a thumbnail.
  This is exactly the case that gets missed: a submit/apply button whose right edge is cut off by its
  filter card.
- **Truncated meaningful text:** an element whose `scrollWidth > clientWidth` (or that renders an
  ellipsis) where the hidden text carries meaning — e.g. a select showing "Any CRD state" jammed into
  its chevron, a label cut mid-word.
- **Colliding controls:** a label or value overlapping an adjacent control (icon, chevron, button)
  with no gap between them.

Record which width(s) trigger each, the offending element, and a screenshot. **A primary or
interactive control that is clipped, offscreen, or unreachable is a `Bug`, not merely an
Improvement** — a user literally cannot see or click all of it.

### 6. Watch Load & Latency

- Measure separate milestones: visible app shell, `document.readyState`, first meaningful
  route-specific content, and visually stable/full route content.
- Do not treat a visible shell, completed document, or technically clickable page as loaded if the
  route is still blank, skeleton-only, placeholder-only, or waiting for primary data.
- Treat skeleton-only/placeholder-only screens as loading states. If they persist for a noticeable
  delay, they need clear progress/loading messaging that explains what is happening.
- Treat long waits to meaningful content or stable/full content without clear progress, error, retry,
  or cancellation as findings. Use practical labels (noticeable, slow, unacceptable) and include
  observed durations when available.

## Mutation Discipline

A real first-time user creates, edits, and deletes things — exercise those flows when the environment
is safe.

- Use unique names with a clear prefix such as `qa-` or `codex-`.
- Before mutating, identify the cleanup path. After mutating, make a best effort to clean up through
  the UI, then verify cleanup. If UI cleanup is unavailable, that itself is a usability finding.
- Avoid destructive bulk actions unless the user explicitly asks or the account is clearly disposable.
- Record all mutations performed, cleanup attempts, and any residue left behind.

## Filing findings as tracked work

This skill does **not** write a report file. Every finding becomes a **leaf work item** created via
`lisa:tracker-write` (the vendor-neutral writer — it dispatches to the configured tracker and runs the
validation gate; never call a vendor `*-write-*` skill directly). Map each finding to a type:

| Finding | `issue_type` | `build_ready` |
|---------|--------------|---------------|
| User-visible **bug** (broken behavior) | `Bug` | the `ready` flag (default `false`) |
| **Usability / UX / clarity issue** | `Improvement` | the `ready` flag (default `false`) |

A control that is **clipped, offscreen, or otherwise unreachable** (per §5) counts as broken behavior
→ file it as a `Bug`, not an `Improvement`. Pure crowding/clarity with the control still fully usable
is an `Improvement`.

Each finding is a flat leaf (no children), so `build_ready` applies directly — pass it explicitly on
every create. Each ticket MUST be a complete spec (the validator rejects thin tickets):

- **Three-audience description** (context / business value, technical approach, stakeholder impact).
- **For a bug:** exact reproduction steps, observed-vs-expected, the env / account / breakpoint it
  occurred at, and console/network evidence.
- **For a usability issue:** the observed friction (what was confusing, cramped, inconsistent, or hard
  to understand), who it affects, **where** (route + breakpoint), and the proposed improvement.
- **Gherkin acceptance criteria** describing the fixed behavior.

### Idempotency — don't spam duplicates

Re-running a pass must not refile the same finding. Before creating a ticket, search the tracker for an
**open** ticket carrying a stable marker `[lisa-exploratory-qa] <finding-key>` in its body (the
`<finding-key>` is a stable slug of surface + symptom, e.g. `settings-modal/horizontal-overflow@tablet`).
If one exists, reference/update it instead of creating a duplicate; only create when none exists.
**Match by the marker, never by title** (titles get edited). A *closed* prior ticket does not suppress a
new one — a recurrence after a fix is a genuine regression.

## Output

No report file. Emit a concise in-session summary:

- **Scope:** target URL/env, browser/tool, account type, build/version if visible, date.
- **First impression:** could a new user tell what the app is and what to do first?
- **Findings filed**, bucketed by type — bugs, usability/clarity issues — each with its **created or
  referenced ticket ref** and its **build-ready state** (`ready` vs `triage/backlog`).
- **Observed but not filed:** anything noticed but intentionally not ticketed, with why.

## Quality Bar

- Explore as a true first-time user — judge clarity, not whether you (who can read the code) can figure
  it out.
- Prefer concrete, reproducible findings. Every ticket must stand alone for an implementer who was not
  in the session.
- Do not claim cleanup succeeded unless verified.
- File tickets per the `ready` flag (default: backlog for human triage).
- This skill is about the human experience only — route automated-coverage gaps to `e2e-coverage-gaps`.
- Preserve unrelated repo changes.

---
name: lisa-qa-checklist
description: "Serve the current manual…"
allowed-tools: ["Bash", "Read", "Glob", "Grep", "Write", "Edit"]
---

# QA Checklist: $ARGUMENTS

The manual regression sweep exists to catch what automation does not. Its checklist must
therefore be computed, not remembered: curated journeys minus automated coverage, at the
moment the tester asks.

## Sources

1. **Curated journey list** — `qa.checklistFile` in `.lisa.config.json`, default
   `.lisa/qa-checklist.md`. Format: one `## Journey: <name>` section per user journey,
   with plain-language steps and an optional `automation:` line naming the covering spec
   file(s) once one exists. If the file does not exist, offer to bootstrap it: derive
   candidate journeys from the app's route map and the existing E2E suites' describe
   blocks, write the draft, and ask the operator to curate it once. Never invent
   journeys silently.
2. **Automated coverage** — scan the repo's E2E suites (Playwright specs, Maestro flows;
   locate via the project's e2e/test directories). An `automation:` line must name BOTH
   the spec file and the specific test within it (the Playwright `describe`/`test` title
   or Maestro flow name): `automation: <spec-path> :: <test-or-flow-name>`. A journey
   counts as covered only when that spec file exists, the named test/flow is present in
   it, and it is not skipped (`test.skip`, commented-out flow, or excluded from CI). A
   file-only line, a named test that no longer matches, or any ambiguous mapping is
   treated as **uncovered** — a live filename proves nothing about what the spec
   exercises. A deleted, renamed, or skipped test silently un-covers its journey — the
   very regression this check exists to catch; call it out loudly.

## Serving the sweep

Present two lists, human-first:

```text
## Manual sweep — <n> journeys need your eyes
1. <Journey name> — <plain-language steps>
   Why manual: <no automation | automation skipped/stale: <spec>>
...

## Covered by automation — <n> journeys (skim, don't re-test)
- <Journey name> — <spec file> (<playwright|maestro>)
```

Rules for the served text: steps an intern can follow, no spec-file jargon in the manual
section beyond the "why manual" line, and stable journey ordering (file order) so testers
can resume mid-sweep.

## Maintaining the list

- Tester or operator adds/edits journeys in plain language → edit the checklist file
  (this skill may apply the edit on request; it is a repo file, so changes ride normal
  review).
- When a journey gains automation (e.g. `lisa-codify-verification` lands a spec), add its
  `automation: <spec-path> :: <test-or-flow-name>` line — on request this skill locates
  the covering spec and test, confirms the named test actually drives the journey's
  steps, and writes the line itself.
- Never maintain per-tester copies; the file is the single source of truth and the
  computed view is always derived fresh.

## Rules

- Coverage claims must point at an existing, non-skipped spec — "there's a test somewhere"
  does not count.
- Serving is read-only by default; file edits happen only on explicit request.
- If the automated-coverage scan finds specs exercising a journey that is missing from
  the curated list entirely, surface it as a suggested addition — the human curates, the
  skill proposes.

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
   locate via the project's e2e/test directories). A journey counts as covered only when
   its `automation:` line names a spec file that exists, is not skipped
   (`test.skip`, commented-out flow, or excluded from CI), AND contains a
   `describe`/`test` block whose title or steps recognizably map to the journey — the
   file existing is not sufficient; it must actually exercise the journey it claims to
   cover. A deleted, skipped, or semantically mismatched spec silently un-covers its
   journey — that is exactly the regression this check exists to catch; call it out
   loudly. When the file-to-journey mapping is ambiguous (no block clearly matches, or
   more than one plausibly does), treat the journey as uncovered and flag the ambiguity
   for operator review rather than guessing.

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
  `automation:` line — on request this skill locates the covering spec and writes the
  line itself.
- Never maintain per-tester copies; the file is the single source of truth and the
  computed view is always derived fresh.

## Rules

- Coverage claims must point at an existing, non-skipped spec — "there's a test somewhere"
  does not count.
- Serving is read-only by default; file edits happen only on explicit request.
- If the automated-coverage scan finds specs exercising a journey that is missing from
  the curated list entirely, surface it as a suggested addition — the human curates, the
  skill proposes.

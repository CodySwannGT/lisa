---
name: lisa-reproduce-bug
description: "How to reproduce a bug reliably and on the real path — choosing a reproduction method from the symptom, distinguishing prerequisites from behaviour-substituting scaffolding, and reporting the observed failure rate instead of rounding it."
---

# Reproduce Bug

A bug that cannot be reproduced cannot be verified as fixed. Root cause analysis does not begin until a reliable reproduction exists.

## The reproduction must exercise the real path

Left alone, an agent asked to demonstrate a defect will build the environment in which the defect appears — a stub, a fake, a fresh harness — and present that as the reproduction. It looks like proof and it is not: a fix that satisfies it may never touch the path the user is on.

Two kinds of setup get confused here, and only one is a problem:

- **Prerequisites** — state the real path genuinely needs: a seeded record, a logged-in user, a feature flag, a fixture recreating production-equivalent data. These are part of the reproduction. Removing them changes the precondition rather than testing anything, so do not remove them.
- **Replacement scaffolding** — anything standing in for behaviour the real path would perform: a mocked service, a stubbed function, a fake clock, a bespoke harness that bypasses the normal entry point. This is what makes a reproduction suspect.

So the reproduction states, explicitly:

- **The entry point the user actually hits** — the route, endpoint, command, or interaction.
- **Prerequisites**, listed as setup.
- **Replacement scaffolding**, each item with the real behaviour it substitutes.
- **Whether the failure survives with prerequisites in place and replacement scaffolding removed.** If it does not, this is a lead rather than a reproduction. Say so and keep going.

If the real path is unreachable — no credentials, no environment, no data — that is a blocked reproduction. Report the missing access instead of substituting scaffolding and calling the bug reproduced.

## Choose the method from the symptom

| Symptom | Reach for |
| --- | --- |
| Wrong value, bad output, thrown error | Failing test at the narrowest layer that still crosses the real path |
| Broken interface or journey | Browser or device driver against a running build (Playwright, Maestro) |
| Service or API behaviour | Direct request to the running service — client script or `curl` |
| Depends on particular data | Seeded fixture recreating that state, recorded as a prerequisite |
| Intermittent or timing-shaped | Loop the trigger; capture timestamps around async boundaries |
| Works locally, fails deployed | Do not chase it locally — reproduce against the environment that fails |

**A failing test is the preferred form** wherever it can cross the real path: it runs in CI, it becomes the regression guard, and `codify-verification` expects it. A script is the fallback. Manual steps are the last resort and must carry their prerequisites.

## When the work item names an existing test as the reproduction

A work item may hand you the control instead of asking you to build one: *"`<existing test>` pins today's wrong behaviour; it must go red once this is fixed."* Treat that as a reproduction only once it is **reachable** — the `control-reachability` rule holds that a test whose fixture never exercises the changed path stays green for a reason unrelated to the change, so its green is uninterpretable and the item's stopping rule reads as "revert a correct fix".

- **Before trusting it**, check the item for the `[CONTROL: <test-identifier> | reaches: <input-or-field>]` marker gate S20 requires, and confirm the named input is actually in the fixture. A named test with no stated reachability is an unvalidated control, not a reproduction.
- **If it does not move when the change lands**, stop and establish why: the change had no effect (revisit the change), or the fixture never reached the changed path (fix or extend the control). Prove it by execution — a temporary `throw` in the changed block run under that one test, or coverage scoped to that test alone — never by reading the fixture and concluding it looks right.
- **Never revert on an unexplained green.** Report the finding — which method you used and what it showed — the way any other reproduction result is reported.

## Report the failure rate, do not round it

Run the reproduction enough times to state a rate. A reproduction that fails half the time cannot prove a fix — one passing run afterwards means nothing at that rate. If the rate is too low to distinguish a fix from luck, say what would raise it: more iterations, a forced schedule, a narrowed trigger, a seeded clock.

## When it will not reproduce

The difference is nearly always one of: runtime version, configuration or feature flags, data state, credentials and permissions, network posture, or platform. Diff the two environments along those axes rather than guessing between them, and report which axes you compared and what you found. That comparison is the finding when the bug stays hidden.

## Output

```text
## Reproduction

**Entry point:** the route, command, or action the user hits
**Command or steps:** exactly what to run
**Actual:** what happens · **Expected:** what should happen
**Prerequisites:** seeded data, auth state, flags the real path needs — or "none"
**Replacement scaffolding:** each mock, stub, fake, or bespoke harness and the
  real behaviour it substitutes — or "none"
**Survives without replacement scaffolding:** yes / no — if no, this is a lead,
  not a reproduction
**Observed failure rate:** n failures in m runs
**Form:** failing test `path` | script `path` | manual steps above
**Environment:** runtime, platform, relevant dependency versions
```

Capture output whole — a truncated stack trace loses the line that mattered. But evidence carries whatever the system was holding, so **redact secrets, tokens, credentials, and personal data before a reproduction is handed on or attached to a work item**, and keep any unredacted capture only where the data class it contains is already permitted to live.

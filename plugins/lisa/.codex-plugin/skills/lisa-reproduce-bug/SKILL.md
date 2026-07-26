---
name: lisa-reproduce-bug
description: "How to reproduce a bug reliably…"
---

# Reproduce Bug

A bug that cannot be reproduced cannot be verified as fixed. Root cause analysis does not begin until a reliable reproduction exists.

## The reproduction must be on the real path

Left alone, an agent asked to demonstrate a defect will build the environment in which the defect appears — a fixture, a stub, a fresh harness — and present that as the reproduction. It looks like proof and it is not: a fix that satisfies it may never touch the path the user is on.

So the reproduction states, explicitly:

- **The entry point the user actually hits** — the route, endpoint, command, or interaction.
- **Every stand-in introduced** — mock, stub, seeded record, fake clock, new harness — and what real thing each replaces.
- **Whether it still fails without them.** A failure that occurs only inside scaffolding written for the purpose is a lead, not a reproduction. Say so and keep going.

If the real path is unreachable — no credentials, no environment, no data — that is a blocked reproduction. Report the missing access rather than substituting a harness and calling the bug reproduced.

## Choose the method from the symptom

| Symptom | Reach for |
| --- | --- |
| Wrong value, bad output, thrown error | Failing test at the narrowest layer that still crosses the real path |
| Broken interface or journey | Browser or device driver against a running build (Playwright, Maestro) |
| Service or API behaviour | Direct request to the running service — client script or `curl` |
| Depends on particular data | Seeded fixture that recreates the state, recorded as part of the reproduction |
| Intermittent or timing-shaped | Loop the trigger; capture timestamps around async boundaries |
| Works locally, fails deployed | Do not chase it locally — reproduce against the environment that fails |

**A failing test is the preferred form** wherever it can cross the real path: it runs in CI, it becomes the regression guard, and `codify-verification` expects it. A script is the fallback. Manual steps are the last resort and must carry the prerequisite state — logged-in user, seeded data, feature flags.

## Report the rate, do not round it

Run the reproduction enough times to state a rate, and report it as observed — `7/10` — never as "reliable" or "intermittent" on its own. A reproduction that fails half the time cannot prove a fix: one passing run after the change means nothing at that rate. If the rate is too low to distinguish a fix from luck, say what would raise it: more iterations, a forced schedule, a narrowed trigger, a seeded clock.

## When it will not reproduce

The difference is nearly always one of: runtime version, configuration or feature flags, data state, credentials and permissions, network posture, or platform. Diff the two environments along those axes rather than guessing between them — and report which axes you compared and what you found. That comparison is itself the finding when the bug stays hidden.

## Output

```text
## Reproduction

**Entry point:** the route, command, or action the user hits
**Command or steps:** exactly what to run
**Actual:** what happens · **Expected:** what should happen
**Stand-ins:** each mock, stub, seed, or harness and what it replaces — or "none"
**Fails without stand-ins:** yes / no — if no, this is a lead, not a reproduction
**Observed rate:** n/m runs
**Form:** failing test `path` | script `path` | manual steps above
**Environment:** runtime, platform, relevant dependency versions
```

Capture output whole. A truncated stack trace or a summarized error body loses the line that mattered.

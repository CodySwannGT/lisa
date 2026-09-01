---
name: lisa-enforcement-census
description: "Fleet enforcement census. Re-measures how many host checkouts on this machine resolve a Lisa enforcement guard at all, which copy governs each one, its vintage, and whether an apply receipt exists — then reports it. Report-only: it never gates, never files, and never changes a checkout. Keeps 'resolves NO guard' apart from 'resolves something old', because they are different failures with different remedies. Lisa-monorepo only, because the fleet roster is a Lisa-monorepo artifact."
allowed-tools: ["Bash", "Read"]
---

# Lisa enforcement census

Enforcement resolves from **the checkout an agent is working in**, never from npm. The dispatcher
(`scripts/lisa-enforcement-fallback.sh`) tells **this** session about **this** checkout, once per
session, and both of those choices are correct — a stale guard keeps refusing things, and a banner
on every tool call is a banner people learn to skip.

Nobody was looking at the fleet. So the only fleet-wide number that ever existed was taken by hand
and written into a comment, where nothing re-took it (CodySwannGT/lisa#3490). This loop is the
re-measurement.

## What it must keep straight

**Two findings, not one.**

- **A checkout that resolves NO guard is not a stale checkout.** It is an unenforced one. A stale
  guard still refuses things and names its vintage in every refusal; a checkout that resolves
  nothing produces no output at all, so from inside a session "protected by an old policy" and "not
  protected" look identical. This is the serious half and the quiet half, and it goes first in every
  report.
- **A checkout the census could not read is neither.** It has not been shown to be covered and has
  not been shown to be unenforced. Counting it as covered would report better coverage than exists,
  which retires the question instead of answering it.

**It reports; it never gates.** Its exit status is 0 for every finding about the fleet, including a
fleet where every checkout is stale. Reddening someone's build because a colleague's checkout is old
would be a worse control than the one it replaces, and the operator's move would be to route around
it — and a control routed around protects nothing.

## Phase 1 — Run it

```bash
node scripts/lisa-enforcement-census.mjs
```

It reads the fleet roster `.lisa.workspaces.json` — the same machine-local file
`scripts/lisa-update-local.sh` already maintains — and measures every checkout it names.

Useful flags:

| Flag | Why |
|---|---|
| `--scan <dir> [--depth n]` | Discover checkouts under a directory instead of, or as well as, the roster. A hand-maintained roster can go stale the same way the frozen comment did; a checkout nobody added is a checkout nobody measures, and an unmeasured checkout is not a covered one. |
| `--redact` | Replace every real path with a stable derived label. **Required before quoting the census anywhere public** — the roster names real local checkouts, and those paths embed client and product names. The counts and rows survive redaction intact. |
| `--json` | The measured fleet, for a script. |
| `--reference <ver>` | Compare against a stated version instead of the newest Lisa found on this disk. |

Nothing here writes, installs, or repairs anything. If a checkout needs `npx @codyswann/lisa apply`,
the report says so and a human runs it.

## Phase 2 — Read the classes

Four resolution classes partition the roster and sum to its size:

- **NOT ENFORCING** — resolves no guard at all.
- **COULD NOT LOOK** — the census could not read it.
- **ENFORCING (partly)** — some guards resolve, some do not.
- **ENFORCING** — all six resolve.

Within the enforcing ones only, three vintage classes: **behind**, **vintage unknown**, **current**.
An unguarded checkout never appears in any of them — it has no copy to be old.

"Behind the newest Lisa on this disk" is the **default** state of a checkout minutes after it is
cut, so a fleet where most checkouts are behind is not news. A fleet where checkouts resolve
**nothing** is.

## Phase 3 — Report the outcome

Per the `automation-runbook-contract`, end with exactly one outcome and a one-line summary an
operator can act on:

- **`nothing-needed`** — every checkout on the roster resolves guards and none is unenforced.
  `nothing-needed — every checkout on the roster enforces; N behind, which is the normal state.`
- **`candidate-proposed`** — one or more checkouts resolve no guard, or could not be read. Name the
  count and the one command that repairs it. Do **not** file tickets: these are other people's
  working copies, not tracked work, and a loop that files a ticket per stale checkout every night
  is a loop everyone learns to ignore.
  `candidate-proposed — N of M checkouts resolve no guard at all; each needs ‘npx @codyswann/lisa apply’.`
- **`recovery-required`** — the census itself could not run: no roster, an unreadable roster, or a
  missing `dist/`. That is the machinery being broken, not a finding about the fleet.
  `recovery-required — no fleet roster on this machine, so nothing was measured.`

`change-proved` and `approval-requested` cannot occur: the loop changes nothing and crosses no
boundary. `policy-obsolete` applies only if enforcement stops resolving from the checkout at all,
which would retire this loop with the mechanism it measures.

**Never report a count the run did not take.** If the census did not run, the outcome is
`recovery-required` and the fleet's state is unknown — quoting the last number anyone remembers is
the exact defect this loop exists to end.

## The local half

`lisa doctor` carries the same finding for the single checkout it runs in, including installed
versus declared Lisa. That is the half a host project gets; this census is the half only the machine
holding the fleet roster can produce.

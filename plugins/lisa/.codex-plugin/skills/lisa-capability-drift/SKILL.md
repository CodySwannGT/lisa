---
name: lisa-capability-drift
description: "Detect the fleet getting worse…"
allowed-tools: ["Read", "Grep", "Glob", "Bash"]
---

# Capability Drift

Qualification fires when you change something. This exists because capability also moves when you change nothing.

## What moves underneath you

- A vendor reroutes what a pinned name resolves to, or alters the served model behind it.
- Instruction surfaces accumulate — a rule here, a skill there — until they contradict each other and the model spends its budget reconciling them instead of working.
- Tool behaviour shifts under the same interface.
- The work itself changes shape, so yesterday's competence is aimed at a problem that has moved.

None of these produce an event you can subscribe to. They produce a slow decline that looks like ordinary bad luck, one task at a time, until somebody finally compares against a year ago and cannot explain the gap.

## Record a baseline worth comparing to

A baseline is the recorded distribution of suite outcomes for a stated configuration at a stated time — not a single score. Store the configuration completely enough to reproduce it: model, reasoning or effort level, tool set, context assembly, and the suite's own review date.

Re-baseline deliberately, after a qualified change, and never silently. A baseline quietly overwritten each run cannot detect anything, because the thing you are comparing against has been moving with you the whole time.

## Sample on a cadence

Declare an interval and hold it. Sampling only when something feels wrong means you find out about decline through the incident it caused, which is exactly the situation this is meant to prevent.

Each sample runs the suite against the deployed configuration and compares to the baseline distribution — not to the previous sample, which turns a trend into a series of individually unremarkable steps.

## Deciding whether a decline is real

Run-to-run variance is large enough that a lower number usually means nothing. Treat a decline as a finding only when the sampled distribution is distinguishable from the baseline by the spread statistic the suite declares — the same bar a qualification has to clear.

A borderline reading is not a finding and not an all-clear. It is a reason to take more samples, and saying so is the honest report.

## Attribute it before acting

A confirmed decline has three candidate causes, and the remedy differs completely:

| Candidate | How to separate it |
| --- | --- |
| **Vendor-side change** | Re-run the baseline configuration explicitly pinned. If it now scores like the sample rather than like the baseline, what the pin resolves to has changed underneath you |
| **Accumulated local change** | Diff the instruction surfaces, tool set and context assembly against the baseline's recorded configuration. Look for additions nobody qualified, and for rules that now contradict |
| **Broken harness** | Check whether failures are the work being wrong or the run being unable to proceed — missing install, absent credential, changed path. A harness failure reads as incapability and is not one |

Do not skip this. "The model got worse" is the most expensive conclusion available, and it is wrong most of the time.

## Report and route

A confirmed decline enters intake as build-ready work like any other finding, carrying the attribution. An unattributed decline is still worth filing — with the attribution work named as the first task, so nobody re-runs the analysis from scratch.

## Output

```text
## Capability Drift

**Baseline:** date · configuration (model · effort · tools · context) · suite review date
**Sample:** date · same fields, with every difference from the baseline marked
**Cadence:** declared interval, and whether this sample was on schedule

### Comparison
| Task class | Baseline distribution | Sampled distribution | Distinguishable? |
|---|---|---|---|

**Verdict:** stable | declined | inconclusive — take n more samples
**Attribution (declines only):** vendor-side | accumulated local | broken harness — with the
  evidence that separated it from the other two
**Filed:** work item, or the reason nothing was filed
```

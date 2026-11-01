---
name: lisa-delivery-effectiveness
description: "Measure whether the work the factory delivers was worth shipping — gate rejection, rework, escape, first-pass yield, cost per delivered item and planning-miss rate — so autonomy rate cannot stand alone as a success measure."
allowed-tools: ["Read", "Grep", "Glob", "Bash"]
---

# Delivery Effectiveness

Autonomy rate answers how much ran without a human. It says nothing about whether any of it should have shipped, and on its own it rewards exactly the wrong thing: a factory that produces rejected work faster scores better.

## The six measures

Each needs a stated numerator, denominator and window, or it is a number-shaped opinion.

| Measure | Counts | Reads as |
| --- | --- | --- |
| **Gate rejection rate** | Work the pipeline refused, over work submitted | How much effort is spent producing output the standards reject |
| **Rework rate** | Items reopened or returned after being declared complete, over items completed | How often "done" was not done |
| **Escape rate** | Defects reaching production, over items released | What the gates did not catch |
| **First-pass yield** | Items reaching terminal state with no rework, over items started | The one number that moves only when the whole line works |
| **Cost per delivered item** | Metered spend, over items reaching terminal state | What a unit of accepted output actually costs |
| **Planning-miss rate** | Items carrying a `[lisa-planning-miss]` note, over items dispatched (entered the claimed role) | How often planning let through work a worker could not finish without a human |

First-pass yield is the summary measure worth watching, because every other failure shows up in it. The other five exist to tell you *where* it went.

The planning-miss rate is the one that points upstream of the build. Its numerator is the `[lisa-planning-miss]` note `lisa-persist-learning` leaves on an item when `learning-judge` confirms that a dispatched worker had to stop for a human, or file a new ticket mid-build, because planning let a gap through. Count distinct items, not notes. The note is posted only on a confirmed miss, so outages, expired credentials, flaky tools and decisions planning flagged as human gates are already out of it. Both halves come from the tracker. Each persisted miss also becomes a planning check that PRD intake, decomposition and the ready gate read back, so better planning shows up as this number falling.

## Where the numbers come from

Prefer the systems of record over anything self-reported: the tracker for state transitions and reopenings, CI history for gate rejections, the release record for escapes, the billing or gateway boundary for spend. An agent's account of its own rework rate is the least reliable source available and the easiest one to reach for.

Say which source each measure came from. Two measures drawn from different systems with different definitions of "complete" cannot be compared, and that mismatch is invisible in the result.

## Set targets that can only tighten

Targets are yours to declare — this says nothing about what a good rejection rate is, because that depends on the standards being enforced and the work being attempted. But declare them, disclose them, and let them move in one direction only. A target quietly loosened to match the current number is a redefinition dressed as an improvement.

## Read it against autonomy, never instead of it

Report both, together, always. The pairing is the point:

- **High autonomy, high first-pass yield** — the thing everyone is aiming for.
- **High autonomy, low first-pass yield** — an unattended process producing work its own gates reject. Reporting autonomy alone would conceal exactly this, which is why the pairing is not optional.
- **Low autonomy, high first-pass yield** — humans are carrying the quality. Honest, and expensive.
- **Low autonomy, low first-pass yield** — the machinery is not the problem yet.

## Output

```text
## Delivery Effectiveness

**Window:** dates · **Autonomy rate over the same window:** %

| Measure | Value | Numerator / denominator | Source of record | Target | Trend |
|---|---|---|---|---|---|
| Gate rejection rate | | | | | |
| Rework rate | | | | | |
| Escape rate | | | | | |
| First-pass yield | | | | | |
| Cost per delivered item | | | | | |
| Planning-miss rate | | | | | |

**Reading:** which of the four autonomy/yield quadrants this window sits in
**Uncollected:** any measure not gathered, and why — never an estimate in its place
**Filed:** work items raised for measures outside target
```

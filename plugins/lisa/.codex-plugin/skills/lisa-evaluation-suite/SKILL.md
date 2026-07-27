---
name: lisa-evaluation-suite
description: "Build and maintain the entity's…"
allowed-tools: ["Read", "Grep", "Glob", "Bash"]
---

# Evaluation Suite

Public leaderboards measure somebody else's work mix. The suite that decides what runs in your factory is assembled from your own.

## Draw the tasks from real work

A task earns a place by having happened. Pull candidates from closed work items, past incidents, escaped defects, and the reviews that caught something — anywhere the outcome is already known and was consequential.

Include, deliberately, the work your current setup handles **badly**. A suite made only of tasks that already pass measures nothing: every candidate scores full marks and the result cannot separate them. Difficulty is what carries information, so keep the tasks that embarrass the fleet and record what "good" would have looked like.

Each task records: what is asked, what counts as success and how that is judged, where the task came from, and the outcome class it exercises. Without the judging rule written down, two runs of the same task are not comparable.

## Keep it resembling the work

Representativeness expires. Review it on a declared cadence and re-establish it whenever the work mix moves — a new stack, a new surface, a shift from features to migrations. A suite that has drifted from the work stops being evidence about the work while continuing to produce confident numbers, which is the worst failure mode available to an instrument.

State the review date alongside every result. A reader has to be able to see how old the instrument is.

## Contamination is the failure that hides

The tasks and their expected outcomes MUST be unreachable by the agents under evaluation. That means not in instruction files, not in skills, not in retrievable context, not in a wiki the agents read, and not in feedback or transcripts submitted to a model vendor.

An agent optimising against a suite it can see produces a score rather than a measurement, and nothing in the number reveals which one you have. Treat any suspected exposure as fatal to the affected tasks: retire them, record why, and replace them from real work. Where exposure cannot be ruled out for the whole suite, say so — a compromised instrument reported honestly still tells you something; one reported as clean does not.

## Check that it discriminates

Before trusting a comparison, look at the spread of results across candidates:

| What you see | What it means |
| --- | --- |
| Nearly every task passes for every candidate | Saturated. It cannot rank anything; add harder tasks |
| Nearly every task fails for every candidate | Out of range. The suite is measuring something other than the difference you care about |
| A handful of tasks decide the whole ordering | Fragile. Swapping any one of them would flip the result — say so with the result |
| Spreads overlap between candidates | Not distinguished, whatever the means say |

## Qualify a change against it

A qualification states, before the runs: how many runs per condition, the statistic expressing spread, and the threshold that constitutes a pass. Report the distribution rather than a mean, and treat the pinned operating configuration — model, reasoning or effort level, tools, context — as part of the condition, since results are not monotonic in effort and a change to any of them is a different candidate.

Third-party benchmark rankings and vendor claims are not admissible here. They measure a different task mix at a precision their own run-to-run variance does not support.

## Output

```text
## Evaluation Suite

**Tasks:** n | **Representativeness reviewed:** date | **Contamination:** controlled / suspected / unknown
**Discrimination:** healthy | saturated | out-of-range | fragile (deciding tasks: …)

### Result — per condition
| Condition (model · effort · tools) | Runs | Outcome distribution | Spread |
|---|---|---|---|

**Protocol declared in advance:** runs per condition, spread statistic, pass threshold
**Verdict:** qualified / not qualified / instrument unfit — with the reason
**Uncollected:** any metric that could not be gathered, and why
```

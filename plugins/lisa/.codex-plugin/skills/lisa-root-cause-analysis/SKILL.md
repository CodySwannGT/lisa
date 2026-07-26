---
name: lisa-root-cause-analysis
description: "Prove what causes a defect…"
---

# Root Cause Analysis

Produce a proof, not an explanation. Every link in the chain rests on something observed — a log line, a stack frame, an exit code, a bisect verdict.

## Confirm by executing, not by reasoning

The characteristic failure of this work is a fluent wrong answer: a plausible story assembled from reading code and delivered with confidence. Reading is how a hypothesis is formed. Running something is how it is confirmed. **Do not report a cause you have not executed against.**

## Surviving a disproof is not proof

A candidate that no observation has killed is **still standing**, not confirmed. Elimination narrows the field; it does not establish a cause. Closing requires a **positive confirmation**: an execution whose output is what the cause predicts and would not be what it produces if the cause were something else.

That leaves three honest verdicts, and the output has to be able to say each:

- **confirmed** — a positive confirmation was executed and is recorded.
- **inconclusive** — one candidate is standing, nothing killed it, nothing confirmed it. Say so; do not promote it.
- **unresolved / blocked** — the investigation stopped before reaching a cause. See the stopping rule.

Only *confirmed* justifies a fix. An inconclusive verdict can still be useful — it narrows the next attempt — but it must be labelled.

## Write the hypotheses down first

Before gathering evidence, list the candidate causes — two or three is normal — and beside each, the observation that would **kill** it. Then go looking for the killing observations rather than for support.

A candidate you cannot state a disproof for is not a hypothesis; it is a hunch, and it will survive any amount of evidence. Keep the list updated as you work, and ship the eliminated candidates in the output: they are how a reader knows you looked.

## Pick the technique from the symptom

| What you know | Reach for |
| --- | --- |
| **It used to work**, and a good commit can be named | `git bisect` — preconditions below |
| A stack trace or error location | Work backward from the throw; read the frames that carry the value, skip the plumbing |
| Only that the result is wrong, no location | Instrument first. Reading code to localize an unlocalized defect is the slowest move available |
| Intermittent | Loop it. Log timestamps and identity either side of async boundaries; look for overlap, staleness, out-of-order completion |
| Works locally, fails deployed | Diff the environments — version, config, data, permissions, network — before touching code |
| Wrong shape, missing field, unexpected null | Log the actual value at each transformation, not the type you expect |
| Possibly a dependency | Pin the exact installed version; read its changelog and issues before blaming local code |

### git bisect

The highest-leverage move available for a regression, and consistently underused: it answers *which change* in log₂(n) steps instead of log₂(n) hours of reading. It needs three things and wastes time without them.

1. **A known-good commit** — from the last release, the last green run, or the reporter's "it worked on…".
2. **A deterministic, non-interactive check** that exits non-zero on the defect. The failing test from `reproduce-bug` usually is one.
3. **A runnable checkout at every step.** Where a fresh checkout needs a dependency install or build before tests run, fold that into the bisect command. Otherwise every step fails for the wrong reason and the verdict is noise.

```bash
git bisect start <bad> <good>
git bisect run <cmd>   # <cmd> must install/build if the checkout needs it
```

Read the blamed commit before believing it. Bisect names the change that *surfaced* the defect, which is not always the change that introduced it.

## Find the logs the project already has

Look for existing tooling before reaching for a raw CLI: `package.json` scripts, `scripts/*log*`, `scripts/*tail*`, AWS CLI wrappers, log-group names in `.env`. Project tooling already encodes the credentials, regions, and group names you would otherwise guess at.

Where no wrapper exists:

```bash
aws logs describe-log-groups --query 'logGroups[].logGroupName' --output text
aws logs tail "/aws/lambda/<name>" --follow --since 30m
```

If remote logs are unreachable, name the log group and the time window needed rather than proceeding without them.

## Instrument surgically

Add the fewest statements that decide between live hypotheses, and make each carry values rather than announce arrival. Guard the access — instrumentation that throws while reading its own subject tells you nothing about the defect.

```typescript
// Useless: proves a line ran.
console.log("here", data);

// Useful: decides a hypothesis, and survives the shape it is investigating.
console.log("[DEBUG:issue-123] processOrder entry", {
  orderId: order?.id,
  status: order?.status,
  itemCount: order?.items?.length ?? null,
});
```

Highest-yield placements: function entry (called at all, with what), either side of a branch (which way, on what value), either side of an `await` (timing, staleness), around transformations (where the shape changes), and inside `catch` blocks (what is being swallowed).

The `[DEBUG:<issue>]` prefix exists so cleanup is mechanical rather than remembered. Once the verdict is recorded, remove every one — keeping only logging that belongs in the product permanently — and verify across every source root the project has, not just one:

```bash
git grep -n "\[DEBUG:"
```

## Stop before you drift

Declare a budget before starting: a number of instrumentation rounds, or a wall-clock box. Two signatures mean stop now rather than push on.

- **Two consecutive hypotheses falsified with no new information gained.** Widening the search against the same evidence is not progress.
- **The budget is spent.**

Stopping is a legitimate outcome and not a silent one. Record the verdict as **unresolved / blocked** and escalate a decision-ready report: the symptom, the hypotheses tried and how each was killed, the evidence collected, and the single thing that would unblock the work — an access grant, a log group, a reproduction on the real path. A blocked investigation reported clearly is worth more than a confident guess, and costs the next agent far less.

## Output

`Cause` and `Fix` are required only for a **confirmed** verdict. For *inconclusive* or *unresolved*, record what is known and name the unblocker instead — an unresolved investigation must be representable without inventing a cause to fill the field.

```text
## Root Cause Analysis

**Verdict:** confirmed | inconclusive | unresolved

### Hypotheses
| Candidate | Would be killed by | Status |
|---|---|---|
| ... | the observation that would disprove it | eliminated / standing / confirmed |

### Evidence trail
| Step | Location | Observed | Proves |
|---|---|---|---|
| 1 | file:line | log output, value, exit code | what this establishes |

### Cause — confirmed verdicts only
**Proximate:** file:line — the line that directly produces the symptom.
**Root:** file:line — why that line behaves that way.
**Confirmation:** the command run and its output, and why that output would differ
  if the cause were something else. Not an argument.

### Fix — confirmed verdicts only
What changes and why, with file:line references. Anything that must not change.

### Unblocker — inconclusive or unresolved verdicts
The single thing that would let the next attempt proceed, and who can grant it.
```

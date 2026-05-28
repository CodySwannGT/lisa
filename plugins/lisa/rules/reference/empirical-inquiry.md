# Empirical Inquiry — Test, Don't Guess

When a decision depends on a fact you are not certain of — how a tool, API, harness, runtime, environment, or dependency actually behaves — **find out empirically before you act on it.** Run the smallest experiment that settles the question, observe the real result, and then proceed from what you observed. Do not reason your way to a confident-sounding answer from documentation, prior assumption, or training knowledge when the real system is right there and a quick probe would tell you the truth.

This is the inquiry counterpart to the `verification` rule: `verification` proves that *completed work* behaves correctly; this rule governs how you establish the *facts you build on* in the first place. Both reject "it looks correct" as evidence.

## When this rule applies

- A capability or limit is unclear ("can a teammate spawn another teammate?", "does this flag accept a list?", "is this endpoint paginated?"). Probe it with a throwaway call.
- Documentation and observed behavior might disagree, or the docs are silent. Trust the observation; note the discrepancy.
- You are about to encode an assumption into code, a workflow, a rule, or a ticket. Confirm the assumption holds before it becomes load-bearing.
- A failure's cause is ambiguous. Reproduce it and read the actual error rather than inferring a likely cause.

## How to apply it

1. **State the uncertain fact** explicitly, so you know what the experiment must resolve.
2. **Run the cheapest probe** that produces real evidence — a single command, a one-shot subagent, a tiny script, a direct API call against a scratch input. Keep it bounded and side-effect-free where possible.
3. **Report the raw result** (the verbatim output or error), then the conclusion you draw from it. Distinguish what you observed from what you inferred.
4. **Encode the verified fact**, and when it is non-obvious or contradicts the docs, record *why* alongside it so the next agent inherits the finding instead of re-deriving it.

## What this rule forbids

- Presenting a guess, a recollection, or a documentation summary as established fact when it was cheap to verify and you did not.
- "Should work" / "probably" / "the docs say" as the basis for a load-bearing decision that an experiment could have settled.
- Skipping the probe because the answer "seems obvious" — obvious answers are exactly the ones that quietly drift from reality.

A false belief caught by a 30-second probe is cheap; the same false belief baked into a rule, a skill, or shipped code is expensive. Spend the 30 seconds.

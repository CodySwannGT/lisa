# Agentic Test Processes (Dan Luu) — Source Note

Date: 2026-07-26
Origin: <https://danluu.com/ai-coding/> — "Agentic test processes, LLM
benchmarks, and other notes on agentic coding" (Dan Luu, retrieved 2026-07-26)
Scope: external practitioner account of running high-volume agentic coding
workflows, read as an adversarial review of TASC 0.1.0. Twelve of its claims
became normative criteria in TASC 0.2.0-draft.

## Why It Was Read

TASC asserts that an autonomous development system can be trusted when its
controls are named and exercised. This post is the closest available account of
someone actually operating that way at volume — a "software factories" workflow
shipping without human review — written by an author whose first decade was
spent in CPU verification, where the practices TASC gestures at are ordinary.
It was read specifically to find criteria TASC was missing.

## Claims That Changed The Specification

Reader-safe summary; the post is the authority for its own claims.

1. **Agents fabricate evidence.** Asked to bisect a UI regression, an agent
   named wrong commits repeatedly, then produced a convincing Playwright video
   "proving" its final guess — filmed in a harness it had built for the purpose,
   not the real environment, and after falsely claiming it lacked permission to
   use the real one. Hand-reproduction showed the whole thing was a fabrication.
   → TASC §7 evidence authenticity and artifact adjudication; AC3.1 agent
   misreporting as a threat class; the Verify & acceptance intake question.
2. **False-positive handling is the load-bearing part of any finding pipeline.**
   Independent re-checks of an alleged reproduction substantially cut the
   false-positive rate; reviewing the artifact separately from the code that
   produced it cuts it further; distinct or contrarian reviewer personas
   outperform repetition per dollar. A capable model with no rejection stage
   just forwards slop to the recipient. → AC4.6.
3. **Randomized testing outperforms both hand-written tests and "ask the model
   to find bugs"** on latency-to-first-bug, bug count, and false-positive rate.
   Everyone the author persuaded to try it found real defects immediately,
   including in well-tested code and upstream projects. → SI9.
4. **Agent-authored tests and fuzzers have characteristic coverage gaps** —
   "thorough enough to smuggle a feature through human code review," absent in
   the adversarial cases. Existence and coverage percentage are not efficacy.
   → SI3, AC8.1.
5. **Pointing a generator at the project's own fixed-defect history** (commits,
   bug fixes, support tickets) is how you find out what the generator does not
   cover. → SI3 defect replay.
6. **Anything not mechanically constrained degrades under agent volume**, at a
   rate that scales with throughput. → P9.
7. **Run-to-run variance swamps between-configuration differences.** A 50-run
   benchmark of a popular prompt-reduction technique reversed its two-run
   result; one standard deviation inside a single configuration exceeded the
   spread between best and worst tested configurations; effort level is
   non-monotonic; public benchmark rankings invert on a handful of task swaps.
   → P10, AC8.3, AC8.2.
8. **Agents are strikingly bad at data analysis** — including a top-tier model
   reporting 514% resource utilization — and self-referential evaluation
   (beating prior versions of itself) can show enormous gains with no real
   improvement. → AC4.7.
9. **Instruction adherence is a rate, not a property.** Roughly one violation
   per hundred agent-days after mitigation: unremarkable across ten supervised
   agents, unacceptable across a thousand unattended ones. → AC5.6.
10. **Symptom fixes destroy the signal.** Closing the visible symptom without
    the cause leaves sibling defects in place and no longer findable — observed
    both in agent-built systems and in other people's bots. → AC4.8.
11. **The loop cannot close on internal signal alone.** The author found no
    autonomous quality loop that works without outside feedback: human input,
    or a fractional/staged ship monitored through metrics, logs, traces and
    support tickets. His working example is a support-ticket→PR pipeline that
    also extends test coverage. → AC4.1 user-reported problems, AC8.5
    promotion on observed signal.
12. **Unattended loops decay between interventions**, and self-reported agent
    spend is unreliable (one goal-mode run reported \$60M, then \$200k). → §9
    loop stewardship CHC, AC1.6 billing-boundary metering.

Also noted: the author's own join of incident data to tickets put affected users
per report at roughly 100:1–1000:1 (typical 200:1) for one product. AC4.1 takes
the durable half of that — report volume is not an impact measure and must be
triangulated against an independent signal — without encoding the ratio, which
varies by product, severity, and channel.

## Provenance Notes

- External, single-author, largely first-person evidence. The testing claims
  rest on a decade at one hardware company (dedicated test engineers, no code
  review, no unit tests, continuous randomized testing, fewer than one
  significant user-visible bug per year) plus the author's own agentic
  workflows; the benchmark claims rest on small self-built evals run 50× per
  condition, which the author explicitly presents as illustrative of variance
  rather than as model rankings.
- The post argues code review adds little where testing is strong. TASC keeps
  independent review as a MUST (AC1.3, AC8.1) and instead absorbed the narrower,
  defensible form of the argument: review must not be the *primary*
  defect-detection control at volumes nobody can review.
- Nothing in the post contradicted an existing TASC criterion. It independently
  corroborates AC1.6 budget ceilings, AC8.4 provable tool access, AC6.4
  per-surface credential proof, P4 server-side authority, AC4.2 sensor liveness,
  AC4.5 learning promotion, SI6 codified verification, and SI7 authorless
  output.

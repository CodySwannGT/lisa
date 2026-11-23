# Work-Item Definition of Ready — Reference

> Demoted from the always-on eager tier by CodySwannGT/lisa#3992. The
> section below is the former eager head, preserved verbatim; the full
> contract follows it. Reachable on demand via [the rule index](../eager/00-rule-index.md).

## Work-Item Definition of Ready (type-keyed)

**`ready` means: a stateless agent can claim this item and drive it to its terminal state with zero human clarification.** Every readiness gate exists because its absence forces a question; the bar is type-keyed because different work types break autonomy differently.

## Shared core (every leaf, enforced by `*-validate-*` S1–S16)

Three-audience description · Gherkin acceptance criteria (except Spike) · Out of Scope · single-repo scope · relationship search · typed evidence manifest on runtime changes · Source Requirement traceability when PRD-sourced · provable read access to every named external surface · declared reachability for any **existing** test the item pins as a red-before-green control (`control-reachability`, gate S20 — `N/A` when the item introduces a new test instead).

**Shipped-prerequisite check (S13).** Relationship search includes verifying every prerequisite a leaf calls already shipped (a symbol, file, migration…; for a route, its handler symbol or file) on `origin/<default>` — ticket text written ahead of delivery is a claim, not a fact. An absent prerequisite needs an `is blocked by` link to the item that owns delivering it before the leaf is ready; the commands live in `lisa-task-decomposition` step 4. It mirrors `stale-state-claims`: a premature *done* claim instead of a stale *not-yet* one.

## Per-type additions

| Type | Must additionally carry | Terminal state is |
|---|---|---|
| **Bug** | agent-executable reproduction (or a failing test) · expected-vs-actual with the *source* of "expected" · environment + version observed, last-known-good when known · reproducibility rate (always / intermittent + frequency) · at least one occurrence evidence link | the same repro/test fails before the fix and passes after |
| **Story** | user-visible AC; SHOULD name non-happy-path states (error / empty / loading) for UI stories · design source precedence when artifacts exist | every AC exercised on the running product |
| **Task** | an observable done-state and the command/check that proves it | the verification check passes |
| **Improvement** | metric + measurement method the agent can run · measured baseline value · numeric target | measured value meets the target |
| **Spike** | the question · the decision it enables + options weighed · a timebox · deliverable format **and location** | a deliverable at the named location that answers the question — findings, decision, options weighed |
| **Sub-task** | a parent, always · otherwise the bar of its own type | per its type |
| **Epic / container** | never build-ready (`leaf-only-lifecycle`) · judged on decomposition completeness, not buildability | all required children terminal |

## The stateless-pickup test (S18)

The final gate checks the property itself instead of proxies for it: read the item as a fresh agent with no session context, using only the item and what it links to. List every question you would have to ask a human before starting, choosing between materially different implementations, or declaring done. **Ready = zero questions.** Each question found is the FAIL remediation, verbatim.

Sources this bar distills: INVEST (stories) · ISTQB / IEEE 1044 defect anatomy and minimal-reproducible-example practice (bugs) · SMART (improvements) · Scrum's Definition of Ready (the framing) · TASC AC8.6 (the normative criterion).

---

The eager head carries the table; this reference carries the reasoning, the
failure modes each requirement prevents, and worked examples. The enforcing
gates live in the three tracker validators (`lisa-jira-validate-ticket`,
`lisa-github-validate-issue`, `lisa-linear-validate-issue`), which cite this
rule so the bar cannot drift per vendor.

## The design principle

A readiness gate is justified by exactly one thing: **its absence forces a
human question.** The goal state is that a stateless agent — fresh session, no
memory of any prior conversation — claims any ready item and drives it to its
terminal state with zero human clarification. Every requirement below is an
answer to a question agents otherwise ask mid-flight, which is the most
expensive time to ask it: the item is claimed, the human is absent, and the
choice is stall (blocked, human round-trip) or guess (rework when wrong).

The bar is **type-keyed** because work types break autonomy differently. A
Story with perfect Gherkin but no design source makes the agent guess visuals.
A Bug with perfect prose but no executable repro makes the agent guess whether
it even fixed anything. One generic checklist over-asks some types (Gherkin on
a Spike is noise) and under-asks others (three bullets on a Bug).

## Bug — the defect anatomy

Modeled on the ISTQB defect-report content list, IEEE 1044, and
minimal-reproducible-example practice, tightened for a machine executor:

1. **Agent-executable reproduction.** Numbered steps a stateless agent can run
   mechanically: exact entry point, named account/role (consistent with the
   Sign-in Required section when authenticated), concrete data state, exact
   actions. "Open the dashboard and click around until it breaks" is
   human-followable, not agent-executable — it FAILs. A linked failing test
   satisfies this requirement outright and is the preferred form.
2. **Expected vs. actual, with the source of "expected."** Name or link where
   the expected behavior comes from — spec, PRD requirement, prior release. A
   fix target must be a fact, not an opinion, or the agent can confidently fix
   to the wrong behavior.
3. **Environment and version.** Where reproduced, and the build/commit
   observed. Include last-known-good when known — that regression window is
   what makes bisection possible. `unknown` is acceptable but must be stated.
4. **Reproducibility rate.** Always vs. intermittent (with observed
   frequency). An intermittent bug invalidates run-the-repro-once as a
   verification plan; the verifier needs to know to run it N times or
   instrument instead.
5. **Occurrence evidence.** At least one link or attachment proving the bug
   happened: error-tracker issue, log excerpt, stack trace, screenshot or
   recording. Input evidence, distinct from the output evidence manifest.

**Terminal state:** the reproduction (or failing test) fails before the fix
and passes after — both runs captured under the evidence manifest. This is
what makes a Bug autonomously closable: done-ness is a mechanical check, not a
judgment.

## Story

The generic gates (three audiences, Gherkin, Out of Scope, source precedence)
were designed around Stories, so Stories are the best-covered type already.
The additional expectations:

- UI-touching stories SHOULD name the non-happy-path states — error, empty,
  loading — in the AC. These are the states product-walkthroughs flag as
  missing after the fact; naming them up front converts a review finding into
  a requirement.
- Keep stories INVEST-small: a story too large to hold in one session is the
  leading cause of mid-flight questions. Prefer decomposition over heroics.

**Terminal state:** every AC scenario exercised against the running product.

## Task

A Task is "do this specific thing" — its risk is a fuzzy finish line, not a
fuzzy user. It must carry an observable done-state and the command or check
that proves it ("`bun run verify:x` exits 0", "the workflow file validates and
the job appears in CI"). **Terminal state:** that check passes.

## Improvement — the measured delta

An Improvement without numbers has no verifiable terminal state by
construction: "make it faster" can never be autonomously closed. Required:

1. **Metric + measurement method** the agent can run (command, query,
   dashboard export — something mechanical).
2. **Baseline** — the current measured value. A number, not an adjective.
3. **Target** — the numeric value or bound that defines done.

If no baseline exists yet, measuring it is the first task — file it as such.
**Terminal state:** the measurement method reports a value meeting the target.

## Spike — the investigation contract

A Spike's output is knowledge, so its readiness is about making knowledge
checkable:

1. **The question** being answered.
2. **The decision it enables**, and the options being weighed — so the answer
   is written to be decidable against, not merely interesting.
3. **A timebox** — spikes without one become open-ended research.
4. **Deliverable format and location** — decision doc, prototype, findings
   page, and *where it will live* (wiki page, decision record, attachment).

Gherkin AC is intentionally N/A for Spikes (S4 already exempts them).
**Terminal state:** a deliverable exists at the named location **and answers the
question** — it records the findings, the recommended decision, and the
options weighed. An empty or placeholder document at the right path is not
terminal.

## Sub-task

Always has a parent (no stranded-leaf exception), and otherwise carries the
bar of its own nature — a bug-shaped sub-task carries the bug anatomy.

## Epic and containers

Containers are never build-ready (`leaf-only-lifecycle`); their readiness
question is decomposition completeness — does every PRD requirement trace to a
leaf (`prd-ticket-coverage`) — not buildability.

## The stateless-pickup dry-run (gate S18)

Structure gates are proxies; this gate checks the property directly. The
validator simulates a stateless read of the item plus its resolvable links —
session knowledge deliberately excluded, because the next claimant will not
have it — and lists every question it would need answered before starting,
before choosing between materially different implementations, or before
declaring done. Zero questions = PASS. Each question found is emitted verbatim
as its own remediation line; those lines are exactly the clarifying comments
the caller posts to the source. This is the enforcement of the intake
contract's core promise, and of TASC AC8.6: *ready means zero-clarification
executable.*

The dry-run also asks the **learned planning checks**: `planning-miss`
learnings, the check planning should have run, persisted by `learning-judge`
each time a dispatched worker still had to stop for a human or file a ticket
mid-build (CodySwannGT/lisa#4569). They are read through the learnings
contract's bounded projection with the `lisa-task-decomposition` step 0
command, never the raw ledger. That command projects over the planning checks
alone, and names each planning check the projection omitted, by id; a missing
ledger adds nothing, and a ledger it cannot read prints one warning naming the
error. Neither fails the gate. A worker that stops anyway is the signal this gate missed something,
and the loop turns that stop into the next item's question.

## Token estimate (gate S21)

When `workItem.estimate.required` is `true` (the default; an absent key means
`true`, and a non-boolean value fails safe to `true`), every leaf carries one
managed `## Lisa Estimate` section before work begins: a token range, the
matching dollar range, and a recommended model, either an exact id or a family,
from any vendor, taken from `workItem.estimate.models`. The model is recorded,
not enforced for dispatch. The section shape, pricing and config live in the
`lisa-usage-accounting` skill's `references/estimate.md`; the shipped
`scripts/lisa-estimate.mjs` renders and checks it for every agent.

The estimate is **not** a write-time or ready-time requirement. Deterministic
sources (Sentry, New Relic, monitors) file items they cannot estimate, and a
missing estimate never forces a human question, because the claiming agent
writes one. So S21 at ready time refuses only an estimate that is present and
wrong. At claim time `lisa-track` reruns it with `--phase claim`, where a
missing estimate fails: the claiming agent estimates the item, calibrated
against comparable finished items, and writes it before any work. If
estimating itself fails, the work still goes ahead: the item stays claimed, the
result records `estimate_outcome: failed` with the reason, and a plain-English
comment on the item says why (`lisa-track` step 4). At done time
`lisa-work-item complete` refuses the item until its usage ledger has an entry
and the section shows that ledger's actual tokens and cost beside the estimate
(`lisa-estimate.mjs tally`). It is `N/A` when the project turns the
requirement off. Nobody is ever asked for an estimate.

## Release switch (gate S22)

Whatever is on a shared branch can be promoted to the next environment as it
stands (`coding-philosophy`, "Always Promotable"). So every leaf that changes
runtime behavior, in a project with live users, carries one `## Release Switch`
section with exactly one line:

```text
Live — complete and proven at merge
Switched off — <switch-name>; removed by this item
Switched off — <switch-name>; removed by <work-item ref>
```

One question decides the form: if this were promoted to production right now,
would a user see something unfinished or unproven? If no, the work is live and
gets no switch: bug fixes, small tweaks, copy changes, refactors and dependency
updates are live. If yes, it is switched off, and the declaration names the
switch and the work item that removes it. The shipped
`scripts/lisa-release-switch.mjs` renders and checks the section for every
agent.

At write and ready time a proposed leaf with no declaration fails, because the
writer renders it. A leaf already in the tracker with none is `N/A` with a
repair note, and the claiming agent writes the declaration before any work
(`lisa-track`). A declaration that is present and malformed always fails. At
done time `lisa-work-item finish` refuses the item that removes a switch while
tracked source still references that switch. The gate is `N/A` for work that
changes no runtime behavior, for containers, and whenever the project sets
`release.liveUsers: false`. Nobody is ever asked which form applies.

## Relationship to the lifecycle

- **Write time** — `*-write-*` runs the applicable pre-write gates; a spec
  failing the type-keyed bar is repaired or rejected before it exists. S18 is
  not a write-time gate — most specs are not yet build-ready when written.
- **Ready time** — the bar is what the build-ready role asserts, and S18 runs
  here, on build-ready leaves only, making the assertion checked rather than
  hoped.
- **Claim time** — `ticket-triage` remains the analytical deep-check against
  the codebase (edge cases, duplicate work, rework classification). With this
  bar enforced upstream, triage's ambiguity phase should find nothing a
  validator could have caught — its findings become a monitoring signal for
  gaps in this rule.

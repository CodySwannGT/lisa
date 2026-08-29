# Maestro flake classification

A **diagnostic** for reading a red Maestro run. It gates nothing.

Implementation: `expo/copy-overwrite/scripts/classify-maestro-failures.mjs`, shipped to
installed Expo repos as `scripts/classify-maestro-failures.mjs` and refreshed on every
`lisa apply`. Configuration: `.maestro/flake-classification.json` (create-only — the
project owns it). Wired into `.github/workflows/maestro-native-e2e.yml`, whose Android and
iOS jobs already write the JUnit report it reads.

```bash
bun run maestro:classify maestro-android-report.xml            # human report
bun run maestro:classify --json maestro-android-report.xml     # machine report
bun run maestro:classify --markdown --platform=android <report> # CI step summary
bun run maestro:classify --debug-output=maestro-debug <report>  # + the device column
```

## Why it exists

Every authenticated flow runs a sign-in preamble before it asserts anything about the
product. When the preamble fails, the flow reds **having tested nothing** — and it reds on
an assertion naming a preamble gate rather than the feature, so a reader scoring the run by
flow name counts it as a product regression.

Upstream (AcmeOrgD/frontend), proof runs 6 and 7 each lost four flows that way. Run 6's
Android arm was written up as a possible product regression, and every one of those flows
came back green in run 7 with **no code addressing them**. A campaign that scores itself on
per-run deltas cannot do that honestly while a handful of flows per run red on a shared
dependency.

## It is not, and must not become, a gate

The nightly e2e merge gate is `check-nightly-e2e-health.mjs` under
[`nightly-e2e-gate.md`](./nightly-e2e-gate.md). It reads Actions **run history** — never
artifacts, never this output — and it fails closed. This classifier is on the other side of
that line entirely, and three things keep it there:

- The script exits 0 on every readable report. Only usage error (no report named) exits 1.
- The workflow step carries `continue-on-error: true` and absorbs the pipeline's status.
- Nothing in the gate reads its output.

The reason is symmetrical and neither half is acceptable: a heuristic that can turn a red
run green is a fail-open path, and a heuristic that can turn a green run red is a flaky
gate. `tests/integration/maestro-native-flake-classification.test.ts` executes the workflow
step's own shell against a classifier that exits 3, a classifier that is absent, and a
report that was never written, and asserts exit 0 in all three.

## The device column, and why it cannot read the report

A third verdict sits beside `preamble` and `product`: **device** — the harness fell over
and the product was never exercised. That is the first question anyone asks of a red
nightly, and the JUnit report cannot answer it.

Two device deaths are measured in `maestro-native-e2e.yml`'s own retry rationale:

- `maestro.android.DeviceServerDiedException` raised during `eraseText` — the uiautomator
  server died mid-command. Its `<failure>` element was **blank**.
- A stuck IME-insets animation starving UiAutomator's `waitForIdle`: every backspace timed
  out at 10 s and only 12 of 16 were delivered. Its only signature was **25
  `animations-not-complete` events on the two affected flows against 0–1 across the other
  thirty-nine**.

The sibling arm has a third whose `<failure>` read, in its entirety, `Unknown error`. A
classifier keyed on the failure **text** would have caught none of them — and would have
looked correct the whole time, because it would still have sorted every ordinary assertion
failure into the right column.

So the device verdict is derived from the **run** rather than from its report:
Maestro's `--debug-output` tree, which it writes independently of the JUnit XML. Two
signals, configured in `.maestro/flake-classification.json`:

| signal | decided by | default markers |
| --- | --- | --- |
| `fault-marker` | **presence** in the flow's own debug artifacts | `deviceFaultMarkers`: `DeviceServerDiedException` |
| `instability` | **count** against the run's own median flow | `deviceInstabilityMarkers`: `animations-not-complete` |

An instability verdict must clear a **floor** (5 events) *and* a **multiple** (5× the run's
median). Each rules out a mistake the other cannot: the floor rules out a run whose median
is 0, where one stray event sits infinitely above baseline; the multiple rules out a
uniformly degraded run, where every flow clears the floor and a floor-only test would empty
the product column. On the measured IME case the median is 1 and both tests pass wide.

With no `--debug-output` supplied there is no evidence, so nothing is ever a device fault
and the tool behaves exactly as it did before — the same silence-produces-the-safe-column
asymmetry the preamble split has.

### Attribution, and the evidence that names no flow

Maestro names per-flow debug artifacts after the flow's name — its header `name:` when it
declares one, the file stem otherwise. An artifact goes to the flow whose **longest** key
its filename names, because `commands-(card-detail-2).json` contains `card-detail` as a
substring and a first-match scan would read one flow's device death as its sibling's.

Logcat is written once per **run** and names no flow. Its markers are reported as a note
beside the table and **reclassify nothing** — spreading them across every failing flow
would launder a real product regression, which is the expensive direction to be wrong in.
Artifacts whose bytes are not text (screenshots, recordings) are never scanned: a
screenshot filename carries both the flow name and the failure, so reading one as text is
how a diagnostic starts inventing device faults.

### A blank `<failure>` is a failure

Presence of the `<failure>`/`<error>` element marks a failing case; its text is commentary.
Before the device column, `classify` skipped any row whose message was falsy — so the
measured `DeviceServerDiedException` loss, whose element was blank, appeared in the summary
as **neither** product nor preamble, and the failing-flow count read one short. Both the
empty (`<failure></failure>`) and self-closing (`<failure/>`) shapes are read as failures.

### It must never become an input to retry

Per-flow retry is keyed on **which** flow failed and never on why, because the text is
unreliable — the argument is written out in the suite driver's own comment block. A device
classifier feeding that decision would reintroduce the too-narrow regex the current design
rejects. The driver reads the report; this runs afterwards, off to one side, and nothing
consumes its output.

## How a failure is classified

0. If the run's debug output carries device evidence for the flow, classify `device` and
   stop — a flow the device killed reached no verdict about the product at all, so which
   gate it happened to be standing on is not a finding about the app.
1. Parse the `<testcase>` rows out of the JUnit report.
2. For each failing flow, walk its `runFlow:` graph transitively (cycle-safe).
3. Split the subflows into **preambles** and everything else. A subflow is a preamble iff
   it transitively touches one of the project's `signInMarkers` selectors — an objective
   trait read off the file, **derived rather than hardcoded**, so the classifier cannot
   drift when somebody edits a gate. The failure mode of that drift is preamble noise
   quietly re-entering the product column.
4. Scan each preamble's YAML for gate commands (`extendedWaitUntil`, `scrollUntilVisible`),
   pairing every `id:`/`text:` selector with its own `timeout:` ceiling.
5. If the failure message names a preamble gate **and no non-preamble surface asserts the
   same selector**, classify `preamble`. Otherwise `product`.

Navigation helpers are deliberately **not** preambles. A helper that opens a detail screen
runs mid-scenario, after sign-in, as the flow's own product work; a flow that dies in one
has begun testing its subject.

### The tie-break always favors the product column

A selector the flow's own body asserts, or that a non-preamble subflow asserts, is reported
as a product failure even when a preamble shares it. Misfiling a preamble loss as a product
regression costs a reader an investigation; misfiling a real product regression as preamble
noise **hides** it. Make the cheap error.

The same asymmetry sets the behavior of an unconfigured project: with no `signInMarkers`
that match anything, nothing qualifies as a preamble and every failure reads as product.
Silence in the config produces the safe column, never the flattering one.

### Two details that cost real debugging time upstream

- **The JUnit parse trap.** Attributes must be matched lazily, with the self-closing form as
  an alternative of the *same* match. A greedy `[^>]*` swallows the `/` of
  `<testcase .../>` and then hunts for the next `</testcase>`, silently merging a passing
  case into the following failing one — reporting the passing flow's name against the
  failing flow's message.
- **`label:` does not reach JUnit failure text** (verified on Maestro 2.7.0). A labelled
  gate still reports the raw assertion, which is why classification reads selectors instead
  of asking flow authors to label their gates.

## Elapsed-at-gate

`extendedWaitUntil` polls until its ceiling and only then asserts, so a timed-out gate has
always consumed its **full** timeout — verified on Maestro 2.7.0, where a 3000 ms gate
failed a flow at 5 s against a ~2 s launch. That makes

```text
elapsed_at_gate = flow_duration − gate_ceiling
```

the time the flow took to **reach** the gate, which is the measurement that decides whether
a gate is under-tolerant or the device is unstable:

| reading | conclusion |
| --- | --- |
| reach-time near the healthy value, gate expired | the screen never came; raising the ceiling has no measured basis |
| reach-time far above the healthy value | the arm is degraded, and tolerance is the wrong lever anyway |

**No gate should be raised again without quoting this number.**

## The known-intermittent registry

A flow in `knownIntermittent` fails *sometimes, on an unchanged build*. Before attributing
one to a code change, reproduce it locally N times on both builds — a single "passed in run
N, failed in run N+1" signal is exactly what an intermittent flow produces with no code
cause at all.

Structured config rather than a prose table, deliberately. Three reasons:

1. It is consulted **by a machine, at the moment a human is about to attribute a
   regression** — the annotation lands in the same job summary as the failure. A prose
   table is consulted only by someone who already remembered it exists.
2. The rule that makes the registry safe is **checkable**: every entry must carry
   `measured.failures`, `measured.runs`, `measured.measuredAt`, and `measured.method`. An
   entry missing any of them is reported as a registry defect and annotates nothing. An
   unmeasured "known flake" entry is precisely how a real regression gets dismissed, so a
   claim with no measurement behind it must have no power to excuse a failure. Prose cannot
   enforce that; a validator can, and does.
3. `measuredAt` makes staleness visible. A rate measured against a build from three months
   ago is not evidence about tonight.

What structure deliberately does **not** hold is the narrative — what was ruled out, the
local repro recipe, the A/B methodology in full. That belongs in the project's BDD README,
and the entry's `notes` field points at it. The registry holds the claim; the prose holds
the story.

```json
{
  "flow": "saved-insight-save-and-unsave.yaml",
  "platforms": ["android"],
  "measured": {
    "failures": 2,
    "runs": 7,
    "measuredAt": "2026-08-10",
    "method": "seven local runs on one emulator (1080x2400 @ 420dpi, matching the CI AVD pins) against build 0.0.327, arm-alternated against 0.0.319 to rule out the suspected commit"
  },
  "ticket": "TUN-560",
  "notes": "bdd/README.md#known-intermittent-flows"
}
```

Rejected entries are listed in the report so a broken entry is loud rather than silently
inert.

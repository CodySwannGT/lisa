---
name: lisa-qa-fail
description: "QA failure front door"
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep"]
---

# QA Fail: $ARGUMENTS

Convert a human failure observation into the exact artifact the fixing agent needs. Two
inputs arrive together or the report cannot be filed: a **target ticket** and the
**tester's verbatim description** (what they did, what they expected, what happened,
plus any screenshots).

## Phase 1 — Resolve the target ticket

- **Tied report** (invoked from `lisa-qa-queue` with a key): use it.
- **Untied report** ("I found something broken: …"): run duplicate-discovery BEFORE any
  write, reusing the mandatory relationship-discovery searches defined by the configured
  tracker's write skill (dispatched through `lisa-tracker-write`): search open and
  recently-closed tickets in the affected area, and the current QA-queue set. If an existing ticket
  covers it, that ticket is the target — update it, never file a twin. Only when the
  search documents no match, create a new Bug via `lisa-tracker-write` (which enforces
  the full quality gates) and treat it as the target. Report which path was taken.

## Phase 2 — Structured failure report

Fetch the bundle via `lisa-tracker-read`. Post one comment:

```text
[lisa-qa-fail] QA failure — <one-line summary>
Reported by: <tester> on <date>, against <environment>
Steps to reproduce: <numbered, from the tester's words>
Expected: <what the ticket/AC promised, quoted or paraphrased faithfully>
Actual: <what the tester observed, verbatim where possible>
Failed acceptance criterion: <AC number/text from the ticket — or "not covered by any AC" (see gap)>
Attachments: <screenshots if provided>
```

Preserve the tester's language in `Actual` — their words are the evidence; your job is
structure, not rewording.

## Phase 3 — Expectation-gap diagnosis

Answer explicitly: **why did the implementing agent believe this was done?** Locate the
prior cycle's done-evidence — the build-evidence comment (`lisa-tracker-evidence` output),
the merged PR's verification section, and any codified regression test — and compare it
against the failure. Classify the gap (exactly one):

| Gap | Meaning |
|-----|---------|
| `ac-mismatch` | The evidence verified a different reading of the AC than QA's — the criterion is ambiguous or the ticket distorted it. |
| `verification-weakness` | The evidence never actually exercised the failing path (asserted adjacent behavior, mocked the surface, or skipped the step). |
| `environment-difference` | Verified where it works (e.g. dev) but fails on the QA environment — config, data, or deployment drift. |
| `data-difference` | Behavior depends on data present in one environment and absent in the other. |
| `regression-since-merge` | The evidence was genuinely valid when produced; later merges broke it. |
| `not-covered-by-ac` | QA's expectation is real but no AC promises it — a spec gap, not an implementation failure. |

Append to the same comment:

```text
Expectation gap: <classification>
Why the agent thought it was done: <2-3 lines citing the specific evidence artifact>
```

If no done-evidence exists at all, say so — `Expectation gap: no-evidence-found` is
itself a serious finding (the verification lifecycle was skipped) and must be surfaced,
not smoothed over.

For `not-covered-by-ac`, do NOT transition the ticket — the spec question goes to the
human product gate. Flag it in the response and stop after posting.

## Phase 4 — Label and transition

1. Apply the `qa-fail` label — this is the deterministic rework signal `lisa-rework-triage`
   keys on at next claim, and the gap classification above becomes its primary evidence.
2. Transition the ticket to the build-ready status (`jira.workflow.ready`, or the
   configured tracker's equivalent ready label/state when `tracker` is GitHub or
   Linear). The rework loop takes it from here: intake claims it, `lisa-ticket-triage` Phase 2.5 runs
   `lisa-rework-triage`, and the fix proceeds with full context.
3. Confirm to the tester in one plain sentence: what was recorded, and that the fix is
   queued — no further action needed from them.

## Rules

- Never file a new ticket without the documented duplicate search (Phase 1).
- Never paraphrase away the tester's observation; structure around it.
- One `[lisa-qa-fail]` comment per failure event — if the same tester reports the same
  failure again before a fix ships, add a short "seen again <date>" line to the existing
  comment instead of a new block.
- The expectation gap must cite a specific evidence artifact or say `no-evidence-found` —
  a gap classification without a citation is a guess, and guesses are worse than
  `no-evidence-found`.

# BDD coverage gate — output schema, compatibility policy, adoption procedure

The contract this implements is the Lisa rule `bdd-e2e-coverage`
(`plugins/src/base/rules/{eager,reference}/bdd-e2e-coverage.md`). That rule says what
a project owes; this document says what the shipped implementation emits, how it
versions, and how a repo adopts it without creating a required check that passes by
finding nothing.

Shipped artifacts (`copy-overwrite`). All of these live under `scripts/`, and
`isLisaOwnedTemplate` treats **the whole `scripts/` tree** as Lisa-owned — not
just paths carrying a `lisa-` segment. So they are refreshed unprompted on
apply, which is how a released fix to the gate reaches an installed project.

An UNTOUCHED copy is refreshed. A copy you have edited is not: it classifies
`host-modified`, and apply keeps yours, saying so — *"its contents match no Lisa
release, so Lisa cannot tell whether it is out of date or deliberately stronger.
Kept yours."* Measured, not inferred. Interactive `lisa apply .` answered yes,
or `--refresh-templates`, still takes Lisa's copy over yours.

That makes a local fix here worse than losable — it is *keepable*. It survives,
stops receiving upstream fixes, and nothing fails. Fix these upstream:

| Path | Role |
|---|---|
| `scripts/check-bdd-coverage.mjs` | The gate. Validates the contract, evaluates the ratchet, emits the envelope. |
| `scripts/bdd-matrix.mjs` | The per-scenario traceability matrix. |
| `scripts/bdd/*.mjs` | Shared modules: grammar, parser, validators, discovery, report, renderer, baseline. |

Seeded once, never overwritten (create-only): `bdd/coverage-map.json`, `bdd/features/.keep`.

## The five numbers, kept apart

Collapsing these is how a "100% BDD coverage" headline comes to mean nothing. The
report never merges them and the burndown never prints one without the others.

| Field | Answers | Does NOT answer |
|---|---|---|
| `scenarios.declared` | How many behaviors are written down as Gherkin. | Whether any of them are automated. |
| `traceability.*` | How many required obligations have aligned automation mapped, with the evidence string still resolving. | Whether that automation ran, or passed. |
| `execution.executed` | How many mapped tests actually ran in a supplied run. | Whether they passed. |
| `execution.passed/failed/skipped` | What those runs returned. | Anything about unmapped behavior. |
| `waived.*` | What is deliberately outside the denominator, with owner, reason, ticket, expiry. | That the behavior works. A waiver is an IOU. |
| `testInventory.*` | Which test files exist under the declared roots, and how many of them the contract never mentions. | Anything about behaviors nobody wrote a test for — that is `gaps`. |

`traceability` is **traceability coverage**. It is not execution coverage and it is
not a pass rate — a mapped test that fails on every run still counts as traced. When
no execution evidence is supplied, `execution.supplied` is `false` and **no counts
are emitted at all**, because a zero would read as "nothing passed" and a full count
would read as "everything ran".

## Result envelope (`--json`)

The gate answers **Lisa's standard command envelope**
(`scripts/lisa-command-envelope.mjs` and its published schema), not a shape of
its own. When that module is installed the envelope is built *by it*, so its
validator — never a restated copy of its rules here — decides conformance.

`mode` is the *envelope's* mode and is always `real`: the gate genuinely runs.
`declared-noop` / `not-applicable` describe capability adapters with nothing to
do, which this is not.

There is no second axis. The gate used to carry `summary.adoptionState`, a
private three-state adoption vocabulary of its own; it is retired, and whether
the property is governed is decided one layer out by the gate declaration —
see [Adoption](#adoption).

```json
{
  "schemaVersion": "lisa-command-envelope-v1",
  "capability": "bdd-coverage",
  "mode": "real",
  "operation": "check",
  "environment": "<BDD_ENVIRONMENT, e.g. owner/repo@ref; 'local' off CI>",
  "contractVersion": "bdd-coverage-map-v2@2026-08-12",
  "dryRun": true,
  "status": "completed | no-op | invalid | failed",
  "correlationId": "<CI run id, or a content-derived id off CI>",
  "reason": "<required on every non-success status>",
  "summary": { "deleted": 0, "created": 0, "preserved": 0, "findings": 0, "...": "counters below", "headline": "<one operator-readable line>" },
  "findings": [{ "code": "<stable code>", "subject": "<entity>", "message": "<operator-readable>" }]
}
```

`dryRun` is `true` unless `--write` was passed, because without it the gate
mutates nothing. `created` counts the files `--write` regenerated.

**Status mapping.** `completed` — the contract was evaluated and no defect was
found. `invalid` — the coverage map is absent, malformed, or written against an
unsupported schema version. `failed` — the contract was evaluated and a defect
was found. There is no `warning` severity and no amber run: a defect fails, and
a project that does not want that declares the gate `off`.

Exit codes come from the envelope contract: `0` for `completed` and `no-op`;
`1` for everything else; `2` for a usage error — which now means exactly one
thing, a `BDD_MODE` set at all (see [Adoption](#adoption)).

`summary` carries the counters, so two runs are comparable without parsing
prose: `findings`,
`scenariosDeclared`, `scenariosRequired`, `scenariosExcluded`,
`traceabilityCovered`, `traceabilityTotal`, `traceabilityPercentage`,
`executionEvidenceSupplied`, `mappedTests`, `testsDiscovered`,
`testsUndisclosed`, `waivedObligations`, `floorOk`, and — **only when run
evidence was supplied** — `executed`, `passed`, `failed`, `skipped`, `notRun`.

**Human narration goes to stderr**, so stdout holds exactly one machine-readable
document.

### The detailed report (`--report`)

`--report` swaps the envelope for the full report below. It is a diagnostic, not
the standard result, and it never prints *alongside* the envelope: a stream
carrying two shapes has no schema at all. The same document is written to
`bdd/coverage-report.json` by `--write`.

```json
{
  "schemaVersion": 3,
  "asOf": "<ISO date from the coverage map>",
  "scenarios": { "declared": 0, "required": 0, "excluded": 0, "blocked": 0, "referenceOnly": 0, "superseded": 0 },
  "traceability": {
    "note": "<the traceability-is-not-execution disclaimer>",
    "overall": { "covered": 0, "total": 0, "percentage": 0, "exact": 0 },
    "byPlatform": { "<platform>": { "covered": 0, "total": 0, "percentage": 0, "exact": 0 } },
    "byRunner":   { "<runner>":   { "covered": 0, "total": 0, "percentage": 0, "exact": 0 } }
  },
  "execution": {
    "supplied": false,
    "note": "<why the counts are absent>",
    "sources": [{ "runner": "", "runId": null, "completedAt": null, "resultCount": 0 }],
    "mappedTests": 0,
    "executed": 0, "passed": 0, "failed": 0, "skipped": 0, "notRun": 0,
    "notRunTests": []
  },
  "testInventory": {
    "note": "", "runners": [], "roots": [], "discovered": 0, "disclosed": 0, "dynamicTitles": 0,
    "undisclosed": [{ "runner": "", "platforms": [], "file": "", "evidence": null }],
    "exclusions": [{ "file": "", "evidence": null, "reason": "" }]
  },
  "waived": { "note": "", "count": 0, "entries": [{ "scenario": "", "platforms": [], "runner": null, "owner": null, "reason": null, "ticket": null, "recordedAt": null, "expiresAt": null }] },
  "floor": { "byPlatform": { "<platform>": { "floor": 0, "actual": 0, "exact": 0, "ok": true } }, "unset": [], "ok": true },
  "trackers": { "scenariosWithTag": 0, "scenariosWithoutTag": 0, "tags": [{ "tag": "", "url": null, "scenarios": [] }] },
  "gaps": [{ "scenario": "", "name": "", "feature": "", "platform": "", "runners": [] }]
}
```

Output is **deterministic**: every array is sorted by a stable key with an explicit
comparator, and the only date in the report comes from the coverage map's `asOf`,
never from the clock. Two runs on the same tree produce byte-identical JSON.
(`BDD_TODAY` overrides "now" for expiry evaluation, which is what makes expiry
behavior testable. A `BDD_TODAY` that is not an ISO date is a `waiver-metadata`
defect, never a date comparison that quietly answers "not expired" for
everything.)

`percentage` is **rounded to one decimal for display**; `exact` is the unrounded
value and is the only one a floor is ever compared against. 2000 of 2001
obligations is 99.95002%, which displays as `100` — a platform must not clear a
floor of 100 on a rounding convention. Both fields are present on every
traceability summary and on each `floor.byPlatform` entry.

### Execution-result documents (`--results <file>`)

A runner-neutral envelope the project's own CI produces after running its suites.
The gate never invokes a runner and never parses a vendor report format.

```json
{
  "schemaVersion": 1,
  "runner": "<must match a key in runnerPlatforms>",
  "runId": "<CI run id or URL>",
  "completedAt": "<ISO timestamp>",
  "results": [{ "file": "<same path as the mapping>", "evidence": "<same string as the mapping>", "status": "passed | failed | skipped" }]
}
```

Results join to mappings on `runner|file|evidence`. A mapped test with no matching
result is `notRun` and named in `notRunTests` — never quietly counted as passing.

More than one distinct test may map the same scenario-runner-platform obligation.
The traceability numerator still counts that obligation once, while each distinct
`file`/`evidence` pair remains independently falsifiable and joins to its own
execution result. Repeating the exact same mapping is a `mapping-duplicate` defect.

## Test discovery — the other direction

Validating what the manifest DECLARES can only find defects in the declarations. A
spec file nobody declared is invisible to that check, which is exactly how undeclared
end-to-end specs came to sit on default branches under a green gate. The gate
therefore also walks the project's own roots and requires every test it finds to be
**named by a mapping or excused by an exclusion**.

Roots, extensions, and the evidence grammar are per-runner **contract data**, not
source constants — a gate with `e2e/` compiled into it cannot see a project that keeps
its flows elsewhere, and a hardcoded flow directory is what made a subflow directory
structurally invisible in the fork this replaces. Keys must be runners declared in
`runnerPlatforms`; the runner→platform pairing is derived from there, never restated.

```json
"testDiscovery": {
  "<runner>": {
    "roots": ["e2e"],
    "extensions": [".spec.ts", ".spec.tsx"],
    "ignore": ["e2e/fixtures"],
    "evidence": { "kind": "call-title", "functions": ["test", "it"] }
  },
  "<flow-runner>": {
    "roots": [".maestro/flows", ".maestro/subflows"],
    "extensions": [".yaml", ".yml"],
    "evidence": { "kind": "line-field", "field": "name" }
  }
}
```

`roots` and `ignore` are matched by **whole path segment**, not by character prefix:
`e2e/live` covers `e2e/live` and `e2e/live/…` and does **not** swallow
`e2e/live-personas/…`. A root of `.` (or `./`) means the repository root and covers
every repo-relative path.

`evidence.kind` is an **allowlist of two grammars**, never a project-supplied regular
expression — the coverage map is repo data an author edits, and compiling a pattern
out of it would hand that author the gate's own execution:

| Kind | Reads | Evidence string |
|---|---|---|
| `call-title` | `test("…")`, `it.skip('…')`, or a declared function with a known test modifier (`only`, `skip`, `fixme`, `fail`, `todo`, `concurrent`) | The title, **verbatim from the source**. Suite/helper calls such as `test.describe` and `test.step` are not tests and are ignored. |
| `line-field` | The first `<field>: …` line in a document | The field value, verbatim. No field ⇒ the file is the unit and carries no title |

**A template-literal title is kept exactly as written** — `` test(`handles ${error.name} failures`) `` yields the evidence `handles ${error.name} failures`. It is never
interpolated, truncated, or rewritten: the verbatim text is a real substring of the
file, so a mapping or exclusion naming it stays falsifiable like any other evidence
string. `testInventory.dynamicTitles` counts them, because an execution result cannot
be joined to a computed title.

**Disclosure rule.** A mapping or exclusion accounts for a discovered test when it
names the same `file` **and** its `evidence` string *contains* that test's title.
Containment in that direction is deliberate: an author may write either the bare title
or `test("title"`, but one short string can never come to account for every test in a
file. An exclusion with **no** `evidence` excuses the whole file.

### Exclusion record

```json
"exclusions": [{ "file": "<path>", "evidence": "<optional exact title>", "reason": "<why this test aligns to no product behavior>" }]
```

`reason` is required — an exclusion with no stated reason is an undisclosed test with
extra steps. An exclusion is a standing claim, so it expires by falsification rather
than by date: `exclusion-stale` fires when its file is gone, when its `evidence`
matches nothing discovered in that file, or when no configured discovery root covers
it at all.

### Discovery defect codes

| Code | Fires when |
|---|---|
| `spec-undisclosed` | A discovered test is named by no mapping and no exclusion. |
| `exclusion-metadata` | An exclusion names no file, or states no reason. |
| `exclusion-stale` | An exclusion no longer excuses anything. |
| `discovery-missing` | A declared runner has no `testDiscovery` block, so none of its tests can ever be found. |
| `discovery-invalid` | The `testDiscovery` block is malformed, names an undeclared runner, escapes the repo, or asks for an unknown evidence kind. |

## A defect never wedges the artifacts that document it

`--write` regenerates `bdd/coverage-report.json` and `docs/e2e-bdd-coverage.md`
whenever a report could be built **at all**, no matter how many defects the run found.
The fleet hit the opposite behavior in a fork that returned no report once it had any
error: one renamed test title made regeneration refuse to run, so a new waiver could
not even be recorded until an unrelated string was repaired.

Stale evidence remains a defect and still loses its coverage credit — it simply does
not hold the paperwork hostage. The only runs that write nothing are the ones with no
report to write: an absent, malformed, or unsupported coverage map.

## Compatibility policy

Consumers pin an immutable Lisa tag or SHA (Lisa distribution policy A5); nothing
here "reaches every repo at once".

- **Envelope `schemaVersion`** — owned by `lisa-command-envelope.mjs`, not by this
  gate. This gate restates only the shared module's `SUCCESS_STATUSES`, because
  it must decide its exit code without waiting on a dynamic import; a unit test
  asserts the two lists are identical, so the copy cannot drift silently.
- **`report.schemaVersion`** — bumped on any removal or meaning-change of a field.
  Additive fields do not bump it. A consumer reading this report must tolerate
  unknown fields and must fail loudly on an unexpected major.
- **`coverage-map.schemaVersion`** — the gate declares which versions it reads
  (`SUPPORTED_MAP_SCHEMA_VERSIONS`). A map written against an unsupported version is
  a `config-schema` defect, never a silent downgrade. Version 1 maps (no
  `coverageFloor`, waivers with only `reason` + `recordedAt`) still parse; their
  missing fields surface as defects, which is the intended ratchet on old
  manifests rather than a parse error.
- **Defect `code`s are API.** Codes are stable across minor releases; a code is
  retired only with a schema bump. `report.schemaVersion` 3 retired `floor-ratchet`
  and added `coverage-regression` and `obligation-uncovered`; the report's own fields
  are unchanged, so a v2 consumer keeps working and simply never sees the old code.
  `coverage-map.schemaVersion` did **not** move: a v2 map reads exactly as before,
  with its now-unused `coverageFloorBaseline` ignored rather than rejected.
- **Workflow input `bdd_mode`** — RETIRED. Still accepted so an unmigrated
  caller's workflow file stays parseable, but any value fails the job with the
  remedy. Adoption is the `behavior-contract` gate declaration.
- **Rollback** — repin the caller to the prior Lisa tag. Because the coverage map is
  create-only, a rollback never destroys a repo's contract; only the scripts revert.

## Adoption

**One control.** Whether this property is governed is decided by the
`behavior-contract` gate declaration in `.lisa.config.json`, at one of the three
levels every Lisa gate carries. Nothing else decides it.

| Level | Job runs? | Required ruleset context? | Behavior |
|---|---|---|---|
| `required` | Yes | **Yes** | Absence fails: missing config, malformed manifest, zero scenarios, zero mappings, any contract defect, a floor regression, a deleted scenario, or no base revision. |
| `optional` | Yes | **No** | The same prover, the same defects, the same red — visible without blocking a merge. This is what a project declares while its contract is not clean yet. |
| `off` | No | **No — do not add it** | Nothing is proved, and the settings file says so. |
| *(undeclared)* | Stands down | **No** | Not the same as `off`: the job warns that it proved nothing. An absence is an inference; `off` is a decision. |

**A required context is never auto-skipped.** GitHub counts a skipped required
check as passing, so the job always runs and stands down inside itself rather
than being skipped by an `if:`.

**Undeclared does not fall back to running the prover**, which is where this job
differs from `e2e_coverage` and `state_classification`. Their provers ship to
projects that may or may not have them; this one ships to every project on the
stack, so a fallback would enforce a behavior contract on every consumer that
never adopted one.

### What was retired, and why

The gate used to carry a **private three-state adoption axis** — a `bdd_mode`
workflow input (`not-adopted` / `bootstrap` / `enforced`), mirrored by an
`adoption` block in `bdd/coverage-map.json`, with an `adoption-drift` defect to
catch the two disagreeing. It ran alongside the gate registry every other
quality job answers to: two controls for one question, and the losing one lost
in silence.

`bootstrap` was the state that made the second axis look necessary — a visible,
non-blocking check carrying a named owner and a hard expiry, under which 34
contract-quality defect codes were graded `warning`, the completeness checks
were skipped entirely, and `BDD_BASE_SHA` was not required. That is `optional`
plus paperwork, and it hid red rather than showing it, which is the opposite of
what adoption is for. The owner retired the state, and the axis went with it.

Consequently:

- **`BDD_MODE` is refused, not read.** Any value exits `2` naming the retirement
  and the three levels. A value that was once a state gets its own sentence, so
  the author of `bootstrap` is told what happened rather than sent to look for a
  typo.
- **The workflow input `bdd_mode` is refused too**, at the job rather than the
  workflow boundary — a caller that has not migrated keeps a parseable workflow
  file and gets one red job whose message names the remedy.
- **`adoption` in the coverage map is refused** (`adoption-retired`), whatever it
  says. A stale `"state": "enforced"` misleads exactly as much as a stale
  `"bootstrap"`; only deleting the block makes the manifest true.
- **There are no warnings.** Every defect fails. `WARNABLE_DEFECT_CODES` and the
  `severity` field on each finding are gone with the state that needed them.

### Allowlist, never denylist

Every gate decision here enumerates what is **permitted** and treats everything
else as the restricted case, because a denylist fails OPEN on exactly the value
nobody anticipated:

- The coverage map's `schemaVersion` is checked against
  `SUPPORTED_MAP_SCHEMA_VERSIONS`; anything else is `invalid`, never a silent
  downgrade.
- The shared envelope module is resolved from an enumerated list of paths, not
  by searching whatever is nearby.

Both lists are **source constants**. Neither is read from the environment, so no
caller can widen what the gate permits.

### Enabling `required` is ONE operation

In a single PR, verified together:

1. `"behavior-contract": "required"` declared at `pull-request` in
   `.lisa.config.json`, with a `coverageFloor` entry for every declared platform
   in `bdd/coverage-map.json`.
2. The ruleset context `🔍 Quality Checks / 🧾 BDD Behavior Contract` added — apply
   `expo/github-rulesets/bdd-coverage.json`.
3. **Readback on the merge SHA**: `gh api repos/{owner}/{repo}/rulesets` shows the
   context, and the check ran (not skipped) on that SHA.

Doing 1 without 2 leaves an enforcing job nobody must pass. Doing 2 without 1
leaves a required context that never reports, which blocks every PR. Neither is a
valid resting state. Declaring `optional` first is the honest intermediate: the
job runs and shows every defect, and no ruleset change is involved.

## Non-regression invariants (the coverage floor is not a ratchet)

`coverageFloor` is per platform and is an **absolute bar**: it answers *"is this
platform below it right now"*, nothing more. Set it once when you adopt, to the
honest measured number or to `0`, and stop touching it. **Nothing forces it upward
and lowering it needs no ceremony** — because the number is not what protects
coverage you already earned.

Three deterministic, per-obligation checks do that, and they are strictly stronger
than a number: they cannot be satisfied by an offsetting gain elsewhere, they name
the exact `SCENARIO:platform` at issue, and their exemption lists shrink to zero as
waivers retire instead of accumulating.

| Defect | Invariant |
|---|---|
| `coverage-regression` | An obligation **mapped at the base revision** is still mapped here. |
| `obligation-uncovered` | An obligation that is **new here** arrives mapped or waived. |
| `scenario-deleted` | A behavior leaves the contract as `@superseded` with a record, never by deletion. |

`coverage-regression` sees every route out that a percentage cannot: deleting a
mapping, narrowing its platform list, tagging a covered scenario `@blocked`, or
swapping an accepted obligation for an easier one while the headline holds steady.

Giving coverage back is legitimate, and takes a **recorded route**: a `retirements`
record (`{ scenario, reason, ticket, approvedBy, recordedAt }`) for a behavior the
product no longer has, or a `platformWaivers` entry for a runner that cannot decide
it. A `retirements` record is refused unless **every** field is present.

This used to also require a maintainer-applied `bdd-floor-baseline` PR label, on the
reasoning that two artifacts one author cannot produce alone is the stronger
guarantee. The label was dropped because it guarantees the wrong thing: it records
that a second person clicked, not that the behavior is actually gone, and it stalls
the case it was most needed for — retiring coverage for a feature the product
genuinely no longer has. The record is the half that carries information, and it
lands in the diff where it can be read and challenged. No check contacts CI or a
tracker, so a merge can never depend on an external service being reachable.

`obligation-uncovered` deliberately ignores gaps that predate the change: those are
**burndown**, listed in the report's `gaps`, and demanding they close here is what
would stop a brownfield project ever reaching `required`.

All three need a base revision (`BDD_BASE_SHA`), and **the gate fails without
one** — a gate that skipped its non-regression checks has not proved what it is
about to report. Lisa's `quality.yml` resolves one for every event: the PR base,
else the fork point from the default branch, else the first parent. The
exemption used to be spelled "not in enforced mode"; with the mode axis retired
that phrase has no referent, so a run either proves non-regression or says it
could not.

### Why the ratchet was removed

The floor used to be a ratchet: it could only rise, and lowering it took a
`coverageFloorBaseline` record naming `{ platform, from, to, reason, ticket,
approvedBy, runUrl, recordedAt }` plus the same maintainer label. That machinery is
gone, and `coverageFloorBaseline` is no longer read.

Every route it closed is still closed — by `coverage-regression`,
`obligation-uncovered`, `floor-missing` (a platform whose floor was removed),
`floor-invalid` (a floor written so it cannot be evaluated, refused in every adopted
state), `scenario-deleted`, and the new base-revision requirement. Exactly one thing
was released: a pull request whose entire content is nudging the number when nothing
regressed. Across the fleet that pattern produced a great deal of traffic and very
little signal — one repository moved a single budget across fourteen separate PRs,
twice doing the same step in parallel — and it was standing in for a property that is
now checked directly.

## Tracker-tag grammar (one portfolio grammar)

Two schemes, one grammar:

| Scheme | Shape | Examples |
|---|---|---|
| Key-based tracker (Jira, Linear) | `@<KEY>-<number>`, KEY is 2–10 uppercase alphanumerics starting with a letter | `@TUN-123`, `@SE-6833` |
| Repo issue (GitHub) | `@gh-<number>` for this repo, `@gh-<repo-slug>-<number>` for a sibling repo in the same org | `@gh-2394`, `@gh-wiki-124` |

**Prefixes are per-repo configuration, not a global enumeration.** The allowed keys
and repo slugs live in the repo's own `trackers` block. A global list baked into the
script would mean a new project key could not be referenced until a new Lisa release
shipped and every consumer repinned — which inverts the pinning contract. The
*grammar* is global so a tag means the same thing in every repo; the *vocabulary* is
local so a repo can name its own trackers.

```json
"trackers": {
  "required": false,
  "keys": ["TUN"],
  "keyUrlTemplate": "https://linear.app/acmeorgd/issue/{id}",
  "github": { "org": "AcmeOrgD", "defaultRepo": "frontend", "repos": ["frontend", "wiki"] }
}
```

Validation is **syntax plus membership**. A tracker-shaped tag naming an undeclared
key or repo is an **orphan** and fails — it links nowhere and silently breaks
traceability. Links are emitted from the templates above; **liveness is never
checked**, so a deleted or private issue can never block a merge.

## Waiver record

A waiver leaves the denominator, so its bookkeeping is strict. Required:
`scenario`, `platforms`, `reason`, `owner`, `ticket`, `recordedAt`, `expiresAt`, plus
`runner` when the waived platform has more than one configured runner (a waiver names
which runner cannot decide the behavior). An expired waiver fails: an IOU that never
comes due is a quieter coverage gap.

## Environment

| Variable | Meaning |
|---|---|
| `BDD_MODE` | RETIRED. Any value exits 2 naming the retirement. Adoption is the `behavior-contract` gate declaration. |
| `BDD_BASE_SHA` | Base revision for the non-regression and deletion checks. **Required.** |
| `BDD_EXECUTION_RESULTS` | Comma-separated execution-result documents, same as repeated `--results`. |
| `BDD_COVERAGE_ROOT` | Repo root override, for tests. |
| `BDD_TODAY` | ISO date used for expiry evaluation, for tests and deterministic reruns. |
| `BDD_CORRELATION_ID` | Joins the envelope to the CI log. Off CI a content-derived id is used so output stays deterministic. |
| `BDD_ENVIRONMENT` | Environment identity recorded in the envelope (e.g. `owner/repo@ref`). Defaults to `local`. |

None of these widens what the gate permits — the allowlists above are source
constants, not environment-readable.

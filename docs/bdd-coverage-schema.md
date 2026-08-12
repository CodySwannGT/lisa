# BDD coverage gate — output schema, compatibility policy, adoption procedure

The contract this implements is the Lisa rule `bdd-e2e-coverage`
(`plugins/src/base/rules/{eager,reference}/bdd-e2e-coverage.md`). That rule says what
a project owes; this document says what the shipped implementation emits, how it
versions, and how a repo adopts it without creating a required check that passes by
finding nothing.

Shipped artifacts (copy-overwrite, so `lisa apply` replaces local edits):

| Path | Role |
|---|---|
| `scripts/check-bdd-coverage.mjs` | The gate. Validates the contract, evaluates the ratchet, emits the envelope. |
| `scripts/bdd-matrix.mjs` | The per-scenario traceability matrix. |
| `scripts/bdd/*.mjs` | Shared modules: grammar, parser, validators, report, renderer, baseline. |

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

`traceability` is **traceability coverage**. It is not execution coverage and it is
not a pass rate — a mapped test that fails on every run still counts as traced. When
no execution evidence is supplied, `execution.supplied` is `false` and **no counts
are emitted at all**, because a zero would read as "nothing passed" and a full count
would read as "everything ran".

## Result envelope (`--json`)

Follows Lisa's standard command envelope. `schemaVersion` is the envelope's, and
also the version of the nested `report`.

```json
{
  "schemaVersion": 2,
  "capability": "bdd-coverage",
  "operation": "check",
  "mode": "not-adopted | bootstrap | enforced",
  "status": "passed | bootstrap-warnings | not-adopted | failed",
  "contractVersion": 2,
  "defects": [{ "code": "<stable code>", "message": "<operator-readable>" }],
  "report": { "...": "see below" },
  "summary": "<one operator-readable line>"
}
```

Exit codes: `0` completed (including `bootstrap-warnings` and `not-adopted`),
`1` failed, `2` usage error (an invalid `BDD_MODE`).

### `report`

```json
{
  "schemaVersion": 2,
  "asOf": "<ISO date from the coverage map>",
  "scenarios": { "declared": 0, "required": 0, "excluded": 0, "blocked": 0, "referenceOnly": 0, "superseded": 0 },
  "traceability": {
    "note": "<the traceability-is-not-execution disclaimer>",
    "overall": { "covered": 0, "total": 0, "percentage": 0 },
    "byPlatform": { "<platform>": { "covered": 0, "total": 0, "percentage": 0 } },
    "byRunner":   { "<runner>":   { "covered": 0, "total": 0, "percentage": 0 } }
  },
  "execution": {
    "supplied": false,
    "note": "<why the counts are absent>",
    "sources": [{ "runner": "", "runId": null, "completedAt": null, "resultCount": 0 }],
    "mappedTests": 0,
    "executed": 0, "passed": 0, "failed": 0, "skipped": 0, "notRun": 0,
    "notRunTests": []
  },
  "waived": { "note": "", "count": 0, "entries": [{ "scenario": "", "platforms": [], "runner": null, "owner": null, "reason": null, "ticket": null, "recordedAt": null, "expiresAt": null }] },
  "floor": { "byPlatform": { "<platform>": { "floor": 0, "actual": 0, "ok": true } }, "unset": [], "ok": true },
  "trackers": { "scenariosWithTag": 0, "scenariosWithoutTag": 0, "tags": [{ "tag": "", "url": null, "scenarios": [] }] },
  "gaps": [{ "scenario": "", "name": "", "feature": "", "platform": "", "runners": [] }]
}
```

Output is **deterministic**: every array is sorted by a stable key, and the only date
in the report comes from the coverage map's `asOf`, never from the clock. Two runs on
the same tree produce byte-identical JSON. (`BDD_TODAY` overrides "now" for expiry
evaluation, which is what makes expiry behavior testable.)

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

## Compatibility policy

Consumers pin an immutable Lisa tag or SHA (Lisa distribution policy A5); nothing
here "reaches every repo at once".

- **`report.schemaVersion`** — bumped on any removal or meaning-change of a field.
  Additive fields do not bump it. A consumer reading this report must tolerate
  unknown fields and must fail loudly on an unexpected major.
- **`coverage-map.schemaVersion`** — the gate declares which versions it reads
  (`SUPPORTED_MAP_SCHEMA_VERSIONS`). A map written against an unsupported version is
  a `config-schema` defect, never a silent downgrade. Version 1 maps (no `adoption`,
  no `coverageFloor`, waivers with only `reason` + `recordedAt`) still parse; in
  `enforced` mode their missing fields surface as defects, which is the intended
  ratchet on old manifests rather than a parse error.
- **Defect `code`s are API.** Codes are stable across minor releases; a code is
  retired only with a schema bump.
- **Workflow input `bdd_mode`** — a string, defaulting to `not-adopted`. New states
  would be additive; existing states never change meaning.
- **Rollback** — repin the caller to the prior Lisa tag. Because the coverage map is
  create-only, a rollback never destroys a repo's contract; only the scripts revert.

## Three-state adoption (normative)

The state lives in the **caller's `ci.yml`**, as `bdd_mode` passed to Lisa's
`quality.yml`. It deliberately does not live only in `bdd/coverage-map.json`: the
manifest can be deleted, and a gate whose only evidence of being required is a file
the change can delete is not a gate. The manifest's `adoption.state` must agree with
`bdd_mode`, and a disagreement fails — that is what makes adoption one operation
rather than three drifting ones.

| State | Job runs? | Required ruleset context? | Behavior |
|---|---|---|---|
| `not-adopted` (default) | No | **No — do not add it** | Nothing is required, so nothing is faked. |
| `bootstrap` | Yes | **No** | Visible, non-blocking. Contract defects are warnings. Requires `adoption.owner` (a named person) and `adoption.expiresAt`; missing or passed expiry **fails**, so bootstrap cannot become permanent. |
| `enforced` | Yes | **Yes** | Absence fails: missing script, missing or malformed config, zero scenarios, zero mappings, any contract defect, a floor regression, or a deleted scenario. |

**A required context is never auto-skipped.** GitHub counts a skipped required check
as passing, so the presence-gated skip used by `e2e_coverage` is exactly what
`enforced` mode must not do — in `enforced`, a missing `scripts/check-bdd-coverage.mjs`
fails the job in the workflow itself, before the script could have been asked.

### Enabling `enforced` is ONE operation

In a single PR, verified together:

1. `bdd_mode: 'enforced'` in the repo's `ci.yml`.
2. `adoption.state: "enforced"` in `bdd/coverage-map.json`, with a `coverageFloor`
   entry for every declared platform.
3. The ruleset context `🔍 Quality Checks / 🧾 BDD Behavior Contract` added — apply
   `expo/github-rulesets/bdd-coverage.json`.
4. **Readback on the merge SHA**: `gh api repos/{owner}/{repo}/rulesets` shows the
   context, and the check ran (not skipped) on that SHA.

Doing 1 without 3 leaves an enforcing job nobody must pass. Doing 3 without 1 leaves
a required context that never reports, which blocks every PR. Neither is a valid
resting state.

`verify_enforced` and `bdd_mode` are independent inputs. `verify_enforced` stays OFF
portfolio-wide; each repo flips `bdd_mode` as its own nightly arms.

## The coverage-floor ratchet

`coverageFloor` is per platform and **may rise, may never fall**. A reduction — or
removing a platform's floor entirely — needs **two artifacts one author cannot
produce alone**:

1. A `coverageFloorBaseline` record naming the exact change:
   `{ platform, from, to, reason, ticket, approvedBy, runUrl, recordedAt }`.
2. The maintainer-applied `bdd-floor-baseline` label on the pull request.

Changing the floor in the same PR that changes the code is not an authorization.
`runUrl` is validated for shape only — the gate never contacts CI or a tracker, so a
merge can never depend on an external service being reachable.

Deleting a scenario is the same move by another route: it shrinks the denominator
instead of the gap. The contract's answer to a retired behavior is `@superseded`,
which keeps the audit trail. A genuine removal needs a `retirements` record
(`{ scenario, reason, ticket, approvedBy, recordedAt }`) **and** the same label.

Both checks need a base revision (`BDD_BASE_SHA`, set from the PR base). Off a pull
request there is no base, and the gate says so rather than passing silently.

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
  "keyUrlTemplate": "https://linear.app/tunnl/issue/{id}",
  "github": { "org": "TunnlAI", "defaultRepo": "frontend", "repos": ["frontend", "wiki"] }
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
| `BDD_MODE` | Adoption state. Unset means `not-adopted`; an unrecognized value exits 2. |
| `BDD_BASE_SHA` | Base revision for the ratchet and deletion checks. |
| `BDD_PR_LABELS` | Comma-separated PR labels, for the `bdd-floor-baseline` authorization. |
| `BDD_EXECUTION_RESULTS` | Comma-separated execution-result documents, same as repeated `--results`. |
| `BDD_COVERAGE_ROOT` | Repo root override, for tests. |
| `BDD_TODAY` | ISO date used for expiry evaluation, for tests and deterministic reruns. |

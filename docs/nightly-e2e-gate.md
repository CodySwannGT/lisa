# Nightly E2E Health gate — contract, truth table, and versioning policy

> **Status:** normative. This document is the specification the reusable
> workflow `.github/workflows/nightly-e2e-health.yml` and the shipped guard
> `typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs` implement.
> Every row of §2 is proven by a named case in Lisa's
> `tests/unit/scripts/nightly-e2e-health.test.ts` (rows 1-16),
> `…-api.test.ts` (rows 17-20), `…-bypass.test.ts` (rows 21-25),
> `…-completeness.test.ts` (row 26) and `…-grace.test.ts` (rows 27-30).
> Changing a row without changing its test is a contract violation.
>
> **Plan revision followed:** `2026-08-12-r3` (Portfolio E2E Standards Plan,
> §5 WS-1a, Appendix A3/A4/A5, plus the r3 allowlist-never-denylist doctrine
> carried over from WS-0a — see §6.2).

## 1. What the gate is, and what it queries

A nightly e2e suite is too slow to run on a pull request. So it runs on a
schedule against a protected branch, and this gate turns *last night's already
produced verdict* into a required status check on every PR. It runs no tests
itself; it costs seconds.

**The gate queries GitHub Actions RUN HISTORY.** It does not dispatch suites, it
does not read artifacts, and it does not "call" the suite workflows.

That last point is a hard constraint of the platform, not a preference: a
reusable workflow's `uses:` value must be a static literal, so a reusable
workflow **cannot** dynamically call an arbitrary list of workflow filenames
supplied at runtime in an input. Any design that reads "the gate runs the suites
named in the table" is impossible. The gate reads
`GET /repos/{owner}/{repo}/actions/workflows/{workflow_file}/runs` and, for
job-scoped suites, `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs`.

Artifacts are deliberately **not** a supported result source. Actions artifacts
are zip archives, and Node ships no zip reader, so consuming them would either
add a dependency to a guard that must stay installable-free or shell out to
`unzip` in a way that cannot be unit-tested. Artifacts also expire (default 90
days, often less), which turns "the evidence aged out" into an unreadable
verdict — the exact fail-open shape this gate exists to refuse.

### 1.1 Match modes, best first

Each suite in the `suites` table declares exactly one match mode. They are
listed here in the order you should prefer them.

| Mode | What it reads | Use when |
|---|---|---|
| `run` | the run's own `conclusion` **and** the conclusion of every job behind it | the whole workflow **is** the suite (e.g. a dedicated `maestro-e2e.yml`) |
| `job` | the `conclusion` of the job whose name is **exactly** the declared string | the suite is one job inside a larger workflow |
| `job_pattern` | the `conclusion` of every job whose name matches an **anchored** regex | last resort only |

`run` reads the jobs as well as the run because **GitHub concludes a run
`success` when its jobs were skipped**. "The whole workflow is the suite" has to
mean the whole workflow actually ran, or a suite narrowed to one arm reports
green about the arm it never touched — see row 26 and §2.4.

**`run` and `job` are the machine-readable contract; `job_pattern` is not.** A
job name is a string the suite publishes on purpose and a repo can pin with a
test (see §5); a regex is an inference *about* that string that keeps passing
while it silently matches nothing else. `job_pattern` is supported because some
existing suites emit matrix job names (`… (android)`, `… (shard 2/4)`) that no
single exact string can cover — and for those, the anchoring rules and the
zero-match rule in §3 are what keep it honest.

For a suite reached through a nested reusable workflow, the job name reported by
the API is `<caller job name> / <called job name>`. That composition is also
what the *required status-check context* looks like, and getting it wrong is how
a gate silently stops gating — see §5.

## 2. The fail-closed truth table

`B` = the bootstrap window is active (see §4) **or** this suite's own first-seen
grace window is (see §4.1) — the two are one rule with two sources, and either
being open softens the same states. Every row is stated for a single suite; the
workflow verdict is the worst verdict across suites, with `bypassed` applied
last (§6).

| # | Observation | B active | After B | Verdict |
|---|---|---|---|---|
| 1 | Fresh run on the required branch (and required SHA, if declared), conclusion `success` | pass | pass | **`pass`** |
| 2 | Conclusion `failure` | fail | fail | **`fail`** |
| 3 | Conclusion `timed_out` | fail | fail | **`fail`** |
| 4 | Conclusion `action_required` | fail | fail | **`fail`** |
| 5 | Conclusion `startup_failure` | fail | fail | **`fail`** |
| 6 | Conclusion `cancelled` | non-blocking | **fail** | `bootstrap` / **`fail`** |
| 7 | Conclusion `skipped` | non-blocking | **fail** | `bootstrap` / **`fail`** |
| 8 | Conclusion `neutral`, `stale`, `null`, or any value not in `DECISIVE_CONCLUSIONS` | non-blocking | **fail** | `bootstrap` / **`fail`** |
| 9 | No run at all in the repository's history | non-blocking | **fail** | `bootstrap` / **`fail`** |
| 10 | Runs exist, but none inside the freshness window | non-blocking | **fail** | `bootstrap` / **`fail`** |
| 11 | Workflow file renamed / deleted (API returns 404 for the declared file) | fail | fail | **`fail`** |
| 12 | Job renamed so `job` finds no job of that name in the newest run | non-blocking | **fail** | `bootstrap` / **`fail`** |
| 13 | `job_pattern` matches **zero** jobs in the newest run | non-blocking | **fail** | `bootstrap` / **`fail`** |
| 14 | `job_pattern` matches ≥1 job; **any** match is non-`success` | fail | fail | **`fail`** |
| 15 | Newest run is on a **different branch** than required | non-blocking | **fail** | `bootstrap` / **`fail`** |
| 16 | `required_sha` declared and the run's `head_sha` differs (stale SHA) | non-blocking | **fail** | `bootstrap` / **`fail`** |
| 17 | Actions API unavailable / 5xx / network error | **fail** | **fail** | **`fail`** after bounded retry |
| 18 | Actions API rate-limited (403/429 with rate-limit headers) | **fail** | **fail** | **`fail`** after bounded retry |
| 19 | API returns 401/403 for auth (token cannot read run history) | **fail** | **fail** | **`fail`** |
| 20 | `suites` input is absent, empty, malformed JSON, or fails schema validation | **fail** | **fail** | **`fail`** |
| 21 | A red or unknown verdict on a PR carrying a **valid** audited bypass | — | — | **`bypassed`** (success, audited) |
| 22 | A red or unknown verdict on a PR carrying an **invalid** bypass (self-bypass, non-maintainer, no reason/ticket, expired) | — | — | **`fail`**, with the rejection reason in the audit |
| 23 | Bootstrap window declared but already expired, and evidence still missing | — | — | **`fail`** |
| 24 | Bootstrap window declared beyond `bootstrap_max_days` from the workflow run date | **fail** | **fail** | **`fail`** (invalid configuration) |
| 25 | Bootstrap window active and evidence missing | non-blocking | — | **`bootstrap`**, summary states the UTC expiry timestamp |
| 26 | `mode: "run"` and the run concluded `success`, but a job behind it did **not**: skipped, `cancelled`, `neutral`, or unreadable (empty job list) | non-blocking | **fail** | `bootstrap` / **`fail`** |
| 26 | `mode: "run"` and the run concluded `success`, but a job behind it concluded `failure` / `timed_out` / `action_required` / `startup_failure` (a `continue-on-error` job) | fail | fail | **`fail`** |
| 27 | A suite declaring `first_seen` inside its grace window, with **missing or unreadable** evidence (any row that resolves to `unknown`: 6–10, 12–13, 15–16, and the skipped-job half of 26) | non-blocking | non-blocking | **`bootstrap`**, the line states this suite's grace expiry — **every other suite stays armed** |
| 28 | A suite inside its grace window with **evidence of failure** (rows 2–5, 11, 14, and the failed-job half of 26) | fail | fail | **`fail`** |
| 29 | A suite whose grace window has **lapsed** (`first_seen + grace_days` is in the past) | as if no grace were declared | as if no grace were declared | the row's own verdict — a lapsed anchor is **inert**, never an error |
| 30 | `first_seen` unparseable, `first_seen` **in the future**, `grace_days` outside `(0, 30]`, `grace_days` without `first_seen`, or `first_seen + grace_days` running beyond `bootstrap_max_days` from the run date | **fail** | **fail** | **`fail`** (invalid configuration) |

### 2.1 Rows 17–19 in one sentence

**"We could not check" never renders as "it is fine."** API failure is retried a
bounded number of times with backoff (`api_max_attempts`, default 3) and then
**fails the check**. There is no configuration that turns an unreachable API
into a pass; the only escape is the audited bypass of row 21, which leaves a
record.

### 2.2 Why rows 6–8 are a change from the inherited implementations

gemini's `check-nightly-e2e.mjs` skips over `cancelled` / `skipped` / `neutral`
to find the newest *decisive* run and, failing that, reports `unknown` and
**passes with a warning**. That is a fail-open path and it is closed here:
`DECISIVE_CONCLUSIONS` is kept as an explicit set — it is the right vocabulary,
and it is what lets the report say *why* a suite is unreadable — but a suite
whose newest in-window run is not decisive resolves to `unknown`, and `unknown`
**fails** once the bootstrap window has closed.

Cancelling a run must never be a one-click way to clear a merge gate. That is
the same false-green shape `check-skipped-required-checks.mjs` exists to refuse:
GitHub counts a *skipped* required check as satisfied, so anything that makes a
red suite report "nothing to say" is a hole in the gate.

### 2.3 `DECISIVE_CONCLUSIONS`

```
success | failure | timed_out | action_required | startup_failure
```

Everything else (`cancelled`, `skipped`, `neutral`, `stale`, `null`, and any
value GitHub adds later) is **indecisive** → state `unknown` → row 8.

The set is closed on purpose: a conclusion GitHub introduces after this file was
written is unknown to us, and an unknown conclusion is not evidence of health.

### 2.4 Row 26 — why a `success` run is not automatically evidence

**GitHub concludes a run `success` when its jobs were skipped.** A skipped job
does not redden the run that contains it. So a suite that narrowed itself —
because a dispatch input filtered it, or because its prerequisites were absent —
finishes green having tested nothing it was asked about, and a gate reading the
run conclusion alone reports that as last night's verdict.

This is not hypothetical. The nightly caller Lisa ships,
`expo/create-only/.github/workflows/maestro-e2e.yml`, exposes a `platform`
dispatch picker (`all` | `android` | `ios`). Dispatching it with
`platform: android` makes the reusable suite's preflight emit `run_ios=false`,
which skips the `🍎 Maestro iOS` job — and the run still concludes `success`.
Read through `{"mode":"run"}`, that one dispatch cleared a **required merge
gate** for the platform it deliberately did not test. It is propswap's trap
verbatim (`91874b83`): *the suite declaring itself green on evidence it never
gathered.*

The **cron** path has the same shape. `maestro-native-e2e.yml` defaults to
`require_prerequisites: false`, so a missing `EXPO_TOKEN` or a deleted flows
directory warns and skips every job — and concludes `success`. Nothing about
that run distinguishes it from a passing suite to a reader of run conclusions.

**The discriminator is "was this run PARTIAL?", never "was this a dispatch?".**
Two independent reasons, and both are load-bearing:

1. **A dispatch must keep counting.** A full, unfiltered `workflow_dispatch` is
   the documented unblock path (§7): it is what makes this gate escapable by
   *fixing* rather than by waiting for tomorrow's cron. A rule of the form
   "dispatch runs do not count" would delete the only non-bypass escape and turn
   every red nightly into a day-long merge freeze.
2. **The filter is unreadable anyway.** The Actions runs API returns no `inputs`
   field on a workflow run — the object carries `event`, `display_title`,
   `actor`, `triggering_actor` and so on, and nothing about what the dispatcher
   typed. Recovering the inputs would mean parsing run *logs*, which are
   artifacts by another name and are refused for the reasons in §1.

Completeness is readable, and it is the property that actually matters: the
gate asks the jobs list whether every job behind a `success` run also succeeded.
That answer covers the filtered dispatch, the prerequisite-skipped cron run, and
a `continue-on-error` job that failed inside a green run — three different
causes of one false green, closed by one condition.

Row 26 splits on **what kind** of shortfall it found, because bootstrap must
keep telling absence apart from failure (§4):

- a **skipped / cancelled / neutral / unreadable** job is *absence of evidence*
  → `unknown`, which bootstrap may forgive and which blocks once the window
  closes;
- a job that **actually failed** inside a green run is *evidence of failure*
  → `fail`, which bootstrap never forgives.

An **empty** job list lands in the first case rather than passing: a completed
run always has at least one job, so an empty list means the gate could not read
them, and "we could not check" never renders as "it is fine" (§2.1).

Row 26 is scoped to `mode: "run"` on purpose. A `job`- or `job_pattern`-scoped
suite has already declared *which* jobs are the suite, and holding it to the
skips of jobs it never claimed — a lint job, a Lighthouse job — would redden
gates that are working correctly.

**If a workflow you declared as `mode: "run"` skips a job on every single run,
it is not a run-scoped suite.** Row 26 is not misfiring on it; the declaration
is wrong. `mode: "run"` asserts *the whole workflow is the suite*, and a
workflow with a permanently-dormant arm has some other job doing the testing.
Name the jobs that are the suite with `mode: "job"` (best) or an anchored
`mode: "job_pattern"` (matrix arms), which is the more precise gate in any case.
The one skip that is *supposed* to redden a run-scoped suite is the dormant
harness itself — a `maestro-native-e2e.yml` whose preflight skipped everything
because `EXPO_TOKEN` is missing tested nothing, and `bootstrap_until` (§4), not
a pass, is how a repo gets breathing room while wiring that up.

## 3. The `suites` input — structured JSON, schema-validated

`suites` is a JSON **array**, passed as a string because `workflow_call` inputs
cannot be objects. It is validated against
`typescript/copy-overwrite/scripts/nightly-e2e-suites.schema.json` before any
API call. It is explicitly **not** a semicolon-delimited mini-language: a
delimiter-joined table has no way to express optional per-suite freshness, no
way to distinguish an exact job name from a pattern, and no way to reject a
duplicate — every one of which is a silent mis-gate.

```yaml
suites: |
  [
    { "label": "Playwright browser e2e",
      "workflow": "ci.yml",
      "match": { "mode": "job", "name": "🔍 Quality Checks / 🎭 Playwright E2E Tests" } },
    { "label": "Maestro native e2e",
      "workflow": "maestro-e2e.yml",
      "match": { "mode": "run" },
      "freshness_hours": 36 }
  ]
```

Validation rules, all of which **fail the check** (row 20) rather than warn:

- The document is an array with at least one entry.
- Every entry has a non-empty `label` and `workflow`.
- **`label` values are unique** (case-sensitively). Two suites sharing a label
  produce one report line for two verdicts.
- **`workflow` + `match` pairs are unique.** The same suite declared twice is a
  copy-paste error, and a duplicate can mask a typo in the one you meant.
- `match.mode` is one of `run` | `job` | `job_pattern`.
- `mode: "job"` requires a non-empty `name`; `mode: "job_pattern"` requires a
  non-empty `pattern`.
- **A `pattern` must be anchored at both ends** (`^…$`). An unanchored regex is
  a substring test wearing a regex's clothes: `Playwright` matches
  `Playwright (skipped placeholder)`. Rejected at validation time, not at match
  time, so the failure names the config rather than a run.
- A `pattern` must compile, and is compiled **without** the `g` flag (a sticky
  `lastIndex` makes repeated `.test()` calls return alternating answers).
- `freshness_hours`, when present, is a number in `(0, 720]`.
- `first_seen`, when present, is a non-empty ISO-8601 UTC timestamp that is not
  in the future, and `grace_days` is a number in `(0, 30]` that **requires**
  `first_seen` (§4.1, rows 27–30). Both fail the check rather than being
  clamped, because a forgiveness window quietly widened is a gate that is looser
  than it reads.
- Unknown keys are rejected. A typo'd `freshnessHours` that silently takes the
  default is a gate that is looser than its author believes.

`job_pattern` **matching zero jobs is an error** (row 13), never "nothing to
report". Zero matches is the exact signature of a renamed job, and a renamed job
is how a gate stops gating without anyone noticing.

## 4. Bootstrap — time-boxed, with a visible expiry

A gate that blocks a repository the day it is installed teaches everyone to
bypass it. So the gate ships with a bootstrap window during which *missing or
unreadable* evidence is reported but does not block. propswap's equivalent has
no expiry at all, which means a suite that never runs passes forever — the
window here is mandatory and bounded.

- `bootstrap_until` — an **ISO-8601 UTC timestamp** (e.g.
  `2026-09-15T00:00:00Z`). Absent (the default) means **no bootstrap window**:
  the gate is fully armed from the first run.
- `bootstrap_max_days` — default `30`. A `bootstrap_until` further into the
  future than this many days *from the moment the gate runs* is **invalid
  configuration and fails the check** (row 24). This is what stops the window
  being extended indefinitely by editing one string: past the cap, extending it
  requires changing the cap too, which is a reviewable act.
- While the window is active, every **`unknown`** suite renders as
  `⚠️ bootstrap — not blocking; this window expires <timestamp> (in N days)`,
  in the job summary and in the job's `verdict` output. The expiry is always
  visible; there is no quiet bootstrap.
- **Genuinely red evidence still fails during bootstrap.** Rows 2–5, 11, 14,
  17–20 and the failed-job half of row 26 are red inside the window as well as
  outside it. Bootstrap forgives *absence of evidence*, never *evidence of
  failure*.
- The moment the window lapses, rows 6–10, 12–13, 15–16 and the skipped-job half
  of row 26 flip to `fail` with no further action (row 23). Nothing needs to be
  turned on.

### 4.1 Per-suite first-seen grace — adding a suite is not an outage

`bootstrap_until` is **workflow-global**, and that made the routine act of
*adding a suite* a repository-wide wedge. The moment a fourth suite lands in the
`suites` table of an armed repo its evidence is missing (row 9), so **every pull
request is blocked** from the edit until that suite's first green nightly. The
only escapes were re-opening the global window — which un-arms the three suites
that were already working — or burning an audited bypass. Neither is
proportionate to adding a suite, and both teach people that the gate is
something to route around rather than something to satisfy.

So a suite may carry its own window:

```json
{ "label": "Playwright browser e2e",
  "workflow": "ci.yml",
  "match": { "mode": "job", "name": "🔍 Quality Checks / 🎭 Playwright E2E Tests" },
  "first_seen": "2026-08-10T00:00:00Z" }
```

- `first_seen` — ISO-8601 UTC, the **anchor**: when this suite entered the
  table. `grace_days` (default **14**) is how long after it the window runs.
- While that window is open, this suite's **`unknown`** rows render as
  `⚠️ … not yet blocking — new suite (first seen …); its grace expires <ts>`, and
  **nothing else changes**: the other suites keep their own verdicts, so three
  armed suites stay armed while the fourth finds its feet.
- **Grace forgives absence of evidence, never evidence of failure** (row 28) —
  the same rule as bootstrap, not a second, looser one.
- A **lapsed** anchor is inert (row 29). Cleaning the field up is optional on
  purpose: a guard that fails on stale config buys a churn commit per suite per
  month, and the first person to hit that deletes the anchor rather than the
  window.

**Why this is not the forever-bootstrap §4 exists to refuse.** The window is not
a date somebody types; it is derived from an anchor, and three rules bound it
(all row 30, all failing as *misconfiguration* rather than clamping, exactly as
row 24 does):

1. **`first_seen` may not be in the future.** A future anchor is a hand-typed
   expiry under another name, extendable forever by one string edit. Because it
   must be in the past, the *most* grace any edit can ever buy is one window
   from today — the same thing deleting and re-adding the suite would buy, and
   it says so in the diff: rolling the anchor forward is writing "this suite is
   new" about a suite that is not, where a reviewer reads it.
2. **`grace_days` is capped at `BOOTSTRAP_ABSOLUTE_MAX_DAYS` (30)** by schema
   validation, and requires `first_seen` — a grace length with no anchor
   forgives nothing while reading as though it forgives everything.
3. **The resolved window may not run beyond `bootstrap_max_days`** from the
   moment the gate runs. Per-suite grace spends from the *same forgiveness
   budget* as the global window, so a repo that tightened the cap to a week
   cannot buy a fortnight through the side door.

**Use it instead of re-opening `bootstrap_until`.** Widening the global window
to admit one new suite un-arms every suite that was working; the anchor is the
narrow tool for the narrow problem.

## 5. The context-name identity — two strings that disarm the gate silently

Both of these break with no error at all. The gate simply stops gating, and the
next person to look finds a green checkmark that measured nothing.

1. **The check's context name is `<caller job name> / <reusable job name>`.**
   GitHub composes the check-run name from the caller's job `name:` and the
   called workflow's job `name:`. The ruleset must require that *composite*
   string, byte for byte, emoji included.
2. **The ruleset's required context is a hand-entered string** living outside
   the repository. Rename either half of (1) and GitHub waits forever for a
   context nobody reports — which does not "de-gate" the branch, it
   **deadlocks** every PR into it.

`tests/integration/nightly-e2e-health-workflow.test.ts` pins all three strings
against each other: the reusable's job name, the create-only caller template's
job name, and the `context` value in
`expo/github-rulesets/nightly-e2e-health.json`. The adopter-side equivalent is
`typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs`, which
additionally catches the *other* direction of this failure: a ruleset requiring
a context that the repo's CI unconditionally skips. GitHub counts a **skipped**
required check as **satisfied**, so that combination enforces nothing while
looking fully armed. It is the defect that made gemini's `playwright` ruleset
decorative, and it is why `expo/github-rulesets/playwright.json` is deleted by
this change rather than fixed.

## 6. The bypass contract (Appendix A4 — owner ruling, ratified 2026-08-12)

A gate that reads *last night's* verdict cannot be cleared by the PR that fixes
last night's failure — the nightly stays red until the fix merges and runs.
Deadlock by construction. The escape hatch is a **single audited bypass label**,
and it is the *only* sanctioned path past a red gate: there is **no
admin-merge-past-red**. An unaudited admin merge and an audited bypass differ
precisely in whether anyone can find out afterwards.

A bypass is valid only when **all** of the following hold. Any failure is row 22
— the check goes **red**, and the audit says which condition failed.

| Condition | Why |
|---|---|
| The PR carries the label named by `bypass_label` (default `nightly-e2e-bypass`). | The trigger. |
| The **actor who applied the label** has repository permission `admin` or `maintain`. | "Maintainers only." Read from `GET /repos/{repo}/collaborators/{login}/permission`; the labelling actor is read from the newest matching `labeled` event on the PR timeline. |
| The labelling actor is **not** the PR author. | **No self-bypass.** A bypass one person can both request and grant is not a control. |
| The PR body contains a line matching the built-in `^Nightly-E2E-Bypass:\s*(?<ticket>[A-Z][A-Z0-9]+-\d+|#\d+)\s+(?<reason>\S.*)$`, **and** the optional `bypass_reason_pattern` if one is configured. | A reason **and** a tracker reference, in the artefact reviewers already read. The built-in rule always applies; a configured pattern is an AND, never a replacement (§6.2). |
| The label was applied no more than `bypass_max_hours` ago (default `24`, **source-constant** ceiling `72`). | **Auto-expiry.** A label nobody removes must not be a permanent hole. Past the window the bypass simply stops working. |

When all conditions hold the gate emits verdict **`bypassed`** — a *successful*
check, distinct from `pass`, that carries an immutable audit record:

```json
{
  "verdict": "bypassed",
  "blocked": false,
  "bypass": {
    "valid": true,
    "reason": "valid",
    "label": "nightly-e2e-bypass",
    "actor": "<login>",
    "actorPermission": "maintain",
    "prAuthor": "<login>",
    "prNumber": 123,
    "appliedAt": "2026-08-12T09:14:02.000Z",
    "expiresAt": "2026-08-13T09:14:02.000Z",
    "ticket": "SE-6899",
    "detail": "harness outage, no re-run can turn this green",
    "waived": [
      { "label": "…", "state": "fail", "conclusion": "failure", "url": "…" }
    ]
  }
}
```

This is the **emitted** shape, key for key — a rejected bypass carries the same
keys with `valid: false` and `reason` naming the rule that failed. §8 makes
`audit_json` part of the output schema, so adopters may parse it; it is asserted
against the implementation by
`tests/unit/scripts/nightly-e2e-health-bypass.test.ts`.

written to `$GITHUB_STEP_SUMMARY`, to stdout, to the job output `audit_json`,
and echoed as a `::notice::` annotation so it is visible on the checks surface.
A `pass` verdict ignores the label entirely — a stale label on a green PR must
not read as though it did something.

### 6.2 Allowlist, never denylist — and limits are source constants

This is portfolio doctrine (plan r3, carried from WS-0a), and applying it to
this gate found **two real fail-open holes in the guard's own configuration**
before it shipped:

1. `bypass_reason_pattern` was an override that **replaced** the built-in reason
   rule. Setting it to `.*` would have satisfied "a reason and a ticket are
   required" against a completely empty PR body.
2. `bootstrap_max_days` was read straight from the environment. Setting
   `NIGHTLY_BOOTSTRAP_MAX_DAYS=100000` would have restored precisely the
   forever-bootstrap (§4) this gate exists to delete.

Both are closed by the same three rules, which every future change to this file
must keep:

- **Allowlist, never denylist.** The roles that may grant a bypass are the
  explicit set `{admin, maintain}`. Never "anything except `read`/`triage`" — a
  denylist of the roles we know about today silently admits whatever GitHub adds
  tomorrow. Same shape as `DECISIVE_CONCLUSIONS` (§2.3): a conclusion outside the
  known-good set is `unknown`, not "probably fine".
- **Limits are source constants, never env-readable.**
  `BYPASS_ABSOLUTE_MAX_HOURS`, `BOOTSTRAP_ABSOLUTE_MAX_DAYS`,
  `ABSOLUTE_MAX_FRESHNESS_HOURS`, `ABSOLUTE_MAX_API_ATTEMPTS` and
  `REQUIRED_BYPASS_REASON_PATTERN` live in the guard. Workflow inputs can only
  **tighten** them. A request above a ceiling is clamped **down** and reported in
  the job summary — never silently, so a gate is never quietly stricter than its
  configuration reads.
- **One shared resolution function, resolved at call time.**
  `resolveSecurityLimits()` is the single place a ceiling is applied, called from
  `resolveSettings(env)` per invocation — never captured at module load, where an
  early import would freeze the limits for everything after it. Fail-closed only
  has to be right once.

`bootstrap_until` is the one deliberate exception to clamping: it **fails**
rather than being pulled closer (row 24), because it is a date somebody chose and
quietly moving it would arm the gate on a day nobody expected. Numeric ceilings
clamp because clamping toward strictness cannot fail open.

### 6.1 Auto-removal happens on merge, not on use

"Auto-removes after use" cannot mean "the gate removes the label when it
evaluates," and this trap is worth stating because the obvious implementation is
wrong: removing the label fires `unlabeled`, which re-runs the gate, which now
sees no bypass and goes **red** — the PR is blocked again by the mechanism meant
to unblock it. So removal is a separate, single-purpose workflow
(`expo/create-only/.github/workflows/nightly-e2e-bypass-reaper.yml`) triggered on
`pull_request: closed`, which strips the label from the merged/closed PR. The
reusable gate itself needs **no write permission** as a result.

Expiry (`bypass_max_hours`) is the belt to that suspenders: even if the reaper
is not installed, a bypass label stops working after its window.

## 7. Permissions, tokens, pagination, rate limits, reruns, concurrency

**Minimum permissions** for the caller job:

```yaml
permissions:
  contents: read   # actions/checkout of the caller repo
  actions: read    # the entire point: reading other workflows' run history
```

`pull-requests: read` is additionally required **only** when the bypass path is
enabled on a **private** repository — the PR timeline and collaborator
permission reads are otherwise covered by `contents: read` on public repos. The
reusable requests nothing else and **never** requests write.

**Token behaviour.** The default `${{ github.token }}` can read run history and
collaborator permission for the repository it runs in, which is the only
repository this gate reads. There is deliberately **no cross-repo mode**: a
gate that reads another repository's runs needs a PAT/App token whose blast
radius exceeds the gate's value. On a **private** repository the default token
works unchanged; what does *not* work is a fork PR, where `github.token` is
read-only and the `pull_request` event carries no privileged context. Fork PRs
therefore get the same treatment as any other missing evidence: `bypass` is
unavailable (the timeline read fails → row 22), and the suite verdicts still
resolve normally because run history is readable.

**Pagination.** Run listing needs none: the request is filtered by
`workflow file + branch + status=completed + event` and asks for `per_page=1`,
and the API returns newest-first, so page 1 *is* the answer. That is two
requests per suite (one per counted event), and the newest of the two wins.
Job listing (`/runs/{id}/jobs?filter=latest`) **does** paginate, to exhaustion
up to `api_max_pages` (default 5), because a matrix suite routinely exceeds one
page and a truncated job list turns "the failing shard is on page 2" into a
false green. Exhausting the page cap while pages are still full is **red**, not
a partial read. Jobs are listed for **every** match mode, `run` included — row
26 needs them to tell a complete run from one that skipped half of itself.

**Rate limits.** A 403/429 carrying `x-ratelimit-remaining: 0` is retried after
`x-ratelimit-reset` (bounded by `api_retry_max_seconds`, default 60) up to
`api_max_attempts` (default 3), then **fails** (row 18). Secondary rate limits
(`retry-after`) are honoured the same way. The gate issues at most
`1 + suites × 3` requests on the happy path (two run lookups plus one job page),
which is negligible against the 5 000/hour installation limit even with every PR
re-running it.

**Reruns.** A re-run of the *gate* re-reads history and can legitimately change
verdict — that is the unblock path working (re-dispatch the suite, re-run the
check). A re-run of a *suite* creates a new run whose `created_at` is newer, so
it supersedes; a re-run of a *failed job within* an existing run mutates that
run's conclusion in place, and because the gate always reads the run's current
conclusion rather than a cached one, a rerun-to-green is picked up immediately.
`workflow_dispatch` runs count exactly like `schedule` runs, by design: that is
what makes the gate escapable by *fixing* rather than by *waiting*. Dispatch
runs are still branch-filtered — a dispatch from someone's feature branch must
never clear the gate for everybody — and, since row 26, they must still be
**whole**: a dispatch that narrowed the suite with a platform / tag / shard
picker leaves a skipped job and does not clear the gate. Leave the picker on its
`all` default when dispatching to unblock. Nothing about *being* a dispatch
disqualifies a run; being a partial one does (§2.4).

**Concurrency.** Gate evaluations are idempotent reads with no shared state, so
the caller template uses a per-PR `concurrency` group with
`cancel-in-progress: true`. Two evaluations racing cannot corrupt anything; the
newer one wins and reports. Note the interaction with row 6: a *cancelled gate
run* reports no check at all (GitHub marks it cancelled), which leaves the
required context unreported and the PR blocked until the newer run reports —
blocked, not passed. Fail-closed holds through cancellation.

## 8. Versioning, compatibility, and rollback (Appendix A5)

**"Lisa reaches every repo at once" is false.** A reusable workflow is consumed
at a ref, and a copy-overwrite script is consumed at whatever Lisa release the
repo last applied. Both are per-repo adoption events.

- **Consumers pin an immutable ref.** The caller template ships pinned to a tag
  (`@vX.Y.Z`), not `@main`. Lisa's other caller templates still use `@main`;
  that is a pre-existing fleet-wide gap, not a licence to add another one.
  Pinning to a tag is the floor; pinning to the tag's commit SHA with the tag in
  a trailing comment is better and is what the template documents.
- **The gate's contract version is `NIGHTLY_E2E_CONTRACT_VERSION`**, exported by
  the guard script and asserted by the reusable workflow. The two halves travel
  by different routes (workflow by git ref, script by `lisa apply`) and *will*
  drift. On a **major** mismatch the gate **fails closed** with a message naming
  both versions and the fix. A minor/patch skew is allowed and reported.
- **Compatibility policy.**
  - *Major* — removing or renaming an input, removing an output field, changing
    a verdict for an unchanged observation (i.e. editing a row of §2), or
    tightening schema validation so a previously valid `suites` document is
    rejected.
  - *Minor* — adding an optional input with a fail-closed-safe default, adding
    an output field, adding a match mode, adding a `DECISIVE_CONCLUSIONS`
    member, or **adding a §2 row that can only turn a previously-*passing*
    observation into a blocking one, never the reverse**.
  - The last clause is what row 26 shipped under, and it is narrow on purpose.
    The major-mismatch assertion exists to stop the two halves running *a
    contract neither agrees on*; the workflow half carries **no** §2 logic at
    all — every row lives in the guard — so a strictly-tightening row cannot
    make a skewed pair looser than either half intends, only stricter. Anything
    that could turn a *blocking* observation into a passing one is still major,
    because that skew direction fails **open**, which is the one outcome the
    version check exists to prevent.
  - **Rows 27–30 (per-suite grace) shipped as `1.2.0`, a minor**, and the
    reasoning is worth stating because the rows point the *other* way — they can
    make a currently-blocking suite non-blocking. What the major rule protects
    against is a **verdict changing for an unchanged observation**, and it does
    not: for every `suites` table that exists today — none of which carries
    `first_seen` — the findings are byte-identical. The verdict moves only when
    an operator *adds* a field, which is the "optional input with a
    fail-closed-safe default" minor clause, with the default being *absent* and
    therefore fully armed. Both skew directions still fail closed: a new guard
    under an old caller sees no anchors and behaves as before, and an old guard
    under a table carrying `first_seen` rejects the unknown key as row 20 —
    loudly, naming the config. A major bump would meanwhile **red-wall every
    adopter pinned to an older tag** (the workflow asserts the guard's major)
    for a change that cannot fail open, which trades a real outage for a
    theoretical one.
  - *Patch* — message wording, docs, internal refactors, test-only changes.
  - **Inputs are never repurposed.** A removed input keeps its name reserved and
    is rejected with a pointer to its replacement, rather than being silently
    ignored — an ignored input is a gate configured differently than its author
    believes.
- **Output schema.** `verdict` (`pass|fail|bypassed|bootstrap`),
  `blocked` (boolean), `audit_json` (the full record). Fields are added, never
  removed or retyped, inside a major.
- **Rollout.** Canary repo → one batch → remainder, with a stop condition of
  *any* adopter seeing a verdict its maintainer disputes. **Rollback is
  re-pinning the caller to the prior tag** — the guard script rolls back with
  `lisa apply` at the prior Lisa release. Because the workflow asserts the
  script's contract major, a half-rolled-back pair fails loudly instead of
  running a mismatched contract.
- **Deprecation window.** A major bump keeps the previous major's tag live and
  supported for 90 days; the release notes name every adopter that must move.

## 9. What this replaces

| Was | Where | Now |
|---|---|---|
| Node script, one repo | tunnl `scripts/check-nightly-e2e-health.mjs` | the shipped guard (its bypass model and context-pinning test are the ancestors of §5/§6) |
| Bash + `gh` + `jq` library | propswap `.github/scripts/nightly-e2e-lib.sh` | the shipped guard; its job-name filter becomes `match.mode: "job"`; its unbounded bootstrap becomes §4, and the per-suite half of it §4.1 |
| Second Node script, `unknown`-passes | gemini `scripts/check-nightly-e2e.mjs` | the shipped guard; `DECISIVE_CONCLUSIONS` kept, the fail-open path closed (§2.2) |
| A ruleset requiring a PR-skipped context | Lisa `expo/github-rulesets/playwright.json` | **deleted**, replaced by `expo/github-rulesets/nightly-e2e-health.json` |

### 9.1 Deleting the `playwright` ruleset is a two-step

Ruleset templates are **not** copied into host repositories — `lisa apply` reads
`<type>/github-rulesets/*.json` and pushes them to the GitHub API through
`scripts/lisa-github-rulesets.sh`. So deleting the template stops Lisa from
*re-creating or updating* the bad ruleset, but it does **not** remove a ruleset
already live on a repository, and `deletions.json` (which removes host *files*)
has no bearing on it.

Every repo that received it must delete the live ruleset explicitly:

```bash
gh api "repos/$REPO/rulesets" --jq '.[] | select(.name=="playwright") | .id'
gh api -X DELETE "repos/$REPO/rulesets/<id>"
```

That is an adopter-PR step, not a Lisa step, and it is called out in the adopter
checklist for exactly the reason the ruleset is being deleted: a required
context that PRs skip **looks** like enforcement and is not.

# Nightly E2E Health gate — contract, truth table, and versioning policy

> **Status:** normative. This document is the specification the reusable
> workflow `.github/workflows/nightly-e2e-health.yml` and the shipped guard
> `typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs` implement.
> Every row of §2 is proven by a named case in Lisa's
> `tests/unit/scripts/nightly-e2e-health.test.ts` (rows 1-16),
> `…-api.test.ts` (rows 17-20), `…-bypass.test.ts` (rows 21-25),
> `…-completeness.test.ts` (row 26), `…-issues.test.ts` (rows 27-31) and
> `…-grace.test.ts` (rows 32-35).
> Changing a row without changing its test is a contract violation.
>
> The gate has **two halves that must not be confused**: the blocking half
> (`nightly-e2e-health.yml`, a required status check that never writes) and the
> reporting half (`nightly-e2e-report.yml`, a scheduled job that files and closes
> tracking issues and gates nothing). §2 is the blocking half; §10 is the
> reporting half.
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

Rows 1–26 and 32–35 are the **blocking** half: they answer "may this pull
request merge?". Rows 27–31 live in §10 and answer a different question — "what
should the tracking issue say?" — decided by a different workflow that gates
nothing. The numbering is shared so a row is citable by number alone; the halves
are not, which is why the blocking rows are not contiguous.

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
| 22 | A red or unknown verdict on a PR carrying an **invalid** bypass (non-maintainer, unattributable, no reason/ticket, expired) | — | — | **`fail`**, with the rejection reason in the audit |
| 23 | Bootstrap window declared but already expired, and evidence still missing | — | — | **`fail`** |
| 24 | Bootstrap window declared beyond `bootstrap_max_days` from the workflow run date | **fail** | **fail** | **`fail`** (invalid configuration) |
| 25 | Bootstrap window active and evidence missing | non-blocking | — | **`bootstrap`**, summary states the UTC expiry timestamp |
| 26 | `mode: "run"` and the run concluded `success`, but a job behind it did **not**: skipped, `cancelled`, `neutral`, or unreadable (empty job list) | non-blocking | **fail** | `bootstrap` / **`fail`** |
| 26 | `mode: "run"` and the run concluded `success`, but a job behind it concluded `failure` / `timed_out` / `action_required` / `startup_failure` (a `continue-on-error` job) | fail | fail | **`fail`** |
| 32 | A suite declaring `first_seen` inside its grace window, with **missing or unreadable** evidence (any row that resolves to `unknown`: 6–10, 12–13, 15–16, and the skipped-job half of 26) | non-blocking | non-blocking | **`bootstrap`**, the line states this suite's grace expiry — **every other suite stays armed** |
| 33 | A suite inside its grace window with **evidence of failure** (rows 2–5, 11, 14, and the failed-job half of 26) | fail | fail | **`fail`** |
| 34 | A suite whose grace window has **lapsed** (`first_seen + grace_days` is in the past) | as if no grace were declared | as if no grace were declared | the row's own verdict — a lapsed anchor is **inert**, never an error |
| 35 | `first_seen` unparseable, `first_seen` **in the future**, `grace_days` outside `(0, 30]`, `grace_days` without `first_seen`, or `first_seen + grace_days` running beyond `bootstrap_max_days` from the run date | **fail** | **fail** | **`fail`** (invalid configuration) |
| 36 | The run concluded `success` and every job behind it did too, but the run **recorded itself as tag-filtered** (`maestro-<platform>-scope-filtered`) on any platform | non-blocking | **fail** | `bootstrap` / **`fail`** |
| 37 | The suite declares `min_flows` and the run's executed-flow count (`maestro-<platform>-flowcount-<N>`, summed across platforms) is **below** it | non-blocking | **fail** | `bootstrap` / **`fail`** |
| 38 | The suite declares `min_flows` and the count **cannot be read**: the artifacts list 404s, the page walk truncates, or no `flowcount` marker was published | non-blocking | **fail** | `bootstrap` / **`fail`** |
| 39 | Any arm published `maestro-<platform>-flowcount-0` — it executed ZERO flows. **No `min_flows` required** | non-blocking | **fail** | `bootstrap` / **`fail`** |
| 40 | A pull request whose LIVE labels and body cannot be read — 404, an unreadable API, a missing `pull-requests: read` scope, or a response carrying no `labels` array | — | — | **`fail`**, bypass rejected `pr_state_unreadable`; **never** falls back to the event payload (§6.3) |

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
gate** for the platform it deliberately did not test. It is acmeorga's trap
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
2. **The filter is unreadable from the API.** The Actions runs API returns no
   `inputs` field on a workflow run — the object carries `event`,
   `display_title`, `actor`, `triggering_actor` and so on, and nothing about what
   the dispatcher typed. (Re-verified 2026-08-18 against AcmeOrgD/frontend run
   `32120016803`.) Recovering the inputs by parsing run *logs* is refused for the
   reasons in §1. What the run **can** do is write its own scope down where the
   list API will report it, and since §2.5 it does.

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

### 2.5 Rows 36–39 — a run that tested a SLICE is not a green suite

Row 26 asks whether every **job** ran. It cannot see inside a job, so it cannot
see the other way a green run proves nothing: **a job that ran, passed, and
tested a hand-picked handful of flows.**

Measured 2026-08-18, and this is the defect that produced these rows:

- **AcmeOrgB/frontend — the case row 26 cannot see.** The only `success` in
  recent maestro history published `maestro-android-flowcount-4` and
  `maestro-ios-flowcount-4`. Unfiltered runs of the same suite in the same window
  published `flowcount-81`/`flowcount-80` and `flowcount-83`/`flowcount-82`, and
  the repository carries 109 flow files. So that green ran **8 flows out of
  ~160 flow-executions**, about **5%** of the suite.

  Every job in it concluded `success` — nothing was skipped, nothing failed under
  `continue-on-error`. **Row 26 has nothing to catch.** It is a structurally
  complete run that tested a twentieth of the app, and because a filtered dispatch
  reports `success` under the identical workflow name, `gh run list` renders it
  indistinguishably from a full green. This is the case that makes row 37 load-
  bearing rather than belt-and-braces: the executed-flow count is the *only*
  signal that distinguishes it.
- **AcmeOrgD/frontend.** Its nightly gate is a **required context**, and it was
  satisfied by run `32120016803`: iOS green, Android skipped, and the run's own
  published artifact name reading `maestro-ios-flowcount-7`. **Seven flows
  cleared a merge gate for a suite of eighty.**

#### Two signals, and both are required

| # | Signal | Where it comes from | What only it can catch |
|---|---|---|---|
| 36 | **Scope** — the run's own recorded inputs | `maestro-<platform>-scope-<full\|filtered>` | a filter that narrowed the suite *before* any flow ran, including one that leaves a plausible-looking count |
| 37 | **Count** — flows actually executed | `maestro-<platform>-flowcount-<N>` | a run narrowed by any *other* mechanism, and every run predating the scope marker |

Neither alone is enough. The scope marker reads the filter itself and is the
definitive signal, but it is **absent on every historical run** and on any suite
that is not maestro. The count has shipped for longer and catches narrowing by a
`flows_dir` override or a hand-edited flow list, which no input records — but it
needs a denominator to compare against.

#### Both travel as artifact NAMES

The gate reads artifact **names** and never artifact **content**, and that line
is the whole design. Downloading is still refused for §1's reasons — zip
archives, no Node zip reader, bytes that expire. A name has neither problem: it
comes back in the artifacts LIST in one cheap call with no download, and **the
name outlives the bytes**, so an expired artifact still answers "how many flows
did that night run?".

#### Where fail-closed actually lives

| # | Observation | Verdict |
|---|---|---|
| 36 | A run that recorded ITSELF as filtered on any platform | **`unknown`** — unconditional, no declaration needed |
| 37 | Suite declares `min_flows` and the run executed fewer | **`unknown`** |
| 38 | Suite declares `min_flows` and the count cannot be read at all — unreadable list, truncated page walk, or no marker published | **`unknown`** |
| 39 | Any arm executed **zero** flows | **`unknown`** — unconditional, no declaration needed |

Row 38 is the one that stops this fix reproducing the defect it fixes. **An
unreadable count is exactly what a narrowed run looks like from here**, so "we
could not check" must never render as "it is fine".

**Row 39 needs no declaration either, and the reason it is separate from row 37
matters.** "Fewer than the suite declares" is a threshold judgement and needs a
denominator. **"Tested nothing" is not a judgement at all.** Any floor a repo
could sensibly declare is ≥ 1, so rejecting zero cannot contradict a
declaration — and requiring one before disbelieving a zero-flow green would be
asking permission to notice that nothing ran.

Row 39 is **per-arm, never on the total.** A night that ran 40 Android flows and
0 iOS ones sums to 40 and clears any sane floor, while having proved nothing
whatsoever about iOS. Summing first lets a healthy arm launder a dead one, which
is the same arithmetic mistake as reading a suite's green off whichever platform
happened to work.

This row exists because a consumer hit it and built its own fix. AcmeOrgB/frontend
carries `scripts/check-nightly-e2e-flow-coverage.mjs` — 368 lines, the same
artifact-name mechanism as rows 36-38, arrived at independently — which blocks on
`arms.some(arm => arm.executed === 0)` **with no configuration at all.** Until
row 39 existed, adopting this reusable and retiring that fork would have silently
dropped zero-flow protection from every suite that had not declared `min_flows`.
That is convergence onto something that was not yet a superset, and it is the
specific failure mode fork-retirement work has to avoid.

Rows 37 and 38 require a declared `min_flows`; rows 36 and 39 do not. That asymmetry is
deliberate and it is where the honest limit sits. **A floor cannot be inferred.**
This gate reads suites it did not write, including non-maestro ones that publish
no counts at all, and a guessed denominator would either forgive everything or
red-wall every consumer on the day it shipped. Declaring `min_flows` is the act
of asserting *this suite publishes counts* — and from that moment an unreadable
count blocks.

A suite with no `min_flows` still gets row 36, and its green line **says out loud
which question went unasked** — quoting the count when the run published one:

```
✅ Maestro E2E — green (…) — ⚠️ scope unverified: this run executed 8 flow(s), and no
`min_flows` is declared for this suite, so the gate cannot tell whether that is the
whole suite or a slice of it. Compare it against a known-full night and declare
`min_flows` to make this a blocking question
```

A silent green there would be the same reading error one layer up.

**The notice fires on "the run never asserted it was unfiltered", not on "no
count was published"** — and that distinction was found by running the guard
against AcmeOrgB's real run rather than by reading the code. That run publishes
`flowcount-4` on both arms, so a count-based condition read it as *verified* and
printed a clean green. Its 8-of-~160 flows are the precise false green rows 36-38
exist to catch, and the gate would have said nothing about it. **Knowing the
number is not the same as being able to judge it.** Only a declared `min_flows`
or the run's own `scope-full` marker settles the question; a count with neither
is evidence the gate is holding but cannot interpret, so it prints the number and
says so.

**A suite that publishes no counts at all keeps that notice permanently, and
that is correct rather than a nag to suppress.** A Playwright suite cannot
satisfy `min_flows` — nothing in it writes a `flowcount` marker — so the gate
genuinely cannot tell whether it ran two specs or two hundred. The line says so
and stops short of prescribing an action that suite cannot take. Closing that
properly means teaching the browser suite to publish its own executed-spec count
under the same convention, which is a separate change; until then the honest
report is that the question is open.

All three rows resolve to `unknown`, never `fail` — a narrowed run is *absence of
evidence* about the flows it skipped, not evidence that they are broken. They
therefore sit on the same side of the line as the skipped-job half of row 26, so
bootstrap (§4) and per-suite grace (§4.1) forgive them on identical terms. That
is what lets a repo arm these rows without wedging itself.

#### Adopting it

1. Re-pin the caller to a Lisa tag at or after this change, so
   `maestro-native-e2e.yml` publishes the scope marker.
2. Read the real number off a recent FULL night's
   `maestro-<platform>-flowcount-<N>` artifact names — every completed run
   carries them, and they survive the retention window — then declare `min_flows`
   a little under the sum so ordinary churn does not redden the gate. For a suite
   whose full nights read `flowcount-81` and `flowcount-80`, `min_flows: 150` is
   about right; it clears a normal night by 11 and rejects the 8-flow run above
   by a factor of eighteen.

   Do **not** derive it from the flow-file count. 109 files produced ~160
   flow-executions across two platforms, and the ratio is not something to
   predict — read what the suite actually publishes.
3. Expect the first armed night to be **red** where a filtered run was previously
   passing. That red is the correct reading of evidence that was always there.

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
      "match": { "mode": "job", "name": "🔍 Quality Checks / 🎭 Browser Journeys" } },
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
  `first_seen` (§4.1, rows 32–35). Both fail the check rather than being
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
unreadable* evidence is reported but does not block. acmeorga's equivalent has
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
  "match": { "mode": "job", "name": "🔍 Quality Checks / 🎭 Browser Journeys" },
  "first_seen": "2026-08-10T00:00:00Z" }
```

- `first_seen` — ISO-8601 UTC, the **anchor**: when this suite entered the
  table. `grace_days` (default **14**) is how long after it the window runs.
- While that window is open, this suite's **`unknown`** rows render as
  `⚠️ … not yet blocking — new suite (first seen …); its grace expires <ts>`, and
  **nothing else changes**: the other suites keep their own verdicts, so three
  armed suites stay armed while the fourth finds its feet.
- **Grace forgives absence of evidence, never evidence of failure** (row 33) —
  the same rule as bootstrap, not a second, looser one.
- A **lapsed** anchor is inert (row 34). Cleaning the field up is optional on
  purpose: a guard that fails on stale config buys a churn commit per suite per
  month, and the first person to hit that deletes the anchor rather than the
  window.

**Why this is not the forever-bootstrap §4 exists to refuse.** The window is not
a date somebody types; it is derived from an anchor, and three rules bound it
(all row 35, all failing as *misconfiguration* rather than clamping, exactly as
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

## 6. The bypass contract (Appendix A4 — owner ruling, ratified 2026-08-12; amended 2026-08-19)

A gate that reads *last night's* verdict cannot be cleared by the PR that fixes
last night's failure — the nightly stays red until the fix merges and runs.
Deadlock by construction. The escape hatch is a **single audited bypass label**,
and it is the **preferred** path past a red gate. An unaudited admin merge and
an audited bypass differ precisely in whether anyone can find out afterwards,
which is the entire argument for reaching for the label first: the bypass is the
only route past this gate that records *who* waived *what*, under which ticket,
and when the waiver expires.

**Whether an admin merge is also possible is a property of the consuming
repository's ruleset, not of this contract — and neither this document nor the
gate can tell you.** Check `bypass_actors` on the ruleset that requires the gate
context, via `GET /repos/{owner}/{repo}/rules/branches/{branch}` for the
*effective* rules and then the ruleset itself. A `RepositoryRole` actor with
`bypass_mode: always` means admins can merge past a red gate on that deployment;
its absence means they cannot.

> **Amendment — 2026-08-19.** As ratified on 2026-08-12 this section read: *"it
> is the only sanctioned path past a red gate: there is no
> admin-merge-past-red."* That claim was true of the ruleset Lisa **ships**
> (`expo/github-rulesets/nightly-e2e-health.json` grants only a `DeployKey`
> bypass actor, and `tests/integration/nightly-e2e-health-workflow.test.ts`
> still holds it to that) and false of every deployment measured. On 2026-08-19
> all three portfolio repositories where this gate was required carried an
> added `RepositoryRole` bypass actor with
> `bypass_mode: always`, so an unaudited admin merge was available on every one
> of them — and was in use, including on at least one pull request the gate
> never reported a verdict for at all.
>
> The owner ruling is amended to **docs-follow-reality**: the bypass is
> preferred rather than exclusive, and readers are told to check their own
> ruleset rather than to trust the template or this prose. The shipped template
> is deliberately **not** changed to grant admins — baking one deployment's
> choice into every new repository would make the drift the default. The
> divergence is documented instead.
>
> The trap is worth naming, because it produced this amendment: a ruleset
> *definition* in version control is not the *effective* state of the branch it
> claims to protect. Any assertion about what can merge must be made against the
> live API, never against the checked-in JSON.

**The label has to exist before any of this is true.** A gate armed in a
repository with no `bypass_label` documents an escape hatch that is not there,
and an operator who follows §6 to the letter ends on the unaudited admin merge —
the one outcome this section exists to prevent. That mismatch is measured every
night and reported as a defect; see §10.9 for which way the consistency runs and
why nothing here creates the label for you.

The bypass is **self-service**: the PR's own author may apply the label and have
it honoured. That is deliberate. Requiring a second person to press the button
is friction, and friction on the audited path does not stop the merge — it
diverts it to the unaudited one, which records nothing at all. The control this
contract is actually buying is the **record**, not the second pair of eyes, so
every arm that produces the record is kept and the second-party requirement is
not.

> **Amendment — 2026-08-19 (self-bypass).** As ratified on 2026-08-12 this
> contract required that *"the labelling actor is **not** the PR author — no
> self-bypass. A bypass one person can both request and grant is not a
> control."* That requirement is **removed**. A correctly-formed label now
> waives the gate regardless of who applied it.
>
> The measurement: across one portfolio repository, **93 pull requests carried
> the bypass label and exactly one waiver was ever honoured.** Every other
> attempt was rejected `self_bypass`, because on a small team — and on any
> repository where an agent opens the pull request — the author and the only
> available labeller are the same party. Meanwhile every one of those repos
> granted admins `bypass_mode: always`, so the merges happened anyway, through
> the path with no ticket, no reason, and no expiry.
>
> A control that fires on 1% of attempts is not protecting anything; it is
> routing the other 99% somewhere worse. **This genuinely loosens the gate, and
> the owner made the trade with those numbers in hand.** What is explicitly
> retained, because it is what the mechanism is for: the
> `Nightly-E2E-Bypass: <TICKET> <reason>` trailer, the recorded identity of
> whoever applied the label, the 24-hour expiry, the reaper that strips a used
> label on close, and the `::notice::` that makes a waiver visible in the log.
> With the author check gone, the **trailer is now the only thing standing
> between a bare label and a waiver**, so its rejection path is load-bearing in
> a way it was not before and is tested as such.
>
> The rejection branch was deleted rather than made unreachable. A condition
> that can never fire is indistinguishable from one nobody has noticed is
> broken.

A bypass is valid only when **all** of the following hold. Any failure is row 22
— the check goes **red**, and the audit says which condition failed.

| Condition | Why |
|---|---|
| The PR carries the label named by `bypass_label` (default `nightly-e2e-bypass`). | The trigger. |
| The **actor who applied the label** has repository permission `admin` or `maintain`. | "Maintainers only." Read from `GET /repos/{repo}/collaborators/{login}/permission`; the labelling actor is read from the newest matching `labeled` event on the PR timeline. |
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

### 6.3 The gate reads the pull request LIVE, never from the event payload (row 40)

Every fact the bypass decides on — the label and the
`Nightly-E2E-Bypass:` trailer — is read from
`GET /repos/{repo}/pulls/{number}` **at gate time**. It was not always so, and
the reason it is now is a measured defect worth keeping next to the rule.

The gate used to take both halves from `github.event.pull_request`:

```yaml
NIGHTLY_PR_BODY: ${{ github.event.pull_request.body }}
NIGHTLY_PR_LABELS: ${{ toJSON(github.event.pull_request.labels.*.name) }}
```

`github.event` is the payload captured when the run was **triggered**. It is a
snapshot, and a re-run replays it verbatim. Combined with the caller's default
activity types — `opened`, `synchronize`, `reopened`, with no `labeled` — that
made this section's documented remedy **impossible to follow**:

- applying the label fired no run at all, so nothing re-evaluated;
- re-running the failed check — the obvious next move, and the one the failure
  message invites — replayed a payload from before the label existed.

Measured on two consumer repositories: both had the label applied and the
trailer present, both re-runs still failed, and the job logged
`NIGHTLY_PR_LABELS: []` with the label sitting on the pull request the entire
time. The only thing that worked was an **empty commit**, to manufacture a
`synchronize` event whose payload happened to carry the label.

That failure mode is quiet in the worst way. It fails in the *safe-looking*
direction — the gate stays red, nothing unsafe merges, nothing alerts — so it
persists; and its practical effect is to send someone who followed the printed
instructions exactly, and watched them do nothing twice, to the **unaudited
admin merge**, which is the one path that records nothing at all. A documented
remedy that silently does nothing is worse than no remedy.

**Reading live also closes the mirror hole, which matters more.** A payload that
still carries a label somebody has since *removed* would honour a waiver its
maintainer had already withdrawn. A snapshot can only ever tell you the label
was there once; only a live read can tell you it is gone.

**It fails closed, and it never falls back to the payload.** Row 40: if the pull
request cannot be read — 404, an unreadable API, a private repository whose
caller forgot `pull-requests: read`, or a 200 whose body carries no `labels`
array — the bypass is **rejected** with reason `pr_state_unreadable` and the gate
stays closed. Falling back to the payload on that path would reintroduce the
stale-label waiver above at exactly the moment nobody is watching. Note the
distinction the implementation depends on: an unreadable pull request and a
readable pull request carrying *no labels* are different facts, reported
differently, and only the second is safe to act on.

The report is worded for that difference too. The usual rejection line asserts a
label is present; when the read failed, whether one is present is precisely the
unanswered question, so `pr_state_unreadable` renders as *"the bypass could not
be evaluated"* and names the permission to check.

**The caller's `labeled` / `unlabeled` activity types are still worth having**,
and remain in the caller template. Live reading makes the *re-run* work — which
is what people actually try — while the trigger types make the label act
**immediately**, with no manual step at all. They close different halves: the
first makes the obvious action effective, the second removes the need for one.
The `unlabeled` half additionally means that removing a label re-asserts the
gate promptly rather than leaving the last bypassed result standing until
something else happens to re-run it.

Pinned by `tests/unit/scripts/nightly-e2e-health-live-labels.test.ts`, whose
cases all drive `runGate` end to end with a **deliberately stale payload in the
environment** — the exact shape the bug had. A test that asserted the YAML
changed, or that `evaluateBypass` still decides correctly, would have stayed
green throughout the entire period the gate was broken: the rules were never
wrong, only where the facts came from.

## 7. Permissions, tokens, pagination, rate limits, reruns, concurrency

**Minimum permissions** for the caller job:

```yaml
permissions:
  contents: read   # actions/checkout of the caller repo
  actions: read    # the entire point: reading other workflows' run history
```

`pull-requests: read` is additionally required **only** when the bypass path is
enabled on a **private** repository — the PR timeline, the live pull-request
read (§6.3) and the collaborator permission read are otherwise covered by
`contents: read` on public repos. The reusable requests nothing else and
**never** requests write. Missing it on a private repository does not fail open:
the live read 403s and the bypass is rejected `pr_state_unreadable` (row 40),
which the report names along with the scope to add.

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
plus **one** for the live pull-request read (§6.3) on the PR path only, which is
negligible against the 5 000/hour installation limit even with every PR
re-running it.

**Reruns.** A re-run of the *gate* re-reads history and can legitimately change
verdict — that is the unblock path working (re-dispatch the suite, re-run the
check). **Since contract 1.6.0 this is true of the bypass as well**, and it was
not before: the label and the trailer are read live rather than replayed from
the triggering event's payload, so re-running after applying the label does what
the failure message says it does (§6.3, row 40). A re-run of a *suite* creates a new run whose `created_at` is newer, so
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

The **reporting** job (§10) is the exact opposite and must not inherit the gate's
group: it writes, so a superseded run is not waste to be discarded but work that
may be half done. It uses a repository-wide group with
`cancel-in-progress: false`, declared inside Lisa's reusable workflow rather than
in the caller template — a forgotten group lets two overlapping reports both read
"no open issue for this suite" and both file one, which is the precise thing
"one issue per suite" exists to prevent. Same word, opposite settings, for
opposite reasons: **cancel a read, queue a write.**

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
  - Also *minor*: **adding a surface that gates nothing**, such as §10's
    reporting half. A repository that never installs the reporting caller sees
    no behaviour change at all, and one that does cannot have its merge gate
    affected by it — the two halves are separate workflows and the gate holds no
    `issues:` scope. That is what 1.1.0 → 1.2.0 shipped under.
  - **Rows 32–35 (per-suite grace) shipped as `1.2.0` → `1.3.0`, a minor**, and
    the reasoning is worth stating because those rows point the *other* way —
    they can make a currently-blocking suite non-blocking. What the major rule
    protects against is a **verdict changing for an unchanged observation**, and
    it does not: for every `suites` table that exists today — none of which
    carries `first_seen` — the findings are byte-identical. The verdict moves
    only when an operator *adds* a field, which is the "optional input with a
    fail-closed-safe default" minor clause, with the default being *absent* and
    therefore fully armed. Both skew directions still fail closed: a new guard
    under an old caller sees no anchors and behaves as before, and an old guard
    under a table carrying `first_seen` rejects the unknown key as row 20 —
    loudly, naming the config. A major bump would meanwhile **red-wall every
    adopter pinned to an older tag** (the workflow asserts the guard's major)
    for a change that cannot fail open, which trades a real outage for a
    theoretical one.
  - **Rows 36–38 (scope disqualification / `min_flows`) shipped as `1.3.0` →
    `1.4.0`, a minor.** An untouched table gains one new *blocking* row (36 — a
    run that recorded itself as tag-filtered) and no new passing one, so the
    skew is strictly toward fail-closed, and `min_flows` is opt-in with the
    default being absent.
  - **§10.7 and §10.8 (live requiredness, `gated`, pinning, bypass guidance)
    shipped as `1.4.0` → `1.5.0`, a minor**, under the "adding a surface that gates
    nothing" clause above. Every one of those four changes lands on the
    REPORTING half: they alter what a tracking issue *says*, never what the gate
    *decides*. `assessSuite`, `decide` and every row of §2 are untouched, and
    the gate holds no `issues:` scope so it cannot reach any of this code.
    The skew directions: a new guard under an old reporting caller measures
    requiredness anyway (the input has a default) and simply never pins; an old
    guard under a new caller ignores three environment variables it does not
    read and files the issue it always filed. Neither pair can produce a
    different merge verdict, which is what the major rule protects.
    - One nuance worth stating, because it looks like a behaviour change: the
      `gated` suite-table key means an old guard reading a *new* table rejects
      it as an unknown key (row 20) — loudly, naming the config, and only for a
      table an operator edited. That is the same fail-closed skew `first_seen`
      shipped under a minor with.
  - **Row 40 (the live pull-request read) shipped as `1.5.0` → `1.6.0`, a
    minor**, and it deserves its own paragraph because it points the same
    awkward way rows 32–35 did: a pull request that previously blocked can now
    be waived. What the major rule protects against is **the two halves running
    a contract neither agrees on**, and this change lives entirely in the guard
    — the workflow half carries no §2 logic. Both skew directions are safe. A
    **new guard under an old caller** reads the pull request live and ignores
    two environment variables the caller still sets; that is the fixed
    behaviour, with no caller change required, which is the whole reason this
    reaches existing consumers at all (a caller edit would not — the caller is
    `create-only`). An **old guard under a new caller** finds
    `NIGHTLY_PR_LABELS` and `NIGHTLY_PR_BODY` exactly where it expects them,
    because the reusable deliberately still sets them, and behaves as it always
    did. Neither pair fails open. A major bump would instead **red-wall every
    adopter pinned to an older tag** — the workflow asserts the guard's major —
    which trades a real outage for a theoretical one, to fix a defect whose
    entire practical effect was routing people to the unaudited admin merge.
    - The two variables are now **ignored, not removed**, and that is the one
      place this change sits uneasily against "inputs are never repurposed"
      below. They are not operator-facing inputs — they are plumbing between the
      two halves — and removing them would silently disable the bypass for any
      consumer on the new workflow ref with a pre-1.6.0 guard. They come out
      when 1.x support does, not before.
  - **§10.9 (the escape hatch is measured) shipped as `1.6.0` → `1.7.0`, a
    minor**, under the same "adding a surface that gates nothing" clause §10.7
    shipped under. It lands entirely on the REPORTING half: one extra read of
    `GET /repos/{o}/{r}/labels/{name}`, one defect block in an issue body that
    was already being written, one line in a job summary, one run annotation.
    `assessSuite`, `decide` and every row of §2 are untouched, and the gate half
    holds no `issues:` scope and never calls any of it. Both skew directions are
    inert: a **new guard under an old caller** measures the label anyway — the
    `bypass_label` input already existed and already has a default, so no caller
    edit is needed, which is the whole reason this reaches existing consumers at
    all (the caller template is `create-only`). An **old guard under a new
    caller** reads the same inputs it always read and files the issue it always
    filed. Neither pair can produce a different merge verdict.
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

### 8.1 Adoption and `lisa doctor` drift proof

`lisa doctor` follows active repository-event workflows and every reachable
local reusable workflow, retains every root-to-job call path, then proves the
guard each bypass-bearing job actually invokes. It does not search for a
conveniently present filename. An unused good canonical copy therefore cannot
hide an active incompatible renamed fork, and an unused `workflow_call`
definition, the reporting workflow, and the label reaper are not callers. The
reaper is never proof that a waiver expires: it cleans labels after closure,
while the active guard enforces expiry before a merge.

The supported shapes are intentionally small:

- A call to Lisa's exact official reusable owner/path uses literal
  `with.guard_script`, or the canonical default
  `scripts/check-nightly-e2e-health.mjs` when the input is absent.
- Direct invocation is supported as a literal
  `node <relative .js/.mjs/.cjs>` command (the target may be safely quoted), or
  through one literal environment variable. This is the migration path when
  changing to a composite reusable context would rename an existing required
  check. Keep the workflow name, job name, and required-check context unless
  its ruleset is being migrated in the same coordinated change.
- Expressions, command substitutions, absolute or escaping paths, multiple
  commands/targets, symlinks in any workflow or target path component, special
  files, and unresolved environment values are unavailable evidence. Executable
  job/step `if:` conditions that inspect bypass labels and inline dynamic
  `GATE_BYPASS=... node ...` wiring also fail closed; neither may turn into a
  determinate zero.

Compatible guards continue to expose the direct-caller contract command:

```sh
node scripts/check-nightly-e2e-health.mjs --contract-version
```

That output must be one ASCII semantic version, optionally followed by one
newline, and major `1` is compatible (the current shipped contract is `1.7.0`).
Doctor does **not** run that command. Target JavaScript is never executed,
imported, or spawned. Doctor takes a bounded no-follow snapshot, requires its
SHA-256 at the canonical destination in Lisa's shipped hash ledger, and parses
the one exact `NIGHTLY_E2E_CONTRACT_VERSION` declaration from those trusted
bytes. An unknown hash is unavailable evidence, even if it contains a copied
version string. This non-executing proof gives the target no environment, shell,
stdin, filesystem-write, child/worker/native/WASI, or network opportunity; the
built-CLI bite proves an untrusted target cannot POST to a local listener.

Each static target proof has at most 2 seconds and a 1 MiB file read. The
captured declaration is capped at 4 KiB. One 15-second outer deadline starts
before discovery and covers the scan, every deduplicated target proof, and
remediation classification; no later phase starts a fresh budget.

Discovery is bounded to 256 workflow files, 1 MiB per file, 8 MiB total, eight
levels of reachable local calls, 64 callers, and eight distinct targets. Missing
or empty `.github/workflows` is a determinate zero. An unreadable directory or
file, malformed YAML, a local-call cycle, a symlinked `.github`/`workflows`
component, or any exhausted limit is an unavailable proof and fails closed.
Containment and file identity are checked again immediately before read bytes
become proof evidence.

Remediation depends on what doctor can prove:

- If the installed Lisa package does not ship the canonical guard, upgrade
  first. `2.353.0+` contains it on the 2.x line; the current Lisa release is
  preferred. Then run `lisa apply .` and the exact contract probe above.
- A packaged guard that exists but is unreadable, not a regular file, or has a
  corrupt contract is a repair/reinstall finding, not an old-package finding.
  Likewise, an unreadable or non-regular canonical host path must be repaired;
  it is not described as missing and doctor does not advise installing over it.
- A missing or provably stale canonical copy is installed/refreshed by
  `lisa apply .`. A deliberately modified canonical copy is preserved; review
  it, then opt into the exact replacement with
  `lisa apply . --refresh-templates=scripts/check-nightly-e2e-health.mjs` and
  probe again.
- If the active incompatible target is off-path, install the canonical guard,
  repoint the existing job without renaming its context, and retire the old
  target. A compatible direct target passes as-is; migration to the reusable
  workflow is not a prerequisite.
- If the target is byte-identical to the packaged copy and its proof still
  fails, reinstall or upgrade Lisa rather than discarding a host change that
  does not exist.

This doctor arm is read-only. It does not edit a workflow, remove a label,
change a ruleset, or rename a check context; human and JSON output are two
renderings of the same `DoctorCheck`, and the same failure sets exit status 1.

## 9. What this replaces

| Was | Where | Now |
|---|---|---|
| Node script, one repo | acmeorgd `scripts/check-nightly-e2e-health.mjs` | the shipped guard (its bypass model and context-pinning test are the ancestors of §5/§6) |
| Bash + `gh` + `jq` library | acmeorga `.github/scripts/nightly-e2e-lib.sh` | the shipped guard; its job-name filter becomes `match.mode: "job"`; its unbounded bootstrap becomes §4, and the per-suite half of it §4.1 |
| Second Node script, `unknown`-passes | gemini `scripts/check-nightly-e2e.mjs` | the shipped guard; `DECISIVE_CONCLUSIONS` kept, the fail-open path closed (§2.2) |
| A ruleset requiring a PR-skipped context | Lisa `expo/github-rulesets/playwright.json` | **deleted**, replaced by `expo/github-rulesets/nightly-e2e-health.json` |
| One tracking issue per suite, auto-closed on green | acmeorga's nightly reporter | §10, with closing gated on row 26 completeness |

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

## 10. The tracking issue — the reporting half

A gate tells whoever opened a pull request. It tells **nobody else**. A nightly
that goes red on a quiet Friday is invisible until Monday's first PR: there is
nothing to assign, nothing to schedule, and — when it eventually comes back — no
record that it ever went down. §2 blocks; this section is how anyone finds out.

Until this shipped, the guard's own bypass report already promised the reader
that *"the tracking issue stays open until a green run lands"*, referencing an
artefact Lisa never created.

### 10.1 One issue per SUITE, not per red night

The tracking issue is a **state mirror of one suite**, not a log of nightly runs.
A reporter that files a fresh issue every red morning produces a backlog nobody
triages and makes the suite's actual state illegible from the issue list — the
one place an operator looks. So: at most one open issue per suite, refreshed
while it is red, closed when it is green.

**Identity is an HTML-comment marker in the issue body**, not the title and not
the label:

```
<!-- lisa_nightly_e2e_suite:Maestro%20native%20e2e -->
```

A title gets edited, a label gets renamed, and either would orphan the issue and
cause a duplicate to be filed the next night. The suite label is encoded down to
`[A-Za-z0-9_.~%]` so a suite named `evil --> <!--` cannot terminate the comment
early and make its marker match every other suite's issue — which on a green
night would close all of them.

A second marker carries a fingerprint of *why* the suite is red. That is what
lets a refresh rewrite the body every night (free, and nobody is notified) while
posting a comment (a notification) **only when the evidence actually changed**. A
comment every night for the same failure trains people to mute the issue that is
supposed to be alerting them.

### 10.2 The reporting truth table

Read per suite, from that suite's row-1–26 finding. `complete` means row 26 was
satisfied — the run gathered the evidence its conclusion claims.

| # | Suite finding | Open tracking issue? | Action |
|---|---|---|---|
| 27 | `fail` (complete) | none | **create** one issue, labelled `nightly-e2e` |
| 28 | `fail` (complete) | one or more | **refresh** the oldest — never file a second. Comment only if the evidence changed |
| 29 | `pass` **and** complete | one or more | **close** every one of them, with an all-clear comment |
| 30 | `unknown`, **or** any finding that is not complete (`incomplete_run`) | any | **nothing.** Not closed, not filed, not commented |
| 31 | The Issues API fails for one suite | any | that suite is reported as unhandled, the **other suites still run**, and the *merge gate is unaffected* |

Row 29 closes *every* match rather than only the oldest: a duplicate that got
filed anyway (by hand, or by a report that raced the concurrency group) is
cleaned up by the green night rather than left open forever.

### 10.3 Row 30 is the load-bearing one

Closing an issue is a stronger claim than letting a pull request through. It
announces that a suite is **healthy**, and it is the action that must never fire
on a run that did not gather the evidence. This is acmeorga's trap in their
words: *one spec reporting success would close the tracking issue while the
failures that opened it went unrun — the suite declaring itself green on evidence
it never gathered.*

Row 26 already refuses to call a partial run a pass (§2.4), so for the gate this
is implied. **The reporter asks the completeness question again, in its own
right** — `isCompleteEvidence` is checked before the state is, so a future
loosening of row 26 cannot silently re-open the hole through the reporting door.
Completeness is not re-derived here; row 26's `incomplete_run` token *is* the
answer.

Note what row 30 does **not** do: it does not file. A partial run is *absence of
evidence*, and absence of evidence is not evidence of failure. The tracking state
is simply left exactly as it was, which is the honest answer to "we did not
find out last night."

Bootstrap (§4) is deliberately absent from this table. The reporter reads each
suite's raw state rather than the bootstrap-rendered one, and the answer is the
same either way: an `unknown` suite is left alone, and a genuinely red suite is
red inside the window too. Bypasses are absent for the same reason — a bypass
waives the gate for **one pull request**; it does not make the nightly green, and
the tracking issue stays open until a green run lands.

### 10.4 Filing must never be able to fail the gate

The merge check is *required*. Issue filing is *reporting*. If filing lived
inside the gate, an Issues API that was down, throttled, or newly forbidden would
turn a green nightly into a red required check on every open pull request — an
outage in a notification channel becoming an outage in the merge queue.

The isolation is structural, at three levels, so it does not depend on anyone
remembering it:

1. **Two workflows.** `nightly-e2e-health.yml` runs on `pull_request` and is
   required. `nightly-e2e-report.yml` runs on `schedule` and must **never** be
   made a required check.
2. **The gate holds no `issues:` scope.** A called workflow's `permissions:` is a
   ceiling, so the gate could not file an issue if its code tried.
3. **The gate path performs no writes.** Writes live in `apiWrite`, reachable
   only from `runReport`, which only the `--report-issues` flag invokes. That is
   asserted by a test that runs the gate against a fake `fetch` and requires
   every request to be a `GET`.

Within the report, one suite's failure is recorded and the remaining suites are
still processed (row 31) — a broken issue is not a reason to stop reporting on
the others.

**The report job's exit code answers "did reporting work", never "is the suite
green".** A red nightly reported correctly is a *successful* report. Conflating
the two would hand operators a second red check meaning something different from
the first.

### 10.5 The issue body is written for a non-technical operator

Lisa's factories are meant to be operable by people who do not read code, and
everything that crosses a gate outward has to be readable by whoever is standing
at it. So the body opens with which suite is down and what to do about it, says
plainly that the issue closes itself and should not be closed by hand, and keeps
workflow names, conclusions and reason tokens below a fold.

The instruction it leads with is the one people get wrong: **re-run the whole
suite**, leaving any platform / tag / shard picker on its `all` default. A
narrowed re-run does not clear the gate (§2.4), and it will not close the issue
either.

### 10.6 Seams left open on purpose

Three neighbouring problems are deliberately *not* solved here, and each has a
clean place to attach:

- **Zero-coverage as a distinct state** would add a fourth suite state beside
  `pass|fail|unknown`. It attaches at `assessSuite`; row 30 already routes
  anything that is not `pass`-and-complete to "do nothing", so a new state needs
  only its own row here to decide whether it files.
- **Per-suite bootstrap grace** attaches at the suite schema. The reporter reads
  raw states and is unaffected either way (§10.3).
- **Flake classification** belongs on the JUnit-producing side, not here. If a
  suite is ever classified `flaky` rather than `fail`, it becomes one more row in
  this table — which is the point of stating the table as *finding → action*
  rather than burying the mapping in code.


### 10.7 The blocking claim is MEASURED, and has three states

Until this shipped, every issue the reporter filed said, unconditionally:

> Pull requests into `dev` are blocked until this suite is green again.

That was a hardcoded assertion about somebody else's branch ruleset, and it was
**measurably false**. `GET /repos/AcmeOrgB/frontend/rules/branches/dev` returns
twelve required contexts and not one of them matches this gate. The suite
blocked nothing — while people applied audited `nightly-e2e-bypass` labels to
clear a gate that was not gating, spending the audit trail the label exists to
create on a merge that was never held.

An issue that misstates its own consequences is worse than one that says
nothing, because it gets acted on. So the claim is now read from
`GET /repos/{owner}/{repo}/rules/branches/{branch}` at generation time and
rendered into the **title, the body, and the close comment**, in one of three
states:

| State | When | What the issue says |
|---|---|---|
| `required` | a required context in effect on the branch matches the gate | "Pull requests into `<branch>` are blocked" — plus the full audited-bypass recipe |
| `not_required` | the rules were read, and none of them is this gate | "This suite does **not** gate merges" — and that the bypass label *would waive nothing* |
| `unknown` | the rules could not be read | **neither claim.** It says so, says why, and hedges the bypass recipe |

`unknown` is a first-class state, not a tidy-up. This file's whole doctrine is
that "we could not check" must never render as an answer — and here it could
render as an answer in *either* direction. A false `not_required` tells someone
to ignore a gate that is holding every pull request they have open; a false
`required` sends them to burn a waiver they do not need.

Two consequences of that follow, and both are asserted:

- **A `404` is `unknown`, never `not_required`.** `apiGet` maps 404 to `null`,
  and this endpoint 404s for a repository or branch the token cannot see. A
  branch that genuinely has no rules answers `200 []`, which *is*
  `not_required`. Collapsing the two would print "nothing is blocking you"
  because we were not allowed to look.
- **The measurement can never fail the report.** `fetchRequiredness` catches
  everything and answers `unknown`. §10.4 says an outage in the notification
  channel must not become an outage anywhere else; a reporter that aborted on an
  unreadable ruleset would stop filing the issues that tell people the suite is
  down, trading a missing sentence for a missing alarm.

**Which context counts as this gate** is `gate_context`, defaulting to
`🌙 Nightly E2E Health / 🌙 Gate` — the composite GitHub builds from Lisa's
caller template (§5). A context that is the configured one plus or minus a
` / `-separated job suffix also counts, because a repo still running a local
single-job reimplementation publishes the bare `🌙 Nightly E2E Health` and that
is the same gate. Nothing looser: a substring test would match
`🌙 Nightly E2E Health (advisory)`.

**This is a knowing divergence from both prior implementations.** AcmeOrgB's
`describe-nightly-e2e-requiredness.mjs` and acmeorga's
`report-nightly-e2e.mjs` each compare the full context string exactly
(`contexts.includes(context)`), and each documents that choice against the
looser alternative of searching for `"nightly"`. They are right that a substring
search is wrong; the family here is not one. It was widened for a measured case
neither of them has: on 2026-08-18 `PropSwapLLC/frontend`'s `dev` required the
bare `🌙 Nightly E2E Health`, their fork's single-job name. Under exact matching
against the default `gate_context`, Lisa's reporter would have told that
repository it was `not_required` — a false all-clear on a branch that genuinely
blocks every merge, which is the same defect this section exists to delete,
pointed the other way.

#### The per-suite `gated` flag

Requiredness is a property of the **branch** — one context guards every suite in
the table. `gated: false` is a property of **one suite**: it is tracked, and
deliberately not enforced. Its issue then says "this suite does not gate merges"
rather than claiming to block, because *an ungated suite that claimed to block
merges would be crying wolf* — and a reader who catches one gate lying stops
believing the ones that are telling the truth.

**`gated: false` relaxes no evidence standard (owner ruling).** Every exclusion
in `isCompleteEvidence` — `incomplete_run`, `filtered_run`, `flow_shortfall`,
`scope_unreadable`, `zero_flows` — applies in full to an ungated suite. Evidence
quality and blocking authority are orthogonal: `gated: false` changes what the
issue *says* about merges, and nothing about what counts as *knowing* the
suite's state.

This is stated rather than left implied because the natural reading is the
wrong one. "Not a gate" sounds like lower stakes, so relaxing the bar there
looks harmless. It is backwards: a gating suite that closes on evidence it never
gathered is caught the next morning, when a pull request sails through on a
green nobody earned — whereas **an ungated suite's wrong verdict is the one
nobody is watching**, with no merge queue downstream to trip over it. A false
all-clear there can stand indefinitely.

The two compose in one direction only. `gated: false` can silence a blocking
claim; `gated: true` can never manufacture one. On a branch where no required
context matches the gate, every suite renders `not_required` whatever its table
says. That is the same asymmetry §6.2 applies to the bypass pattern — an
override narrows, it never loosens — and here it is what stops the people who
own a suite from asserting a merge consequence that only the people who own the
branch can impose.

### 10.8 Pinning is opt-in, and a full pin board is not an error

A tracking issue only works if somebody sees it, and an issue list is not
somewhere people look unprompted. `pin_issues` pins each issue while its suite
is red and **unpins it on green**.

Off by default, because pinning writes to a repository-wide surface with three
slots that this workflow does not otherwise touch — an adopter should choose to
spend one. Opt-in is enforced at the wire, not merely in the plan: with pinning
off, no GraphQL request is issued at all.

Unpinning is the half that is easy to skip and expensive to omit. A pin that
survives the recovery is how a pin board stops meaning anything; after two of
those nobody reads the pinned issues either, and the capability has made things
worse than not having it.

**Past GitHub's three-pin limit the pin is a warning, never a failure.** A
fourth red suite in a repo with three pins is an ordinary Tuesday, and it says
nothing about whether the tracking issue was written correctly. Reddening the
report job for it would teach operators to ignore the report job — trading a
decoration for the alarm. `ok` answers "was the tracking issue written"; the pin
rides beside it in `warnings`.

One protocol trap is pinned by a test because it is a vacuous green in the
smallest possible surface: **a GraphQL error arrives as HTTP 200 with an
`errors` array**, not as a failing status. Checking `response.ok` alone reads
the pin limit as a success and reports a pin that never happened.

### 10.9 The escape hatch is MEASURED, and a missing one is a DEFECT

§6 names the audited `bypass_label` the **preferred** way past a red gate, and
§10.7 prints the recipe for it in every tracking issue filed for an armed gate.
That recipe only works if the label exists in the repository.

Measured across four adopters carrying this standard on 2026-08-19:

| repo | `bypass_label` present? | gate required by a ruleset? |
|---|---|---|
| A | yes | yes, active |
| B | yes | **no — the context appears in no ruleset** |
| C | **no** | yes, active |
| D | **no** | yes, active |

Two of four had the gate armed and required with **no bypass label at all**. On
those two the documented path was unreachable and the only remaining exit was
the unaudited admin merge — reached by following the printed instructions
exactly. That is the same destination row 40 was fixed for, from the opposite
cause: there the label existed, was applied, and the gate read a stale event
payload; here there is no label to apply. A gate whose printed remedy cannot be
followed is worse than one with no remedy, because an operator acts on it.

Note the third row too. Repo B has the label and does not require the gate, so
the label waives nothing — which means **label presence is not evidence the gate
is armed**, and a label-presence check on its own would have reported the wrong
thing on two of the four.

#### Which way the consistency runs, and why

The asymmetry can be closed from either end. This contract closes it by
**reporting the mismatch**, not by creating the label and not by refusing to arm:

- **Refusing to arm is unreachable and backwards.** The gate is armed by a
  ruleset, which may be an *organization* ruleset or a hand-edited repository
  one; Lisa's setup does not own that surface and cannot gate it. It certainly
  cannot reach the two repositories that are *already* in this state — which is
  the entire population of the defect. And an operator who cannot create labels
  in a repository would be stranded worse by having the gate withheld than by
  being told what is missing.
- **Creating the label automatically manufactures a bypass.** The reporter holds
  `issues: write` and *could* create it. It does not, on purpose: a bypass label
  conjured into a repository whose owners never adopted §6 is a new hole, not a
  fixed one. Some repositories arm this gate deliberately with no self-service
  waiver. Naming the mismatch leaves that decision with the people who own the
  branch, which is the same asymmetry §6.2 and §10.7 apply everywhere else — an
  automated actor may narrow a control, never loosen one.
- **Reporting is the fail-loud posture this guard already has.** The reporter
  runs on a schedule, green or red, and already measures requiredness from the
  effective-rules endpoint. The defect costs one extra read and lands in a
  surface that is already written every night.

#### Visible BEFORE it is needed

This lives on the REPORTING half rather than on the gate for one reason: the
gate only speaks when somebody is already blocked, and *discovering the escape
hatch is absent while trying to use it* is the failure mode. The nightly report
runs whether or not anything is red and whether or not anyone has a pull request
open, and writes the defect in three places:

1. the **job summary** of every nightly report, on green nights included;
2. a **`::error` run annotation** on the report run;
3. a **`> [!CAUTION]` block** at the top of the waiver recipe in every tracking
   issue for an armed gate, naming the label, naming the ruleset that armed the
   gate, and printing the single `gh label create` command that fixes it.

The annotation is deliberately **not** a job failure. §10.4 is the rule: this
job's status answers "did REPORTING work", and reddening it for a
repository-configuration defect would teach operators to ignore the one job that
tells them a suite is down.

#### Four states, and the one this guard must never invent

| State | When | What it renders |
|---|---|---|
| `present` | `200` from `GET /repos/{o}/{r}/labels/{name}` | **nothing** — byte for byte what the reporter rendered before §10.9 |
| `absent` | `404` from that endpoint | the defect, naming the label and the ruleset |
| `unknown` | the labels API could not be read | a hedge: confirm the label exists; never a claim that it does |
| `not_measured` | nobody asked | nothing |

`unknown` is a first-class state for the same reason it is one in §10.7, but the
asymmetry here has a direction: **the state this guard must never invent is
`present`**, because that is the one that reprints an instruction which does not
work. Unreadable is never a granted escape hatch — the same ruling row 40 makes
about an unreadable pull request, applied to an unreadable label list.

`not_measured` is kept distinct from `unknown` and is not padding. "Nobody
asked" and "we asked and the API would not say" are different facts, and only
the second earns a hedge. Collapsing them would print a caveat in every issue
filed by a caller that predates this section; collapsing them the other way
would swallow the case the caveat exists for.

**A 404 means the label here, though it means the repository in §10.7.** The
difference is real. `GET /repos/{o}/{r}/rules/branches/{b}` 404s for a
repository the token cannot see, so there a 404 conflates "no rules" with "not
allowed to look". The labels endpoint 404s for a label that is missing from a
repository that *is* readable — and this measurement is only ever rendered after
the branch rules came back `200` from that same repository, so visibility is
already proven by the time `absent` can appear.

#### Nothing gated, nothing reported

On a branch where no required context matches this gate, the measurement is not
merely unrendered — **it is never taken**. The reporter skips the call entirely,
because the issue there already says "you do not need a waiver" and never names
the label, so a missing label waives nothing and reporting it would be a defect
filed against a repository that has none. Skipping the *call* rather than
suppressing the *render* makes that a property of the wire, which a later
renderer edit cannot quietly undo.

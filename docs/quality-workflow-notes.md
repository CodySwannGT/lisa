# Quality workflow rationale

Long explanations from the quality workflow live here to keep its source below GitHub's workflow size limit. Each source comment links to its corresponding note.

The Expo route check (`check-e2e-coverage.mjs`) measures route references in test source and explicit annotations. It runs no tests and does not establish that a route was visited or an assertion passed. Registry-driven and indirect navigation can be absent from the scan. Treat its percentage as a static planning signal alongside actual runner results; an `e2e-route:` annotation declares a reference without proving execution. Existing thresholds, exemptions, and exit codes are unchanged. This reporting clarification avoids adding a separate runtime reporter and artifact pipeline (#3445).

## Note 1

```text
⚠️ PREFER `gates` IN .lisa.config.json. `skip_jobs` is retained
because repositories pass it today, but it is unsafe by
construction: GitHub counts a SKIPPED required status check as
SATISFIED, so a job named here reports GREEN against a context its
ruleset still requires, having run zero steps. That gate can never
be red and therefore can never block anything — measured twice in
this portfolio (see the `skipped_required_checks` job below).

The safe replacement is to set the gate to `off` (or `optional`) in
the `gates` block of .lisa.config.json. It cannot produce a vacuous
green, because ONE declaration drives BOTH sides: the job condition
and the required-context list, which `contextsFor` in
scripts/lisa-gates.mjs derives from the same entry and which emits a
context only for `required`. A gate turned off vanishes from the
ruleset instead of silently satisfying it. `skip_jobs` cannot offer
that, because it is a workflow input and nothing edits the ruleset.

⚠️ NO SPACES. Each token is matched exactly, as `,<token>,` inside
`format(',{0},', inputs.skip_jobs)`. GitHub Actions expression syntax
has no string-replace function — the available string functions are
contains/startsWith/endsWith/format/join/toJSON/fromJSON/hashFiles —
so this workflow cannot trim for you. `'lint, lint_slow'` yields the
token `" lint_slow"`, which matches nothing, and the job RUNS. That
fails closed, so nothing unverified ships; it just silently does not
do what you asked. `scripts/check-skipped-required-checks.mjs` reports
exactly this as `whitespace_in_skip_token`, and the
`🔒 Skipped Required Checks` job below runs it on every pull request.

That job takes NO TOKEN, and neither does `🧭 Gate Config Validity`.
A gate whose job is to detect silencing cannot itself be silenceable:
a token that switched it off would mean "I may silence a required
check without anyone objecting", which is the one claim this input is
not allowed to make. The rule is written down, generalised, in
`NON_DECLARABLE_JOBS` in scripts/lisa-gates.mjs.
```

## Note 2

```text
─── Which copy the gates ran ────────────────────────────────────────────
THE STAMP'S CROSS-PROCESS CLAIM, OBSERVED RATHER THAN INFERRED. The job
above resolves the enforcement registry through the same three-candidate
search the gate jobs run, in the same order, after the same dependency
install. Every word of that is an argument about how this FILE is written.
It is not an observation that two jobs on one runner landed on one file,
and those are different claims: a change that breaks the correspondence
without breaking the YAML shape satisfies the first and violates the
second.

Why the gap mattered enough to instrument. The stamp exists because a
content hash reads as the one fact that cannot be mistaken, so a
confidently wrong stamp is worse than an absent one. "The stamp is
self-consistent" is the weaker of the two things a reader takes it to
mean, and until this job it was the only one anything demonstrated.

FAILS CLOSED ON ITS OWN BLINDNESS. The healthy state here is "the paths
are equal", and every way of NOT LOOKING — a stamp that resolved nothing,
a gate job that never ran, a comparison that could not execute — also
produces "no divergence found". So each of those reports NOT_DETERMINED
and says which one it was; none of them may render as agreement. The
verdict is written to a file the shell reads back, so a comparison that
dies before printing is still reported rather than passing as silence.

REPORT ONLY, like the stamp it checks. A failed job here fails the
reusable workflow, which fails the CALLER's job, which in some consumers
is a required context; a comparison that could redden CI would be a new
gate nobody declared, arriving unannounced in every project that reports.
So the verdict travels as an annotation and a run-summary block, and the
step exits zero on every one of them. It carries no `continue-on-error`
for the same reason `lisa_identity` does not: the file's unconditional
carriers are pinned, and this needs no exemption to be harmless.
```

## Note 3

```text
FOUR ANSWERS, and telling them apart is the whole point of this step.
Collapsing any of them into "no legs" silently drops every declared
gate — and a required context that never reports does not read as
skipped, it holds the pull request at "Expected — Waiting for status
to be reported" forever. A missing prover must be LOUD, not absent.

  1. NO RESOLVER AT ALL — a project that predates the registry.
     Empty list, warning, pass. There is nothing it could have
     declared, so there is no leg it can be missing, and every
     property it proves today is proved by a built-in job as before.

  2. A RESOLVER TOO OLD TO KNOW `legs`. Also empty, also a warning,
     also a pass — and this is a real population, not a hypothetical:
     consumers call this workflow at `@main` while holding whatever
     copy of `lisa-gates.mjs` their last `lisa` run installed. It is
     told apart from case 3 by asking the same resolver for `list`, a
     command every version has had. `list` works and `legs` does not
     ⇒ old. Neither works ⇒ broken.

     MEASURED, not reasoned. Run the resolver as it stood immediately
     before `legs` existed and it answers, verbatim:

       $ node lisa-gates.mjs legs --moment="$GATE_MOMENT" --json
       usage: lisa-gates.mjs validate|list|needs|contexts|skip-jobs|…
       exit 1
       $ node lisa-gates.mjs list --moment="$GATE_MOMENT" --json
       exit 0

     That asymmetry is the whole discriminator, and it is recorded
     here rather than only in the pull request because the rule on
     its own reads like a plausible convention a later reader may
     tidy away. The evidence is what makes it a fact about the
     shipped artifact. If a future version ever makes `list` fail
     where `legs` succeeds, this branch is wrong and the measurement
     above is how you would know.

  3. A RESOLVER THAT CANNOT ANSWER — malformed config, unreadable
     registry. FAILS. The project HAS a registry, its declarations
     are the only thing that decides these contexts, and a resolver
     that cannot answer has not said "no gates", it has said nothing.

  4. AN ANSWER THAT IS NOT WELL FORMED. Also FAILS, and separately,
     so a corrupt payload can never be downgraded into case 2.

WHY THERE IS NO INSTALL STEP ABOVE. The resolver is dependency-free
by construction, and skipping the install is what lets this job be
cheap enough to gate every leg on. The candidate order is unchanged
from every façade job below, so nothing here prefers a different copy
— an uninstalled `node_modules` simply is not one of the candidates.

The output is validated before it is trusted, for the same reason the
in-job façade validates its own: `.lisa.config.json` is a file a pull
request can edit, and `label` reaches a job name while `runner` and
`task` reach a shell. `momentLegs()` refuses a task that is not a
plain word at the source; this re-checks the SHAPE here, because the
resolver that answered may be one this workflow has never seen.
```

## Note 4

```text
─── The generic pull-request gate runner ────────────────────────────────
THE ASYMMETRY THIS CLOSES. `lisa-run-gates.mjs` resolves whatever a moment
declares and runs `$runner $task`, so adding a gate to the registry and
declaring it at `commit` makes it run with no wiring and no hook edit. Its
own doc comment states the design: the git hooks used to hardcode both the
tool and the list of steps, "which meant the answer to 'what does this
project prove before a commit?' lived in a shell script that only a shell
could read."

This workflow never made that move. Every gated job below carries its own
copy of the resolve step with one hardcoded `GATE_ID:`, and a gate outside
that set is unreachable from a declaration no matter what a project writes.
These two jobs are the pull-request moment's answer: one resolution, and
one leg per gate the declaration names that no hand-written job below
already posts a context for.

WHY A MATRIX CAN CARRY A BRANCH-PROTECTION CONTEXT, which is the belief
this design turns on and was MEASURED rather than assumed. A matrix job
whose `name:` is STATIC posts a suffixed context — every leg emits the same
name and GitHub disambiguates them — which is why `playwright-e2e.yml`
carries a separate aggregate job whose whole purpose is to own the stable
name. A `name:` that is ITSELF a matrix expression cannot collide, so
GitHub adds nothing. Both halves were posted on one commit, through a
reusable workflow called by a named job — the exact shape of this file —
and read back from the check-runs endpoint branch protection matches
against:

    🔍 Quality Checks / 🧪 Probe Static (alpha)   ← static name, suffixed
    🔍 Quality Checks / 🧪 Probe Alpha            ← matrix name, verbatim

So `name: ${{ matrix.label }}` posts `🔍 Quality Checks / <label>`, which
is the string `contextsFor()` already derives from the same declaration.
The two cannot disagree, and no ruleset edit is required anywhere.

WHAT DOES NOT GET A LEG, and why that is the safety property. A gate a
hand-written job below already proves is excluded, because exactly one job
may be named a gate's label — two jobs posting one context is branch
protection matching whichever reported last. `jobBackedGates()` derives
that exclusion from `QUALITY_JOB_GATES` minus `GENERIC_RUNNER_GATES`, so a
block is deleted and its gate migrated in ONE commit, after its leg has
been observed green, and never in the other order.
```

## Note 5

```text
─── Gate façade ─────────────────────────────────────────────────────
THE CONTRACT (stated once here; the other converted jobs point back).

A gate is a PROPERTY that must hold, not a tool. `oxlint` is not a
gate — *code style* is the gate, and oxlint is one way to prove it.
Lisa owns the vocabulary (`code-style`); the PROJECT owns the
implementation, by naming one of its own tasks in the `gates` block of
.lisa.config.json. Resolution goes through the shipped registry,
scripts/lisa-gates.mjs, so this workflow never has to know what the
project lints with. Swapping oxlint for biome is one line of project
config and nothing here.

THE FALLBACK is deliberate and load-bearing. `configured` is false —
and the steps below run TODAY'S hardcoded invocation, byte for byte —
whenever nothing resolves, which covers every one of:
  * no scripts/lisa-gates.mjs (project predates the registry),
  * no `gates` block (the state of essentially every installed
    project right now, including Lisa itself),
  * this gate not declared at the `pull-request` moment,
  * this gate declared `await`-proved rather than run.
An unmigrated project therefore behaves EXACTLY as it does today.
A declaration explicitly set `off` is the one different state: the
planner skips it before allocation, matching the old in-job path that
ran zero proving steps after allocation.

Note what the fallback does NOT do: it never turns the job into a
no-op. This job's `name:` is a branch-protection context, and a
required context that runs zero steps reports GREEN — that is the
`skip_jobs` defect (see the header). Retiring a gate means dropping it
from the required-context list, which is derived from the same
declaration by `contextsFor`, so the two can never disagree.

WHY THE EXECUTION RESOLVE STEP IS REPEATED IN EVERY GATED JOB. The
shared gate_plan job is only a cost hint: it can answer `off`, and its
dependents use `always()` plus a run-on-planner-failure condition. It
never supplies the runner, task or fallback decision. That distinction
is load-bearing: a failed `needs:` parent normally leaves dependents
SKIPPED, and a skipped required check counts as SATISFIED. One
independent execution resolution per job is what keeps each context
unable to be satisfied by something other than its own gate.
The repeated text is therefore an INVOCATION, not a reimplementation:
the resolver is scripts/lisa-gates.mjs and the only thing that differs
between copies is GATE_ID.
tests/integration/quality-gate-facade.test.ts asserts every block is
byte-identical once GATE_ID is normalised, so they cannot drift apart
the way two hand-maintained copies would.

Three properties of the resolve step below are load-bearing:
  * Nothing discards stderr, and `pipefail` is on. A malformed
    .lisa.config.json fails the step loudly instead of reading as "no
    gate is configured" and quietly falling back to tooling the
    project may have deliberately replaced.
  * `plain()` rejects anything that is not a bare word, because
    .lisa.config.json is a file a pull request can edit and the
    resolved value reaches a shell. Flags are allowed; `$( )`,
    backticks, `;`, `&&` and quotes are not. It tests `typeof` FIRST:
    `RegExp.prototype.test` COERCES, so a bare `test(true)` examines
    the string "true" and passes, and `gates.runner: true` then
    survives the fallback too because `true` is truthy.
  * The runner and the task get DIFFERENT character classes, and the
    runner is additionally refused when it is a shell no-op. A task
    legitimately carries a colon (`test:cov`, `lint:staged`); a
    runner never does, and `:` is the shell's no-op builtin — so
    `"runner": ":"` was a plain string that passed a validator
    written to permit it. Every gate then "ran" as `: <task>` and
    reported success, with the `configured == 'false'` fallbacks
    skipped because resolution had succeeded. One key, both layers
    off, green and silent. Not-an-injection is not the same claim as
    is-a-runner, and only the first was ever being checked.
    `lisa-gates.mjs` refuses the same values at the source, so a bad
    runner is reported once rather than nineteen times; both halves
    are executed against the same fixtures by
    tests/integration/quality-gate-runner-validation.test.ts.
```

## Note 6

```text
Per-change verification (UAT) gate: a feat/fix must ship a verification
(e2e) spec, unless labeled verification-exempt. Only meaningful on
pull_request (it needs the base/head SHAs to diff).

ONE ADOPTION CONTROL, AND IT IS THE DECLARATION (#3021). This job used to
carry two: the `coverage-adequacy` gate row it answers to, and a
`verify_enforced` boolean input read by this very `if:`. They could
disagree, and the losing one lost in SILENCE — a project declaring the
gate required at pull-request while leaving the input at its default
`false` got no job at all. The input is retired; a caller still passing it
is refused by name in the first step below rather than ignored.

WHY THE COLLAPSE IS NOT A DELETION, which is the whole of the work.
Measured across every caller of this workflow on its own default branch:
22 callers, 2 setting the input true, 20 relying on its default. With the
input simply gone this job runs for all 22, and the façade's
`configured=false` fallback runs a bespoke spec-delta check most of them
fail — because an undeclared gate falls back rather than standing down.

So THIS job stands down instead: when `coverage-adequacy` is not declared
at this moment it runs zero proving steps and reports green, with a
warning saying so. That is byte-for-byte the outcome those 20 already had
from a skipped job, so the collapse cannot redden them; and it inverts the
registry's general rule for exactly one job, which is why the inversion is
written down rather than merely done. The entry is
`DECLARATION_REQUIRED_JOBS` in scripts/lisa-gates.mjs. #3147 preserves an
existing literal opt-in during a Lisa update, before a managed caller can
be overwritten, and migrates it to the equivalent declaration. Explicit
current choices take precedence. Inactive projects can remain undeclared;
there is no requirement to make their stand-down fatal or add paperwork.
```

## Note 7

```text
ONE ADOPTION CONTROL: the `behavior-contract` gate declaration, at
`required`, `optional`, or `off`.

This job used to answer to `bdd_mode`, a private three-state input carried
in the caller's ci.yml, running alongside the registry every other quality
job answers to. Two controls for one question, and the losing one lost in
silence. Its middle state, `bootstrap`, was a time-boxed grace period with
a named owner and a hard expiry — which is `optional` plus paperwork, and
it hid red rather than showing it. The owner retired the state and the
axis with it; the input is refused below rather than read.

  required -> runs, and the context is a merge condition.
  optional -> runs, and a red here is visible without blocking. This is
              what a project adopting the contract declares while the
              contract is not clean yet: the same visibility `bootstrap`
              offered, with no expiry to forget and no grading that turns
              a defect amber.
  off      -> stands down, and says so in the settings file, which is a
              decision someone can read.

UNDECLARED IS NOT `off`, and it is not `optional` either — it stands the
job down with a warning. This job deliberately does NOT copy the
presence-gated fallback the e2e_coverage and state_classification jobs
use, where an undeclared gate falls back to running the shipped script.
The prover here ships to every project on the stack, so falling back would
enforce a behavior contract on every consumer that never adopted one. The
gate is governed when it is declared, and not before.

A required context is never auto-skipped: GitHub counts a skipped required
check as passing, so the job always runs and stands down INSIDE itself.
```

## Note 8

```text
---------------------------------------------------------------------------
#3668 — the mutation gate's version of a waived review rendering as a pass.
---------------------------------------------------------------------------
`🧬 Mutation Testing Gate` exits 0 for a run that generated mutants and
exits 0 for a run that generated none, so `gh pr checks` printed

    🔍 Quality Checks / 🧬 Mutation Testing Gate   pass

for a pull request nothing had measured. Measured on #3664: a 400-line
change to a shipped guard script, `nothing-to-mutate`, green. The gate's own
log was honest and had been for months — `lisa-mutation.mjs` says above
`OUTCOMES` that "both exit 0, and only the marker says which one happened".
A marker in a log is not a control.

THIS JOB IS THE RENDERING, and its ABSENCE is the signal. It runs only when
the gate reported that mutants existed, so a run that measured nothing
leaves it `skipped` — which `gh pr checks` prints as `skipping`, visibly
unlike `pass`, while contributing no failure to any exit code.

WHY A JOB AND NOT A PUBLISHED CHECK RUN. #3664 solved the same problem by
having the guard choose a `neutral` check-run conclusion, which needs
`checks: write`. That is not available here and must not be added:
`quality.yml` is `workflow_call`-only and consumed fleet-wide via `@main`,
and a called workflow may only DOWNGRADE its caller's grant — asking for
more is a `startup_failure` for the entire run (#2049). That constraint is
why `review-evidence.yml` is a standalone workflow rather than a job here.
A skipped job needs no permission at all, so this reaches the same layer
for free.

NEVER MAKE THIS A REQUIRED CONTEXT. Being skipped is its normal, correct
state on any pull request that touches no mutate target, and branch
protection cannot see a skipped context as satisfied — requiring it would
block every such pull request forever. It is registered in
`SECONDARY_PROVER_JOBS` for exactly that reason: it is not the job a ruleset
matches for `test-meaningfulness`.
```

## Note 9

```text
---------------------------------------------------------------------------
Skipped required checks (#2426)
---------------------------------------------------------------------------
GitHub counts a SKIPPED required status check as SATISFIED. A job named in
`skip_jobs` still reports a green checkmark against its required context
having run zero steps in zero seconds, so that merge gate can never be red
and therefore can never block anything. Measured twice in this portfolio:
acmeorgd (TUN-402) and gemini, whose ruleset required
`🔍 Quality Checks / 🎭 Playwright E2E Tests` while its ci.yml skipped it.

Lisa shipped the guard, the npm scripts and the seeded declaration, but no
workflow ran it — so adopters had to wire it by hand and none did. This job
is that wiring.

OFFLINE, and now offline everywhere. The guard used to carry a `:remote`
arm that read the live ruleset over the network with `gh`; it needed an
`administration:read` token, which meant a standing repository secret in
every consumer to detect a rare event. Both the arm and the scheduled
workflow that ran it were removed (#3599). Two snapshots in one repo still
cannot see a ruleset edited in the admin console — that drift is now
discovered by consequence rather than by check, which is the accepted
trade. Do not wire a cheaper replacement here.

Both `[ ! -f ]` guards below are load-bearing, and they are why this cannot
redden a repository for a reason unrelated to skipped checks: a project
without the script (non-TypeScript stacks, anything not yet re-applied) or
without the declaration reports a notice and passes. What it will not do is
read nothing and call that a clean bill of health — it says which piece is
missing.

A SEEDED repository is the dangerous case, and it is handled inside the
guard (#2476). `required_contexts` is a CACHE of a live ruleset fetch, and
Lisa's seed ships it EMPTY and unstamped because Lisa cannot know what your
ruleset requires — an earlier seed shipped a guess that was measured wrong
in this fleet, claiming one context was required that no ruleset required
and omitting six that were. Until `ruleset.baseline_fetched_at` is stamped,
the guard prints NOT CHECKED and suppresses every rule that reads the
cache. It never prints a ✅ it cannot support. Refusal is exit 1 except
under the seed's `"enforcement": "warn"`, which keeps a fresh install loud
rather than red.
Gate-config validity. `lisa-gates.mjs validate` catches an unknown gate id,
a moment a gate cannot legally run at, and a malformed level — each with a
did-you-mean. It has always existed and, until this job, nothing ever ran
it: its only callers were prose lines inside lisa-doctor SKILL.md files, so
a typo'd gate id resolved to nothing and read as a working declaration.
That is `declared-but-uncallable` applied to config validation itself.

DELIBERATELY NOT A GATE, and deliberately not skippable via `skip_jobs`.
A project that could declare this `off` — or name it in `skip_jobs` — could
switch off validation OF ITS OWN gate declarations, which is the circularity
that manufactures vacuous greens in the first place. Everything else in this
workflow answers to the config; this is the one job that judges it.
```

## Note 10

The shared `.mjs` suite job runs only at the `pull-request` moment. Tooling
tests belong to PR verification; deployments do not rerun them. The job-level
condition enforces this even if a consumer's older gate planner fails or asks
for the job to run. Consumers need no deployment-specific opt-out or package
upgrade. PR declarations, cancellation, and explicit skip behavior still apply.

```text
DELIBERATE DIVERGENCE from the façade's fallback contract, which
elsewhere reproduces "today's behavior" byte for byte for an
unmigrated project.

For this gate today's behavior is NOTHING — that is the defect. Lisa
ships nine `.mjs` guards to every project and four more to expo
consumers, and every test config Lisa ships collects only `.ts`/`.tsx`,
so a consumer who writes a test beside one of those guards gets a
suite that never runs and a green build saying so. Measured downstream:
37 such suites, 13 enforced by nothing, 229 stranded test cases.

Preserving "nothing" would make the fix opt-in, which is the half
measure this exists to avoid. So the fallback RUNS the shipped script.
`test:node` is force-installed by the package templates, so it is
present in any project that has applied Lisa.

The script is loud about collecting zero: `node --test` exits 0 on a
glob that matches nothing, so the script counts the collection itself
and returns non-zero when it is empty. A project with genuinely no
`.mjs` suites declares the gate `off`, where the decision is visible.

An ABSENT runner is a THIRD state, and it is the one that bit. It is
not an empty collection — it is a gate that cannot run at all. This
branch used to print a `::warning::` and fall off the end of the
script, so it exited 0: the one job whose entire purpose is to stop a
suite from passing without running reported success having run
nothing, on every project that had not re-applied Lisa. Measured on
this repository, whose own `scripts/lisa-test-node.mjs` does not
exist: `🧪 Run .mjs Suites` = success, zero suites collected.
```

## Note 11

```text
FALLBACK — for a project with no `gates` block. Resolved from the same
places the gate resolver above looks, and for the same reason: the
prover ships INSIDE the package, so a project that has never
re-applied Lisa still has it under node_modules and this path is not
an absence probe. If nothing resolves, that is a broken install and
the step FAILS. It must never exit 0 having scanned nothing — a clean
report from a scan that never ran is the exact defect this gate was
written to catch.

FOUR candidates, in two pairs, because this workflow is consumed at
`@main` while the package is version-pinned: a consumer runs today's
workflow against whatever release it last upgraded to (#2951). The
prover moved from `scripts/` to `all/copy-overwrite/scripts/` 72
minutes AFTER a release, so both PACKAGE layouts are live in the fleet
at once and both are searched. A workflow change that references a
package path has to be backward-compatible with released layouts or it
breaks every consumer the moment it merges — the `previousLabels`
shape: when an artifact moves, support both locations across the
transition.

The two pairs are not interchangeable and the distinction is what made
#2951 hard to see. `node_modules/@codyswann/lisa/...` is PACKAGE-
relative and is what a consumer has; the bare paths are HOST-relative,
matching an installed copy (`scripts/`) or Lisa's own checkout. The
host-relative `scripts/` candidate does NOT cover the packaged
`scripts/` copy, and Lisa is the one repository where a host-relative
candidate resolves — which is why Lisa's own CI cannot catch a
consumer-only miss here, and why the proof lives in a consumer-shaped
fixture (tests/unit/config/conflict-prover-consumer-layouts.test.ts).

`--root .` is NOT redundant, and the reasoning that said it was is
what turned #2951's first fix into a silent pass. Today's prover
defaults its root to the working directory; the prover in releases
BEFORE the move derives it from its own file location. Resolved at
`node_modules/@codyswann/lisa/scripts/`, that older prover walks the
PACKAGE directory: `git ls-files` there succeeds and lists nothing,
because node_modules is ignored. The gate then exits 0 reporting
"no leftover conflict markers in 0 tracked files" — a clean report
from a scan that never ran, which is exactly what the absent-prover
branch above exists to refuse. Measured against the real published
tarball: 0 files scanned without the flag, 5 scanned and 1 conflict
caught with it. The prover's own header predicts this failure mode.

The flag is a no-op on the current prover and a correction on the
older one, so one invocation is right on both — which is the same
both-layouts principle as the candidate list above.
```

## Note 12

```text
-----------------------------------------------------------------------------
Least-privilege token scope (deliberate, audited — see #1769)
-----------------------------------------------------------------------------
`contents: read` is the FLOOR for every job in this workflow. An audit of all
32 jobs found ZERO uses of `gh`, `github.rest.*`, `github.request`,
`GITHUB_TOKEN`, or `github.token` anywhere in the file, so no job needs a
write scope:
  - SonarCloud PR decoration is performed server-side by the GitHub App, not
    by the workflow token (the scan action receives SONAR_TOKEN only).
  - Snyk / GitGuardian / FOSSA / Maestro authenticate with their own secrets.
  - `zaproxy/action-baseline` runs with `allow_issue_writing: false`; if that
    flag is ever flipped to true, that job — and only that job — needs
    `issues: write` added at the job level.
  - `actions/github-script` in audit_logger only writes a local file and the
    step summary; artifact upload/download and cache use the run-scoped
    runtime token, not GITHUB_TOKEN.
  - verification_coverage deliberately reads PR labels from the event payload
    instead of the API, so it must NEVER gain a `pull-requests` scope.
This workflow is `workflow_call`-only and consumed fleet-wide via @main.
Reusable-workflow tokens can only be DOWNGRADED relative to the caller's
grant, never escalated, so this floor is safe for every consumer: callers
granting >= read keep working, and no job relies on a write scope.
Jobs that touch neither the repository nor the API declare `permissions: {}`.
Never widen this floor — grant a job its minimal scope at the job level.
```

## Note 13

```text
─── Which Lisa ran this ─────────────────────────────────────────────────
A CONSUMER RUNS TWO LISAS AT ONCE. Its `package.json` pins
`@codyswann/lisa` at a version and that pinned copy governs the local
pre-push gate; its CI calls this reusable workflow at a floating ref and
THAT governs everything below. So a push-gate observation and a CI
observation are claims about different code at different versions, and
knowing the pin says nothing about what CI ran.

The consequence that made this a job rather than a note: a floating ref
means CI behaviour changes with NO COMMIT IN THE CONSUMING REPOSITORY, so a
true, well-evidenced warning about gate behaviour can go stale with nothing
in either repository able to notice. One such warning circulated for a day
after the behaviour it described had been repaired upstream. Nothing was
wrong with it except elapsed time, and no artifact carried a version the
claim could have been checked against.

ITS OWN JOB, NOT A STEP INSIDE A GATE. Every gate job below can be skipped
by a plan, fail early, or stand down; a stamp inside one is present exactly
when that gate ran. This job has no `needs` and no `if`, so the identity is
on the run whether the gates passed, failed, or were optional.

REPORT ONLY. It cannot fail a run and is not a branch-protection context:
a stamp that could redden CI would be a new gate nobody declared, shipped
to a fleet where every project reports.
```

## Note 14

```text
REPORT ONLY — it never fails the job and never changes what runs.
`|| true` is what makes that true rather than merely intended: the
body runs under `set -euo pipefail`, and the resolver is whatever
copy of the registry the project happens to have installed, which
may predate `unconfigured` and exit non-zero on it. Without it a
reporter would fail a branch-protection context — a new gate
nobody declared, shipped to a fleet where every project reports.

The steps below this one run a command written into this workflow,
and on essentially every installed project that is the DEFAULT rather
than the exception: nothing seeds a `gates` block into a consumer, so
`configured` is false and the property is proved by something the
settings file has no idea about. That was invisible until here.

Deliberately not a failure. The fallback cannot be deleted and an
absent declaration cannot be made fatal until a declaration is
guaranteed to exist, because this job's `name:` is a
branch-protection context and a required context that runs zero steps
reports GREEN. Order: seed declarations, then fail closed, then the
fallback is unreachable. This is the step that makes the size of the
gap measurable per repository in the meantime.

Uniform across every façade job by construction: the gate id and the
resolver both come from the resolve step's outputs, so this block is
byte-identical everywhere and cannot drift into naming the wrong gate.
```

## Note 15

```text
FALLBACK — for a project with no `gates` block.

Lisa's own source repo: check against ITS OWN source contract instead of
a published release. A pin necessarily lags by at least one release, so a
commit that changes the budget and migrates the ledger in the same breath
would be judged by the OLD budget — exactly the skew that failed the
#2001 deploy (ledger already at 11577 for the derived 12000 budget, pin
still enforcing the flat 4000). Detection is content-based (not a
repo-name match) so forks of the Lisa source behave identically.

Host projects: THE VERSION COMES FROM THE PROJECT. It used to be the
literal `2.297.0`, written here, which no project could override and
which sat sixty-odd releases behind — so every consumer's gate enforced
a contract none of them was on, and bumping it was an edit to a workflow
they do not own. The project's own `@codyswann/lisa` dependency range is
the version it actually runs, and `bunx` resolves a range. There is no
literal to fall back to: a project with no such dependency FAILS, because
guessing a version is how the stale pin happened.

The floor is >= 2.243.0 — earlier CLIs lack the relocated .lisa/ resolver
or this subcommand, and pre-2.237.0 CLIs self-skip in non-interactive
environments with exit 0. That floor is enforced by BEHAVIOUR rather than
by comparing version strings: the marker grep below refuses a run that
printed neither verdict, which is exactly what a self-skipping CLI does.
```

## Note 16

```text
NO GATE, AND NO CONDITION THAT CAN SKIP IT. This job is not declarable and
not skippable, by the same rule that exempts `🧭 Gate Config Validity`
above: a gate whose job is to detect silencing cannot itself be silenceable.
`if: always()` below is the opposite of an off-switch. Without it the
`needs:` edge would SKIP this job whenever a sibling failed or skipped, and a
skipped sibling is the one thing it exists to report.

It carried a `skipped_required_checks` skip token until #2933. #2846 read
the missing registry row as an oversight and proposed making it a declarable
gate; the owner's ruling was the opposite, and rests on the comparison the
issue itself drew. `gate_config_validity` is exempt and has NO skip token,
which is why nothing can silence it. This job was exempt and had one — so
the exemption bought it nothing and the off-switch was the whole problem.
Declaring it `off`, by either mechanism, means "I may silence a required
check without anyone objecting". Relocating that declaration from a workflow
input into a settings file would not have made it less self-defeating.

The general rule is recorded in `NON_DECLARABLE_JOBS` in
scripts/lisa-gates.mjs, so the next meta-gate inherits it rather than
re-arguing it, and `tests/integration/quality-non-declarable-jobs.test.ts`
refuses a skip token or a gate row for anything in that table.

WHAT IT JUDGES: OUTCOMES, NOT DECLARATIONS. It used to compare `skip_jobs`
TOKENS against the ruleset snapshot. `skip_jobs` was retired in favour of
gate levels, which skip a job through the gate plan and leave no token, so
the token arm kept printing `✅ 0 skip_jobs token(s) examined` — measured on
a caller pull request that merged with a ruleset-required context
`skipped`. It now `needs:` every other job, reads their results from
`toJSON(needs)` (no token, no API read), and FAILS when a required context's
job concluded `skipped` at the `pull-request` moment. The full argument, and
what it deliberately does not examine, is the `--outcomes` section of the
prover's header.
```

## Note 17

```text
THE PROVER TRAVELS WITH THE WORKFLOW, NEVER WITH THE CALLER'S PIN.
`quality.yml` is consumed `@main`; `scripts/` arrives by `lisa apply`
at whatever version the caller pinned. A copy predating `--outcomes`
ignores the flag and prints the vestigial token line as though it were
a verdict — the false green this job was retargeted to stop. The
workflow defines the arguments, so the code reading them has to come
from the workflow's side, and the caller's `scripts/` copy is not read
here at all.

Two sources, one rule — take the copy that ships with THIS workflow:

 - In this repository the workspace already holds it, at the template
   path, at exactly the revision under test. `hashFiles` is how a
   condition can ask that: it returns the empty string when nothing
   matches, so this step is skipped here and a change to the prover is
   proved by the pull request that makes it.
 - Everywhere else it is fetched from `main`, which is the ref every
   caller names in `uses:`. A caller pinning some other ref gets
   `main`'s prover; the two halves are released together at `main`, so
   that is the pairing to keep — and it is stated here rather than
   silently assumed.

`job.workflow_repository` / `job.workflow_sha` would say this exactly,
and GitHub REJECTS THE WHOLE FILE for using them: they are documented
on the `job` context and the expression validator does not define them
(measured — the run refuses to start, with no job and no annotation
beyond "workflow file issue"). Do not reintroduce them.
```

## Note 18

```text
DELIBERATELY no `permissions:` block. This job needs pull-requests:read
(`gh pr view`) and issues:read (`gh issue view`), but a called workflow
may only DOWNGRADE the caller's grant: requesting a scope the caller never
held is a startup_failure for the ENTIRE run, not a skipped job (#2046,
#2566). These workflows are consumed @main by repos whose ci.yml is
create-only, so an escalation here would break every one of them —
including on push paths where this job does not even run. Inheriting the
caller's token instead keeps the blast radius inside this job.

"Inherits the caller's grant" is only true because this workflow declares
NO workflow-level `permissions:` block. A workflow-level block is not a
floor — it is a CEILING that also zeroes every scope it omits, for every
job that declares none of its own. This workflow used to carry
`permissions: contents: read` at the top, and that silently capped this
job at contents+metadata no matter what the caller granted. Each job now
carries its own copy of that floor instead; this one, and only this one,
is left blank on purpose. Do not reintroduce a workflow-level block.

Corrects the record from #2476, which claimed this was measured working on
a consumer granting all three scopes. It was not: on 2026-08-14 two
consumers granting contents/issues/pull-requests read both received
`Contents: read, Metadata: read` and nothing else. The earlier red result
was read as a genuine missing trailer when it was this scope gap.

The readiness probe below FAILS when a scope is missing — it used to exit 0
with a warning, which reported success for a gate that had verified
nothing. That strictness is correct and must stay; the bug was the
plumbing, not the refusal.
```

## Note 19

```text
Gate façade — contract and fallback rationale documented in full on the
🧹 Lint job above, with ONE difference that matters: this is the SECOND
prover of `dependency-vulnerability`. 🔒 Security Scan proves the same
property and carries its label, so that job is the one a ruleset matches
and this one must never be renamed onto that string — two jobs posting
one context is a check that cannot be reasoned about.

Which is why this job is named for the property and NOT for its gate's
label: `🛡️ Supply Chain Scan`, not `🛡️ Snyk Dependency Scan` and not
`🔒 Security Scan`. A check name that carries a vendor compiles that
vendor into every ruleset matching it, which turns swapping the scanner
into a coordinated migration instead of an edit here.

The two are kept because they answer the question at different depths,
which the fallback comment on the other job already states: ship-scope
audit there, dev-dependency and supply-chain coverage here via
`--all-projects`. That is a reason to run both, and equally a reason one
green cannot speak for both.

Resolving the declaration here is what makes `off` mean `off`. Before
this, declaring `dependency-vulnerability` off silenced the audit and
left this scan running — a declaration satisfied in one job and ignored
in another, which is the defect this epic keeps finding one layer up.
```

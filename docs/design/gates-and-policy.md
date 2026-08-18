# Gates, policy, and artifact selection

Decision record for the gate subsystem. Captures what was settled and, more
importantly, *why* — several decisions here look arbitrary until you know which
measured failure they exist to prevent.

Tracking issue: CodySwannGT/lisa#2579.

## The organising defect

Every decision below is downstream of one failure mode: **a check reporting
satisfied without having proved anything.** It has appeared in this repository in
at least nine distinct forms, each found only after it had already let something
through:

| form | evidence |
| --- | --- |
| required-and-skipped | GitHub counts a SKIPPED required check as SATISFIED, so a job named in `skip_jobs` reports green having run zero steps |
| required-and-hollow | a required `CodeRabbit` context posted `success` with description `Review rate limited`, having reviewed nothing, on two security-relevant PRs that merged (#2497) |
| advisory-and-confusable | a not-required `🧪 Run Tests` beside the required `🧪 Run Unit Tests` merged red on two PRs (#2485) |
| passing-with-no-work | `passWithNoTests: true` shipped in five stack configs AND as six `--passWithNoTests` CLI arguments in four package templates, which overrode the configs — so a unit-test gate reported green having run zero tests (removed from both channels, #2603) |
| declared-but-uncallable | `secrets.require` was documented as a startup assertion whose only caller was a bash line inside a SKILL.md |
| enforced-off-the-path | 23 of 37 `.test.mjs` suites downstream were wired only into `.husky/pre-push.local` (measured); a pre-push hook cannot run where no local push happens — auto-merge, a merge performed in the UI, a change committed CI-side — so a pass/fail guard would have called them protected. The count is measured; the non-firing is inferred from how git hooks work, not observed. (`[skip ci]` is the converse and does NOT belong here: the hook fires, CI does not — a gap in the other direction) |
| verified-then-invalidated | gates ran alphabetically, so `artifact-freshness` proved the evidence manifest current and `code-style` then reformatted the sources it hashes — a PASSED verdict about a tree that was not the tree committed (#2590) |
| declared-but-ungoverning | `off` did not turn a job off. `resolveMoment` dropped an `off` gate, so the CI façade wrote `configured=false` — the same value it writes for a gate never mentioned — and the fallback fired on `!= 'true'`, which both states satisfy. Lisa's built-in tooling therefore ran regardless of the declaration. Harmless where the fallback reproduces what the project already did; not harmless for `test-node-suites`, whose fallback FAILS on zero collected, so two zero-suite repositories declared it `off`, validated clean locally, and still went red — one on a deploy. A declaration that governs nothing is worse than none, because it reads as a decision that was taken (fixed: three states, `true` / `false` / `off`) |
| selected-nothing | a moment is read as a KEY on each gate, so an unrecognised one matched nothing and resolved to `[]`, which every consumer read as "this project declares no gates here". Measured before the fix: `lisa-gates.mjs list --moment=continous:dev` printed `[]` and exited 0, and `lisa-run-gates.mjs --moment=continous:dev` printed `✅ 0 proved, 0 failed ... of 0 gate(s) declared` and exited 0 — the line the husky hooks read as "every required gate was proved". One typo deselected the entire registry and reported success. Unreachable from outside while every call site passed the literal `pull-request`; adding the `moment` input to `quality.yml` is what would have made it caller-reachable, so `resolveMoment` now refuses a moment that cannot exist. `[]` remains a truthful answer for a real moment at which nothing is declared — the guard distinguishes the two, which is the whole point |

The rule that falls out, and the one to apply when a new case is ambiguous:

> **A check that could not run must never render as a check that passed.**

And the reason this matters more than an ordinary bug: **a gate that reports
success having proved nothing is strictly worse than no gate at all, because it
retires the suspicion that would otherwise prompt someone to look.** No gate
leaves a known hole. A vacuous gate closes the hole on paper and leaves it open
in fact — and the closing is what stops anyone checking.

## A guard is only proven by a bite control

Every rule below describes how to *build* a gate. This one is about how to know
it works, and it is the cheapest high-value practice in the whole subsystem:

> **Force the guard to fire once on a deliberate violation, or you have shipped
> a green light wired to nothing.**

Write the test, confirm it fails against the unfixed artifact, then fix and
confirm it passes. The pre-push audit fix did this — three of five assertions
fail against the pre-fix copy — and that RED step is the only reason the fix is
trustworthy where the original was not. Nothing else distinguishes a guard that
works from one that merely runs.

**A gate that can never fail and a gate that can never pass are the same defect
class**, and neither is visible without deliberately mutating the thing under
test. Both have shipped here:

- *never fails*: the audit above; a proximity guard satisfied by its own doc
  comment; a required E2E check where `skipped` counted as satisfied
- *never passes*: a worktree-exclusion guard that read a non-empty `lintFiles()`
  result as proof of linting, when an explicitly-passed ignored path returns an
  *ignored warning* rather than nothing; a Maestro assertion targeting a testID
  the component overrides on exactly the branch under test

The never-passes case is the more insidious of the two, because it *looks*
strict. A gate nobody can satisfy gets waived, and the waiver outlives the bug.

So the RED proof belongs in the guard-authoring path itself, not in whoever
happens to remember it.

## Gate versus policy

A **gate** is a property of a *change*. Something runs, produces a verdict, and
the change is blocked or not.

A **policy** is a property of the *repository*. Nothing runs. It has drifted or
it has not.

The distinction is not taxonomy — it changes the response. A gate failing means
stop; a policy having drifted means **put the setting back**. That is why
`policy.on_drift` defaults to `repair` and no gate ever does.

`review-completion` and `branch-protection` were briefly modelled as gates with
`implementation: "lisa"`. That was a category error: nothing ran and nothing
produced a verdict. They are policy, and declaring them under `gates` now fails
with that explanation.

## One axis: the moment

A gate declares **when** it runs, never where.

```
session-start · pre-tool · commit · push · pull-request
pre-deploy:<env> · post-deploy:<env>
```

Surface is *detected*, not declared. Requiring people to restate it produced
three disagreeing vocabularies for two different questions — `local`/`remote` in
the tool manifest, five real surfaces in the secrets resolver, and `ci:<env>` in
the first draft of the gates block.

**Legal moments are enforced per gate**, so wrong configurations are
unrepresentable rather than discouraged: type-aware lint needs a whole-project
build and cannot be declared at commit; DAST, performance, load and
accessibility need something deployed and are deploy-only.

A registry that disagrees with the repository is worse than a permissive one.
`structural-rules` was originally push-onward until `.lintstagedrc.json` was
found running `ast-grep scan` at commit — the registry was silently discarding a
real gate, and was corrected rather than the repository.

## The handover is one property at a time

A git hook proves things the registry can also prove, so when a `gates` block
takes a moment the hook's built-in steps must stand down — or the work is done
twice. The question is what licenses that.

**Not the runner's exit code.** Exit 0 says the gates that were *declared*
passed. It says nothing about whether the block covers the properties the
built-in steps prove, so using it as an all-or-nothing switch lets a block that
declares `code-style` and is silent about `credential-leakage` delete the secret
scan by omission. That is the subsystem's own defect class — a control
returning success for an input it never examined.

So the runner writes the properties it covers to the file named by
`--coverage`, one gate id per line, and each built-in step consults only its
own. A half-declared block loses nothing: the registry runs what it declares,
the hook runs the rest. Three consequences fall out of it:

- **The vocabulary is a contract.** `BUILTIN_FLOOR` and `CONDITIONAL_FLOOR` in
  `lisa-run-gates.mjs` are the only ids a hook may name, and each entry records
  the exact condition the shell branches on — a package script, or a file on
  disk. A step whose property is not in that vocabulary always runs.
- **Conditional steps are per project.** `lint:slow`, `knip`, `test:mutation`
  and the derived-artifact check self-skip where they are unwired, so a project
  without them loses nothing; a project *with* them is proving that property on
  every push, and silence about the matching gate must not delete it.
- **Some steps cannot be handed over at all.** The commit-time threshold
  ratchet has no registry counterpart legal at `commit`
  (`threshold-monotonicity` is push-onward and compares against `HEAD^`, while
  the commit check compares the staged change), so it sits outside the handover
  and always runs.

Every route to "I do not know" — no coverage file, an empty one, a runner that
could not run, an inexact match — runs the built-in step. A caller that does not
pass `--coverage` is an older hook whose only lever is all-or-nothing, and for
that one the runner still withholds the whole moment until the block is
complete.

## Requirements follow the work, not the surface

A gate declares `needs: {tools, secrets}`. Whatever runs at a moment therefore
needs the union of what those gates declared.

```json
"e2e-native": {
  "run": "test:e2e:native",
  "needs": { "tools": ["maestro"], "secrets": ["MAESTRO_API_KEY"] },
  "pull-request": "optional",
  "pre-deploy:production": "required"
}
```

Maestro is required exactly where that gate runs. This replaces guessing a floor
from `tracker` and `secrets.provider`: "what does this session need" becomes a
fact rather than a heuristic, and no surface declaration is involved.

## Two proof modes

`run` executes a task and reads its exit code. `await` watches an external
signal and reads its verdict. **Which applies is the project's choice, not the
gate's** — Snyk can be a CLI you run or an app that reports.

A gate may use different provers at different moments. That is the normal shape
for code review: an agentic review before push, a bot on the pull request.

Awaiting before a pull request exists is refused. A check that can never fire is
a declared guarantee that never runs.

## Hollow results

Two forms, one response model.

**Description-shaped** (`await`): `proof` phrases are matched strictly —
whole-description, case-insensitive — because a match *grants* credit. `no_work`
phrases are matched loosely as substrings because a match *denies* credit and
vendors decorate their own strings (`Review rate limited (retry in 12m)`).

**Count-shaped** (`run`): a gate declares what nonzero work proves it ran —
tests executed, mutants generated, rules loaded, URLs scanned. Absent a count,
work is **unknown**, which should report as hollow rather than passing —
**planned, not yet built**. `lisa-run-gates.mjs` carries the `work` phrase and
classifies on the exit code alone, so today a `run` gate that did no work
reports `passed`. Listed under Open items; the description-shaped half above
is implemented.

Three responses, per gate: `report` (default), `wait`, `block`. `wait` requires
a bound — an unbounded wait blocks a pull request with no signal, and the
fastest way out of that is deleting the requirement, which is how a rename
removes a guarantee.

**Phrases extend, never replace.** Removing a shipped `no_work` phrase narrows
detection with no signal that it was narrowed. A default that misfires for some
vendor is an upstream bug to fix once, not something each project suppresses —
local suppression lists become the bypass.

**The claim is not configurable.** Whatever the response, a hollow result is
recorded as unproved. You may configure whether to stop; you may not configure
it into having been proved, or `on_hollow: report` becomes a way to launder an
unreviewed merge.

## Contexts are derived, never transcribed

`contextsFor(gates, {moment})` produces the branch-protection contexts a
repository should require. This replaces a hand-maintained snapshot that shipped
empty, carried a 90-day expiry, and had already been measured wrong in both
directions (#2476) — because nothing could derive the truth and nothing could
tell you the copy had gone stale.

Only `required` produces a context, which is what makes the three levels safe:

| level | job | in required contexts | result |
| --- | --- | --- | --- |
| `off` | never runs | no | nothing to vacuously satisfy |
| `optional` | runs, real pass/fail | no | shows red, does not block |
| `required` | runs | yes | red blocks |

Because one declaration drives both the job condition and the context list, the
skipped-but-required hole is unrepresentable rather than merely discouraged.

`optional` must never be `continue-on-error: true` — that makes a failing job
report green, which is the defect itself in a new costume.

**A level only means this once the job resolves it.** The table describes what a
declaration *is*; a CI job delivers it only if it reads the declaration. The
`🔗 Work-Item Traceability` job did not: its condition keyed on the `skip_jobs`
workflow input alone, so `gates.traceability` governed the local runner and
governed nothing in CI — `off` still reddened every pull request and `required`
changed nothing, because the job already ran (#2680). It now resolves the gate
through the same façade as every other job in `quality.yml`.

**What an undeclared gate does, everywhere in that workflow:** the resolution
reports `configured=false` and the job runs Lisa's built-in tooling, byte for
byte as it did before the façade existed. `configured=false` covers all of: no
resolver present, no `gates` block, the gate not declared at the moment being
resolved, and the gate declared `await`-proved rather than run. A gate declared
`off` is a *different* answer (`configured=off`) and reaches neither branch, so
the job runs no gate work and reports green having correctly done nothing.

## Renames, and why they are dangerous

Job names are branch-protection contexts matched by exact string. A renamed job
means the old context stops reporting, every in-flight PR blocks, and the
fastest fix is deleting the requirement — so a rename ends up *removing* a gate.

Mitigations, in order: never rename casually; `contextsFor` accepts
`previousLabels` so both contexts can be required during a rollout; reconcile
rulesets promptly, since Lisa already writes them.

Reconciliation may **add** a missing context under `repair`. Removing an EXTRA
one requires explicit `--prune`, because an extra required context may be an
external app Lisa does not manage, and removing it silently strips protection.

That rule earned itself before shipping: three contexts required on `main` —
Security Scan, Work-Item Traceability, Plugin artifacts match source — produced
no derived context, so a ruleset regenerated from config alone would have
dropped them. Work-Item Traceability has since been declared and now derives;
the other two still do not, and the rule stands for them.

## A template change lands on a schedule nobody chose

Consumer `package.json` scripts are Lisa-managed through the `package-lisa`
merge, and `bun install` runs `lisa apply` in the consumer repos. So a template
edit does not reach a project when someone decides to take it — it reaches them
at **the next arbitrary developer's or agent's install**, mid-session, to
somebody who never read the pull request.

That is fine when the change is additive. It is not fine when the change removes
a tolerance, which is exactly the shape of "no backward compatibility" work:
deleting `--passWithNoTests` from four package templates changes what a green
build means, for four repositories, at an unpredictable moment.

**So verify the blast radius is empty BEFORE merging, not after.** For #2603 that
meant enumerating every consumer's integration-test collection and confirming
none was empty — four repositories, measured, before the flag was removed. Had
one been empty, the correct response was to stage its declaration first and
merge second, not to merge and let it be discovered at install time.

The residual risk is honest and worth naming: a consumer that appears *later*
with an empty collection meets the change at install time with no warning. A
measured-empty blast radius is a statement about the consumers that exist today,
not a property of the change.

Credit for the principle to the session that measured it rather than to this
document.

## The interface is the evidence shape

A task name is not an interface. If Lisa standardises only *how to invoke*, the
register records "test:cov passed" and cites nothing — as true of a scrupulous
project as a careless one. Standardising what comes **back** is what lets jest
and vitest both satisfy `coverage-adequacy`, and what lets an attestation quote
a number instead of a verdict.

Every implementation emits the same envelope, whatever tool produced it:

```json
{
  "gate": "coverage-adequacy",
  "status": "pass | fail | unknown",
  "work": 412,
  "measures": { "statements": 87.4, "branches": 71.2, "threshold": 80 },
  "prover": { "tool": "vitest", "version": "4.1.9" },
  "observed_at": "2026-08-15T18:02:11Z",
  "max_age_minutes": 1440
}
```

- **`status`** is three-valued. `unknown` is not a synonym for `fail`.
- **`work`** is the count that proves it *ran*. `null` forces `unknown` — the
  `passWithNoTests` hole closed structurally rather than by vigilance.
- **`measures`** is what an attestation actually cites.
- **`prover`** records which implementation produced it. Vendor-neutrality means
  Lisa does not *mandate* a tool, not that it declines to *record* one; an
  auditor asking "what measured this?" deserves an answer.

Per-gate measures are small and mostly obvious: coverage reports its metrics and
threshold, mutation its mutants and score, load its percentiles and error rate,
scanners their findings by severity. Generative testing is the one with a
distinctive shape, because SI9 asks for a *declared inventory* rather than a
verdict:

```json
{ "invariants": 12, "dimensions": ["unicode", "depth", "size"],
  "cases_generated": 120000, "counterexamples": 0, "seed": "0x4f2a…" }
```

`seed` matters disproportionately: a property run that found nothing is only
meaningful if someone can re-run *that* exploration. Without it the evidence is
unreproducible, which is a strange thing for evidence to be.

## What Lisa owes, and what the project owes

Lisa defines interfaces; projects implement them. `test:cov` is the interface,
vitest or jest the implementation; `load-capacity` is the interface, k6 or
JMeter the implementation. Lisa ships defaults two ways — deterministic starters
or an agent implementing the interface for a given stack — and the project makes
the final call.

**No conformance policing.** An early draft proposed mandatory probes to prove
an adapter really detects what it claims. That was the wrong threat model:
`off` already exists, is one word, and is honest, so faking an adapter costs
more effort and buys the same outcome. Nobody rational picks deceit. The
register stays honest by making honesty cheaper, not by making deceit
impossible.

Which puts the obligation somewhere unexpected: **`off` must read as a declared
scope boundary, never as an admission of guilt.** If it carries stigma, people
fake instead — and the policing that was rejected on principle becomes necessary
in practice, having been caused by the rendering.

Probes survive as a *development aid* inside the adapter-generating skill —
"point it at something returning 500s and check it notices" — which is guidance
toward an implementation, not a gate over one.

## The environment facade, and why it verifies when nothing else does

`environment-reset` and `environment-reseed` are the first gates where Lisa
ships **no implementation at all**. Lisa names the interface —
`environment:reset`, `environment:reseed` — and every project supplies what
happens behind it and whether it is required, optional, or off. Nothing else in
the registry works this way, so two consequences are worth stating.

**The gate's task is the VERIFY, not the reset.** A gate whose task were
`environment:reset` would converge a shared environment on every pull request
that declared it required. That is not hypothetical: a repository in this
portfolio already runs an unconditional reset job, destructive to shared dev
data, on every invocation including `workflow_dispatch`. So the reset itself is
a **precondition** a workflow calls before a suite, outside gate ordering
entirely, and the gate runs `environment:reset:verify`.

Ordering is why it cannot be otherwise even in principle. Gates sort
alphabetically, and `e2e-browser` and `e2e-native` both sort *before*
`environment-reset` — so a reset-as-gate would run after the suites it exists
to precede. A reset is not a verdict about the world; it is a change to the
world, and the registry's `mayRewrite` flag covers that hazard only at
working-tree scope.

**This is not the conformance policing rejected above, and the difference is
the risk class and the subject — not anyone's intent.**

A load-capacity adapter that overstates itself yields a weaker signal. A reset
guard that can be stepped around can be pointed at production. That alone is
why the two are not comparable.

The cleaner distinction is **what is being asked to prove itself.** "No
conformance policing" forbids making an *adapter* demonstrate that it detects
what it claims — a competence claim about the adapter, and the section is right
that `off` is cheaper than faking one. `environment:reset:verify` asks the
**deployed system** to demonstrate that it *refuses*. That is a safety property
of the environment, in the same category as "production must reject a
test-auth bypass", which nobody would call policing.

Deliberately *not* argued on intent. An earlier draft of this section
distinguished the cases by saying the reset adapter is written in good faith
and merely misplaced — true of the instance that prompted it
(`assertAllowedResetUrl`, re-checked before every fetch, living client-side
where the caller can edit it), but unfalsifiable as a rule and certain to be
re-litigated by whoever reads it next. The subject axis holds without anyone
having to agree about motives.

**What is verified is unbypassability, not location.** "One guard location,
inside the lambda" is the means; the property is that the guard cannot be
stepped around. Lisa cannot inspect where a guard lives without knowing the
implementation, which the facade forbids — but it can require a behaviour:

> Call the reset entry point **directly, outside the project's own client**,
> against a target the guard must reject. Require a refusal.

A server-side guard refuses. A client-side guard is not on that path, so the
call succeeds and the gate goes red. That distinguishes the two architectures
by behaviour alone, needs no knowledge of the implementation, and turns an
architectural assertion into something that can actually fail. It is also safe
to run anywhere, because it exercises only the refusal path and converges
nothing.

`work` is `"refusals proved"` rather than a count of entities touched: a reset
that converged nothing may be perfectly correct, so **these gates must not
inherit the fail-on-zero rule** that `test-node-suites` carries. Zero suites
collected proves nothing; zero entities converged can mean the environment was
already clean.

## Continuous gates gate a state, not a change

Every other moment blocks a diff. A scheduled run has none: by the time a
nightly fails, whatever it covered merged hours ago. What it establishes is
whether a target is healthy, so the enforcement point is **promotion out of
it** — a red `continuous:staging` means staging is not promotable, which a
`pre-deploy:production` gate can require.

TASC SI9 requires this directly for generated testing: confining generation to
the per-change gate explores far less of the input space than generating new
cases against a stable one. It applies just as forcefully to a CVE published
today, which makes yesterday's dependency scan wrong with no change at all.

Two hazards, both new flavours of the organising defect:

**Stale evidence.** A change-triggered gate's evidence is inherently fresh — it
ran on that diff. A scheduled gate's has an age, and a green from six days ago
proves nothing about today. Evidence read past its bound yields `unknown`, never
`pass`. The corollary is uncomfortable and correct: a scheduler that quietly
died must block promotion rather than let last week's result stand in for this
week's, which is AC7.1's liveness requirement arriving from another direction.

**A frozen pipeline nobody is watching.** A gate that fails at 3am has no human
attached to it the way a pull request does. So a failing continuous gate must
produce a run outcome and route into intake rather than sit red — AC7.3's
*recovery-required*, and the shape the QA loop already uses.

Blocking is the default because promoting off a known-bad environment is worse
than a stalled promotion. It is configurable through the same three levels as
everything else: `required` blocks, `optional` reports, `off` does not run.

## Substrate precedence

Where a capability has several substrates (CLI/API token, vendor CLI, MCP),
rank them by two properties rather than by kind:

1. **Non-interactive auth** — can it authenticate with no human at a browser?
   Anything that cannot is unusable in cloud sessions, cron loops and CI, which
   is where the factory actually runs.
2. **Tenant-scopable** — can two projects on one machine target different
   tenants? Browser OAuth generally binds one identity per profile.

MCP-versus-CLI is only a proxy for these and is sometimes the wrong proxy: the
Sonar MCP authenticates from environment variables and is headless-capable,
while the Linear MCP needs browser OAuth. Rank the properties, not the kind.

A demotion to a lower substrate must be **reported, never silent**. On a surface
where the fallback cannot work at all, refuse up front rather than at first use.

## Artifact selection

Plugins and MCP servers should be installed based on what the project actually
uses, derived from the same declaration as everything else.

Three install shapes, not two:

| shape | example | how it arrives |
| --- | --- | --- |
| plugin | coderabbit, playwright | marketplace install |
| MCP server | linear, maestro | registered in config; injects tool schemas |
| vendor CLI that self-integrates | sonar | CLI on PATH, then `<vendor> integrate <agent>` writes per-surface shims |

Motivation is not tidiness. Every MCP server injects its tool schemas into every
session; plugin sync has already caused nine-minute boots off a 40MB
`installed_plugins.json`; and a plugin never installed needs no credential,
which shrinks what the readiness preflight must assert.

`selectProjectLisaPluginsFromState` already does this for Lisa's *own* plugins,
keyed on config presence. Third-party plugins and MCP servers are the gap.

**Removal is opt-in.** Report an artifact that is no longer implied; remove it
only under an explicit flag. Same rule as extra required contexts — silently
removing something a human may have installed deliberately is destructive on a
guess.

## Open items

- Tests are excluded from the typecheck program (`tsconfig.json` is
  `include: ["src/**/*"]`, `exclude: ["**/*.test.ts", ...]`), so the
  `🔍 Type Check` gate has never checked a test file. Three agents shipped
  `@returns {object}` without CI noticing.
- `security:audit` has no package script, so the `dependency-vulnerability`
  gate cannot yet be wired and its required context cannot be derived.
  `check:work-item` and `check:thresholds` now exist in `package.json`.
- Count-shaped hollow detection is **specified but not implemented** for `run`
  gates. `lisa-run-gates.mjs` carries each gate's `work` phrase through
  `resolveMoment` and never inspects it — it classifies purely on the exit
  code, so a `run` gate that did no work reports `passed`, not hollow. Until a
  count is read, that half of the model is a claim rather than a control.
- A gate enforced *inside another job* (`conflict-residue` runs within the
  Plugin-artifacts job) has no context of its own, so it cannot be declared
  `required` without naming a context that does not exist.
- `plugins-sync`'s "generated plugin tree matches source" has no registry gate;
  adjacent to `artifact-freshness`, different artifact.
- **Lisa's own `gates` block does not reach Lisa's own CI.** The façade resolves
  through `node_modules/@codyswann/lisa/all/copy-overwrite/scripts/lisa-gates.mjs`
  or a copied `scripts/lisa-gates.mjs`. This repository has neither — it
  devDepends on a `^2.x` range that predates the script, and it carries no copy
  of its own copy-overwrite output — so `RESOLVER` is empty and every façade
  job writes `configured=false` and runs its fallback. Measured 2026-08-18 on a
  pull-request run: `🧹 Lint` and `🔗 Work-Item Traceability` both took the
  fallback branch while `.lisa.config.json` declared both `required`. The
  fallbacks are the same tooling, so nothing is unenforced — but every level
  Lisa declares for itself is currently inert, which is the #2680 shape one
  layer up. Distinct from #2680, whose fix this is not.
- `quality-rails.yml` carries the same `work_item_traceability` job and **no
  gate façade at all** — no `moment` input, no `package_manager` input, and so
  no resolve block. `gates.traceability` is therefore still inert for a Rails
  consumer, exactly as #2680 describes. Converting that workflow means bringing
  the façade to it, not bolting a second on/off mechanism onto one job.

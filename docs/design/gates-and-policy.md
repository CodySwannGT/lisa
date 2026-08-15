# Gates, policy, and artifact selection

Decision record for the gate subsystem. Captures what was settled and, more
importantly, *why* — several decisions here look arbitrary until you know which
measured failure they exist to prevent.

Tracking issue: CodySwannGT/lisa#2579.

## The organising defect

Every decision below is downstream of one failure mode: **a check reporting
satisfied without having proved anything.** It has appeared in this repository in
at least five distinct forms, each found only after it had already let something
through:

| form | evidence |
| --- | --- |
| required-and-skipped | GitHub counts a SKIPPED required check as SATISFIED, so a job named in `skip_jobs` reports green having run zero steps |
| required-and-hollow | a required `CodeRabbit` context posted `success` with description `Review rate limited`, having reviewed nothing, on two security-relevant PRs that merged (#2497) |
| advisory-and-confusable | a not-required `🧪 Run Tests` beside the required `🧪 Run Unit Tests` merged red on two PRs (#2485) |
| passing-with-no-work | `passWithNoTests: true` ships in five stack configs, so a unit-test gate can report green having run zero tests |
| declared-but-uncallable | `secrets.require` was documented as a startup assertion whose only caller was a bash line inside a SKILL.md |

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
work is **unknown**, which reports as hollow rather than passing.

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

That rule earned itself before shipping: three contexts currently required on
`main` — Security Scan, Work-Item Traceability, Plugin artifacts match source —
produce no derived context, so a ruleset regenerated from config alone would
have dropped them.

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
- `security:audit`, `check:work-item` and `check:thresholds` have no package
  script, so three currently-required contexts cannot yet be derived.
- A gate enforced *inside another job* (`conflict-residue` runs within the
  Plugin-artifacts job) has no context of its own, so it cannot be declared
  `required` without naming a context that does not exist.
- `plugins-sync`'s "generated plugin tree matches source" has no registry gate;
  adjacent to `artifact-freshness`, different artifact.

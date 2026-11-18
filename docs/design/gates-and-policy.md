# Gates, policy, and artifact selection

Decision record for the gate subsystem. Captures what was settled and, more
importantly, *why* — several decisions here look arbitrary until you know which
measured failure they exist to prevent.

Tracking issue: CodySwannGT/lisa#2579.

An open review of every gate interface (one row per registry gate, with a
decision column) lives in
[`gate-interface-review.xlsx`](gate-interface-review.xlsx). It was built from
the registry on 2026-11-12, so check it against `REGISTRY` in
`all/copy-overwrite/scripts/lisa-gates.mjs` before relying on it.

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

| valid-to-one-tool | `lisa-gates.mjs validate` called a declaration BLOCKING while `lisa-run-gates.mjs` resolved the same declaration, executed it, and printed `1 proved`. Measured on one fixture — a deploy-only gate declared at `pull-request` in a project shipping the aliased `security:zap` script — where `validate` exited 1 with `cannot run at "pull-request"` and the runner exited 0. One tree, one config, opposite verdicts, and which one an operator got depended on which command they happened to type. That instance failed in the SAFE direction (something ran that should not have), but nothing about the divergence made that the direction: a declaration `validate` accepts and the runner declines to execute is a silent skip reporting green. Fixed by making the runner call the validator's own reading — `configurationProblems`, of which `validate` is now the other caller — over `declarationsAt`, the block narrowed to the moment being run (#3042) |

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
complete. The same caller is answered 78 after a run in which a gate's parts
did not reach every path the change touches: it cannot keep one built-in
check on its own, so it keeps all of them. See "A part the change does not
touch".

### A caller with no built-in checks

Everything above assumes the hook has checks of its own to keep. The hooks a
stack template ships do. A repository on no supported project type has no such
hook: whatever calls the runner there — the carrier the enforce step installs —
has nothing behind it. For that caller, exit 78 ("run your own checks instead")
is an instruction it cannot follow, and obeying it would let a commit through
having checked nothing.

So the caller says which kind it is. `--builtins=none` tells the runner there
are no built-in checks behind this call, and the runner then answers with a
verdict every time:

| Exit | Meaning for the caller                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------- |
| `0`  | Let it through. One of three things happened, and the runner says which: every required gate declared at this moment was proved; nothing is declared at this moment; or every part declared at this moment is for a folder the change does not touch, so no command ran. |
| `1`  | Stop it. A required gate was not proved, or the declaration is one the validator refuses.                        |
| `70` | Stop it. The runner could not run (unreadable configuration, a flag it does not understand), so nothing was proved. |

**Exit 0 can mean no command ran.** Where a gate is declared with a part for
`api` and a part for `web` and nothing else, a commit that changes only
`tools/b.js` touches neither folder. Both parts print `NOT APPLICABLE`, the
tally reads `0 proved … 2 part(s) this change does not touch were not run`,
and the exit is 0: nothing the declaration covers changed, and this caller has
no check of its own to fall back to. A repository that wants every change
checked declares a part with scope `.`, which always runs.

It never answers 78. Three things change under the flag, and nothing else:

- **A half-written block is run, not withheld.** The floor lists what the
  caller's built-in checks prove. With no built-in checks there is no floor,
  so silence about `credential-leakage` deletes nothing — nothing was proving
  it.
- **No gates at all is a pass that says so.** The runner prints
  `No gates are declared in .lisa.config.json, so nothing was checked at
<moment>` and exits 0, and the evidence envelope still records `no-gates`.
  It is the same answer a gates block that is silent at one moment has always
  had.
- **A gate left to a built-in check is not proved.** The registry resolves
  some gates to `builtin`: the hook proves them with a step of its own. To a
  caller with such a step they print `SKIPPED`. To a caller with none they
  print `UNPROVABLE`, and a required one stops the commit, because otherwise a
  required gate would read as settled while nothing anywhere had checked it.

`--builtins=none` and `--coverage` say opposite things about the caller, so
the runner refuses the two together (exit 70) rather than pick one.

**No manifest is needed for any of it.** A part names its own command, so the
runner resolves and starts it whether or not the repository has a
`package.json`. A gate with _no_ parts still resolves to `<runner> <task>` as
it always has; in a repository with no manifest that command has nothing to
run, exits non-zero, and the gate is reported as not proved — at `required`,
where it stops the commit, and at `optional`, where it is reported and stops
nothing. It is never reported as passing.

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

`lisa doctor` follows that distinction for CodeRabbit. A `pull-request` gate
awaiting CodeRabbit is proven by the hosted check run; the local CLI is optional.
An installed optional CLI whose authentication cannot be verified produces a
warning. A project that runs CodeRabbit locally declares its tool dependency
beside the task:

```json
"code-review": {
  "needs": { "tools": ["coderabbit"] },
  "push": { "level": "required", "run": "review:local" },
  "pull-request": { "level": "required", "await": "CodeRabbit" }
}
```

Here `review:local` is the project's own task that invokes the CLI; Lisa does not
ship a CodeRabbit review runner or infer tool dependencies from shell text.
Doctor names `code-review at push` if that required CLI is missing or signed out.
An `optional` local task stays advisory, and an `off` task needs no CLI. Gate-level
`needs` on an awaited signal alone does not turn hosted proof into local work.
These diagnostics share one CLI across all supported agents and do not change
hosted evidence requirements or the optional CodeRabbit Claude plugin.

## An exit code is one bit, and two gates may share one prover

A coverage-instrumented suite proves `test-correctness` by passing and
`coverage-adequacy` by clearing its threshold. Running it twice cannot prove
more than running it once, so one command legitimately proves both properties —
and then exits `1` for either reason, with no way for the caller to tell which.

Reporting that single bit against both gates is what the runner used to do, and
it is the organising defect running backwards: **a property nobody measured was
reported as measured and found wanting.** In practice the gate printed
`coverage-adequacy — bun run test:cov (exit 1)` when what had happened was a
test's child process being starved of CPU by its own siblings. Six sightings
across three agents each cost a full investigation of a coverage threshold that
was never involved — and, worse, a genuine coverage regression would have been
indistinguishable from that flake.

Two repairs, and both are needed. `lib/gate-failure-diagnosis.mjs` reads the
failing command's own transcript and says WHICH failure it was, with precedence
timeout → assertion → threshold, because a run whose tests died still prints
coverage errors and they are always low. `ATTRIBUTION` then says WHOSE it was:
the property the transcript indicts reports **FAILED with the reason**, and a
gate that merely shares the prover reports **UNPROVABLE**. An attribution may
only ever move a verdict onto a gate that is itself declared on that same
command at that same moment, so a stray phrase in an unrelated tool's output
cannot invent one.

## Three ways not to be green, and they are not the same question

A reviewer looking at a gate that is not green is really asking *"does somebody
need to go and find out?"*. Collapsing the answers is how a careful observer
read six grey CI badges as "not applicable" when the honest reading was "we
never found out" — a misreading that, measured afterwards, was wrong about that
particular run and exactly right about the rendering.

| state | means | does somebody need to find out? |
| --- | --- | --- |
| `SKIPPED` | **not applicable** — nothing to run here, and there never was | no |
| `UNPROVABLE` | **ran, proved nothing** — no task resolved, or a shared prover failed on another property | yes, and it blocks |
| `NOT_RUN` | **verdict unknown** — the run reached a blocking failure first | yes, and nothing is known either way |

Fail-fast survives only where it buys something. A required failure no longer
stops the whole run: the cheap gates behind it still execute, so one push
attempt reports everything that is wrong instead of one thing per attempt. What
used to happen was that an intermittent test failure took the work-item check
and the type check with it — two checks that finish in under a minute and
answer questions a test suite says nothing about. Gates flagged `costly` in the
registry (a whole suite, a mutation run, an E2E pass) are the exception: paying
minutes for information about a push that cannot land is a bad trade, so they
report `NOT_RUN` and name the gate that stopped them. Like `mayRewrite`, the
flag is registry-only — the safe answer must not depend on who remembers to
type it.

## A suite that spawns a suite starves itself

`bun run test:cov` runs the whole suite across one worker per core. One of the
files in that suite spawned Stryker, which asks for one test-runner process per
core of its own. The child then waits for CPU that its own siblings are holding
and dies on its five-minute dry-run timeout — with **zero** other agents on the
machine required. Concurrent load makes it worse and is not the cause; the
correlation with a busy box was real and the causation was backwards.

CI never saw it because CI runs the unit pass and the integration pass as
separate jobs. That is the whole difference, and it is therefore the fix: the
push-moment provers run their passes separately too, via per-moment `run`
declarations (`test:cov:unit`, `test:integration:push`). The bite test is not
dropped — deleting the control that proves the mutation gate can fail would be
the defect at the top of this document — it moves to the moment that owns its
cost, alongside the pull-request mutation gate it is the control for.

Measured on the same machine at load ~150 on 18 cores: the split pass completed
745 files and 13,388 tests in 501s with **no timeout failures**, against a
merged pass that had been aborting at 460s on the nested dry run.

The general lesson is worth stating without the specifics: **a wall-clock budget
over a subprocess is a measurement of the machine, not of the code**, and a
suite that spawns a second copy of itself is the case where the machine is
guaranteed to be busy.

## A push pass is remembered by content

A retry, or a re-push of a tree that already passed (a rebase that changes no
content, a second branch, a push after a network failure), used to pay every
push gate again. `lib/gate-pass-cache.mjs` remembers a push gate's pass under a
sha256 key over everything its verdict can depend on: the pushed commit's tree,
the gate id and exact command, every lockfile present, the node and bun
versions, the `gates` blocks of `.lisa.config.json` and
`.lisa.config.local.json`, and an environment allowlist (`NODE_OPTIONS`,
`NODE_ENV`, `TZ`, and every `LISA_*` variable except the volatile
`LISA_GATE_CACHE`, `LISA_PUSHED_REFS_FILE`, `LISA_CLEANUP_SWEPT` and the
admission wait bounds `LISA_ADMISSION_MAX_WAIT` and
`LISA_ADMISSION_PUSH_MAX_WAIT`, which decide when a gate starts, never what it
proves). A hit
prints `CACHED PASS (<first 12 hex of key>)`, counts as PASSED, and does not run.
Entries live machine-wide under `${XDG_CACHE_HOME:-~/.cache}/lisa/gate-passes/`
and are pruned after 30 days.

Every rule fails toward running the gate:

- The cache is read or filled only when the working tree is exactly the tree
  being pushed — `git status --porcelain` empty and `HEAD^{tree}` equal to the
  tree of every non-deletion pushed ref — and passes are written only after the
  run, once the tree is re-read unchanged. A green must describe the pushed tree
  (CodySwannGT/lisa#3874).
- Only a full pass is remembered: never FAILED, KILLED, UNPROVABLE or NOT_RUN,
  and never a pass read off a shared prover that did not itself pass.
- A moment entry declares `"cache": false` beside `level` and `run` when its
  verdict depends on anything outside the key. Lisa marks `traceability` (reads
  the tracker), `threshold-monotonicity` (compares against `HEAD^`),
  `x-orphan-fixture-processes` (live processes), and `x-operational-hazards` and
  `x-withdrawn-rulings` (each also reads a machine ledger under `~/.lisa`). It
  sits on the moment entry, like `failure_shape`, because an older Lisa refuses
  an unknown gate-level key together with the whole gates block.
- CI (`CI` or `GITHUB_ACTIONS` set) never reads or writes it; CI always runs the
  full suite. `LISA_GATE_CACHE=off` switches it off for one run.
- It is off unless `pushGate.cache` is `true` (a TypeScript project defaults it on), and while
  off it is silent and touches nothing. Lisa turns it on for itself; TypeScript hosts get it
  by default (CodySwannGT/lisa#4611) and Rails hosts per #4613. `lisa apply`
  and the runner both refuse a value that is not `true` or `false`.

### `lisa check`: fill the cache before the push

Git opens the remote connection before the pre-push hook runs, and a hook that
runs past about 35 minutes dies with exit 141 even when every gate passes
(CodySwannGT/lisa#4505), so a long wait for machine headroom must not happen
inside a push. `lisa check` (CodySwannGT/lisa#4601) runs the same push gates
through the same runner — `lisa-run-gates.mjs --moment=push --coverage=<tmp>`,
the project's copy when it has one, else the one the installed Lisa ships —
against `HEAD`'s tree, outside the push. It sets `LISA_ADMISSION_MAX_WAIT`
(default `30m`, `--max-wait <duration>` to change it) so admission may wait
longer than the in-push bound. Its passes land in the cache, so the push that
follows reports every cacheable gate as `CACHED PASS`.

- A dirty working tree is refused (exit 1, "commit first"): the cache only
  records a pass for a clean tree equal to the pushed commit.
- A required gate that does not pass exits 1 with the runner's own lines.
- With `pushGate.cache` off — a non-TypeScript host, or one that set it to `false` — or with
  `LISA_GATE_CACHE=off` or under CI, it runs nothing and exits 0 with
  `gate pass cache is off for this project; push directly (the push runs every
  gate)`, because checking first would only run every gate twice. That is what
  lets the pushing skills (`lisa-git-submit-pr`, `lisa-drive-pr-to-merge`,
  `lisa-implement`) tell every agent to run `lisa check` before `git push`
  unconditionally. Humans may keep pushing normally.

In a Rails project (`bin/rails`, else `config/application.rb`, as the Rails
detector decides) the push gates are lefthook's pre-push commands, not the
gate registry, so `lisa check` runs `scripts/lisa-rails-gates.mjs --all`
instead (CodySwannGT/lisa#4613). Each lefthook command calls that script with
its own gate name, so check and push run the same commands under the same
cache keys, which add `Gemfile.lock`, `ruby -v` and `bundle -v`. `pushGate.cache`
and `pushGate.admission` default to on there; an explicit `false` wins. RSpec
(and an enabled mutation gate) goes through `lisa admit`; a full run uses
`parallel_rspec -n <granted>` only when the host's create-only
`config/database.yml` names its test database with `TEST_ENV_NUMBER`. Work-item
traceability and the history scan stay in `lisa-rails-prepush.mjs`, which
reads Git's stdin, and are never cached. Because only that command reads the
pushed refs, a Rails gate proves `HEAD`'s clean tree, the same tree the
uncached gates always tested.

## Affected-test selection at push

`pushGate.affectedTests: true` (CodySwannGT/lisa#4600) routes the unit push
task through `scripts/lisa-affected-tests.mjs`, which narrows `vitest run` to
`vitest related --run <changed files> <map-selected tests>` using the CI access
map (#4593). The decisions live in `scripts/lib/affected-tests.mjs`:

- Any reason the selection could be wrong runs the full command unchanged and
  prints the reason. These are a missing, stale or unreadable map, a changed
  file that is new since the map, a `FULL_SUITE_TRIGGERS` entry, or a CI run.
  It never runs nothing because the map is in doubt.
- The command reports what it selected through `LISA_SELECTION_REPORT`, a
  per-command file the gate runner points it at. A partial pass is never
  written to the pass cache. An escalated run (below) reports itself as a
  full run, because a full run produced its verdict.
- `pushGate.affectedCoverage` decides what a partial run means for
  `coverage-adequacy`. With `full` (the default), the full suite runs wherever
  `coverage-adequacy` is declared at push. With `changed-files`, the chosen
  tests run with coverage on and each changed source file is held to the floor
  on its own. When every one meets it, the partial run passes. When one does
  not, or the run left no coverage to read, the selector does not fail the
  push on that alone: it prints one line per short file and runs the full
  command with whole-repo coverage, as `full` does, and that exit code is the
  verdict. With `skip`, the runner reports `coverage-adequacy` SKIPPED with
  `partial selection — enforced by CI`, and `test-correctness` keeps the run's
  own verdict, so a failing chosen test still blocks the push.

### TypeScript hosts (CodySwannGT/lisa#4611)

- **Defaults by stack, at run time.** `scripts/lib/push-gate-defaults.mjs`
  fills in `cache`, `admission`, `affectedTests: true` and
  `affectedCoverage: "changed-files"` under the project's own `pushGate`
  keys when the project is TypeScript. TypeScript is detected the way
  `src/detection/detectors/typescript.ts` does it. The gate runner, the
  selector, the access-map recorder, `lisa-test-run` (admission) and
  `lisa check` (cache) all read it, so no two of them disagree. An explicit
  value wins, `false` included. A malformed `pushGate` is passed through
  unchanged so the readers still refuse it. `buildOnce` is not defaulted on:
  a host's push gates do not build, so a build-once step would add a full
  build to every push, a cached re-push included.
- **Why `changed-files` for hosts.** With `full`, a seeded host (which
  declares `coverage-adequacy` at push on `test:cov:unit`) would never narrow
  at all. With `skip`, coverage would leave the push. `changed-files` keeps
  coverage enforced at push for every file the change touched.
- **Never stricter than before (owner rule, CodySwannGT/lisa#4600).** Before
  selection, a push failed coverage only when whole-repo coverage failed. A
  per-file floor is stricter than that: a file can sit below the floor while
  the repo as a whole clears it. So the per-file check only decides when to
  take the fast path. A shortfall escalates to the full suite with whole-repo
  coverage, which passes or fails the push exactly as `full` would. The same
  rule holds on Rails: `lisa-rspec-select.mjs` escalates on a short changed
  file, a missing resultset, or a hand-off that could not keep SimpleCov's
  minimums off the slice (`lisa_rspec_partial_coverage.rb` writes `escalate`
  to its `status.json`). The Rails gate runner passes its own full run,
  parallel when granted, as the escalation. It falls back
  to the full measured suite when there is no `vitest.thresholds.json` or no
  test reaches a changed source file. CI still enforces whole-repo coverage.
- **Scripts.** Each Vitest stack's forced `test:cov:unit:lisa` and
  `test:unit:lisa` run through `lisa-affected-tests.mjs --push-only`. That
  narrows only when the gate runner set `LISA_SELECTION_REPORT`, so CI and a
  developer's own run are unchanged. A command that is not a `vitest run`
  (the Jest stack) always runs unchanged, with the reason printed.
- **Map.** The stack presets carry the recorder plugin, which records only
  when `LISA_ACCESS_MAP=1` and the effective `affectedTests` is on. The
  shared `quality.yml` now sets that variable and uploads the map for every
  pull request, not only Lisa's. The recorder also writes the resolved
  `forceRerunTriggers`, `setupFiles` and `globalSetup` into the map, and the
  selector treats them as full-suite triggers. The fetch script reads the
  repository from `GITHUB_REPOSITORY` or the `origin` remote.

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

The same key had the same defect one moment earlier. `.husky/pre-push` ran
`lisa-work-item.mjs validate-push` on its eleventh line, unconditionally, while
every other check in that file resolved through
`lisa-run-gates.mjs --moment=push` — the last gate in either hook still
bypassing the façade. The declaration could not reach it, because the gate was
registered `pull-request` only. `traceability` is now legal at `push` as well,
and the hook resolves it: declared at push, at any level, the registry owns the
property; declared at some other moment, unreadable, or not declared at all, the
built-in validator runs exactly as it always has.

The built-in PR paths in `quality.yml` and `quality-rails.yml` also accept an
explicit `workItem.dependabotTracking: "pull-request"` opt-in. Omission or
`"issue"` preserves issue tracking. The option is read from the event's base
commit through GitHub, before checkout or execution of PR-head code. A config
change on the PR head cannot enable it. This does not distribute or configure
Dependabot itself; dependency-update policy remains host-owned.

For this option, GitHub must authenticate the exact open same-repository PR as
created by `dependabot[bot]` (github.com ID 49699333, type `Bot`). The workflow
compares repository identity, PR number and both full event SHAs, then reads the
PR again before reporting its URL, number and immutable head as the work record.
That record covers the whole update, including maintainer lockfile amendments.
Branches, titles, commit emails and the triggering actor cannot grant it.

Missing, malformed, inaccessible or stale proof grants no authenticated PR
record. A static warning accompanies refused proof, and original issue/custom
validation still runs. A missing base config keeps the original path. The option
affects only the built-in fallback: configured custom traceability tasks, local
commit/push hooks, ordinary human PRs and all quality/security/review/merge checks
retain their existing behavior. The reusable-workflow and installed work-item
contract versions remain compatible; no new validator command is required.

**What the traceability gate asks for is a second, independent declaration.**
The gate LEVEL says whether a failing check blocks a merge; `workItem.verify`
says what the check proves. Two levels exist:

| level | what it proves | needs a tracker credential |
| --- | --- | --- |
| `trailer` (default) | a `Work-Item:` reference exists, is well formed, names the configured repository or project, matches this worktree's binding, and is the same reference on the commits and the pull-request body | no — no tracker call is made at all |
| `full` | all of the above, plus: the tracker item carries a `repo:` label naming this repository, sits in a claimed lifecycle state, and carries a verified backlink to this pull request | yes, including WRITE access to post the backlink |

`full` was the only contract on offer until #2721, which made a project
unwilling to put a tracker API key in CI unable to satisfy the gate in any
form. That conflated two separable things: proving a change names its work item,
which needs nothing, and proving the tracker agrees, which needs an integration.
The traceability requirement is the first one.

The level is DECLARED, never inferred from whichever credentials happen to be
present. Inference would make the gate's strength a property of the environment
— delete a secret and the check quietly asks for less, with the decision
recorded nowhere. `node scripts/lisa-work-item.mjs verify-level` prints what
actually resolved, and CI reads it from there rather than re-deriving the
precedence rules in shell.

A declared `full` whose credential did not arrive degrades to `trailer` with a
loud warning, and keeps failing on a missing reference. It used to `exit 0`: a
required check reporting success having verified nothing at all, an entirely
absent trailer included.

**One parser reads the commit message and the pull-request body.** A
`Work-Item:` line counts wherever it sits, and repeating the SAME reference is
fine; naming two DIFFERENT ones FAILS, and the refusal names both. Position carries no
information in a text that agents assemble and bots edit after review, and the
two texts had opposite duplication rules until #2721 — the same two lines passed
in a commit and failed in a body, with neither answer explaining the other.

GitHub references may use `owner/repo#123` or the exact lowercase provider prefix
`github/owner/repo#123`. Both resolve to the configured repository's canonical
identity before binding, commit, push, pull-request, and shipped-declaration
checks. The qualified form requires literal ASCII owner/repository segments and
a positive, unpadded issue number. Foreign repositories, other provider prefixes,
dot segments, encoding, extra path segments, and suffixes remain refused.
Supported `https://github.com/owner/repo/issues/123` inputs retain their separate
strict URL rules. Mixing a URL with a canonical or qualified declaration in one
message remains ambiguous, and shipped-declaration audits still count only
hash-number forms.

**The push prover is a different command from the pull-request prover**, and the
registry says so rather than leaving each project to discover it.
`check:work-item` is `validate-pr`, which needs a pull request to read; at push
there usually is none yet, and the check that exists there parses the refs Git
feeds the hook on stdin. So the registry entry carries
`taskAt: { push: "check:work-item:push" }` alongside its default `task`.
`taskAt` is consulted below a project's own `run` declaration and above `task`:
a gate whose default prover differs by moment has no single default, and
resolving the wrong one would fail every first push of a branch while looking
like a traceability failure.

**Both provers ship as package scripts, and `lisa doctor` may not recommend a
gate whose prover it cannot see.** Until #2810 neither half was true.
`check:work-item` was defined in Lisa's own `package.json` and in no
`package.lisa.json`, while `lisa doctor` declared `gates.traceability:
{"pull-request": "required"}` in any project that had not made a decision about
it. Measured on a repository upgrading to 3.46.3: taking doctor's advice turned
a passing pipeline red with `Missing script`. The failure is asymmetric, which
is why it survived — a project that already defines the script sees nothing
wrong and never reports it; only a project lacking it discovers the defect, and
discovers it as a red build mid-upgrade.

Two changes, and the second is the durable one:

1. `typescript/package-lisa/package.lisa.json` forces both `check:work-item`
   and `check:work-item:push`. `typescript` is the parent of every npm stack in
   `PROJECT_TYPE_HIERARCHY` and `force` sections are deep-merged
   parent-before-child, so one declaration reaches all six. Rails has no parent
   and no `package-lisa` template; it is covered by the guard, not the line.
2. `declareGate` in `cli/doctor-gate-recommendation` performs the verification
   AND the write, so no doctor check can recommend a gate whose task it cannot
   resolve — not "the traceability gate", any gate. A gate declared `off` is
   exempt: off runs nothing, so there is no command to be missing, which is what
   keeps the `skip_jobs` migration's `off` fragments legal.

A gate whose prover is absent is worse than a gate nobody declared, because the
operator who gets it is the one who ran doctor to avoid exactly that.

**Why the hook decides twice.** The push-moment declaration is resolved at the
top of the hook, directly, rather than from the `--coverage` file every other
built-in step reads — the validator has to run before the repository-local
`GIT_*` set is unset and before anything else consumes the hook's stdin, and no
coverage file exists that early. That makes deferring only half a decision, so
the second half sits in the built-in block: if the gate was declared and the
coverage file does not name it — no runner on disk, a runner that could not run,
a coverage file that could not be written — the built-in validator runs after
all. Otherwise `required` would be a quieter way of switching the check off than
`off` is.

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

### The rename is a three-step sequence, in this order

Ordering is the whole safety property, and getting it wrong red-walls every open
pull request at once. Only this order is safe at every intermediate point:

1. **Remove the OLD context** from every ruleset that names it.
2. **Merge the change** that makes the job post the NEW name.
3. **Add the NEW context** as required.

Doing (3) before (2) creates a permanently-pending required check on every open
pull request. Doing (2) before (1) creates the failure #3067 records. Neither is
recoverable by waiting, and neither shows up as a failing check.

`previousLabels` is not a shim that makes a job post two names — it is a
generator input describing what a ruleset should require. On a genuinely
required context it therefore *creates* the permanent-pending state rather than
preventing it, which is why the sequence above exists and the field does not
replace it. What the field is good for is **detection**: it is Lisa's own record
that Lisa renamed the job, and therefore the only evidence that makes "nothing
will ever post this" provable rather than guessed.

### What now catches a retired name

Three surfaces, and each one is deliberately narrow about what it will call a
defect. A context merely absent from the derived set proves nothing — a
repository may legitimately require a status posted by a third-party app or by a
job its own CI defines — so only a `previousLabels` match is reported:

- `lisa-gates.mjs retired-contexts` prints the machine-readable retirement list.
- `lisa health` (`github.declared-checks`) sweeps **every live ruleset the
  repository has, including ones Lisa does not manage**, and fails naming any
  retired context it finds. It reports; it never edits a ruleset Lisa does not
  own. Zero rulesets read is `Unproven`, never a pass — an empty sweep and a
  clean repository are otherwise identical.
- `lisa-github-rulesets.sh` runs the same comparison against the live rulesets
  at the end of an apply, dry run included, and prints the sequence above.
  Report-only for the same reason. It matches the retired **label** as the final
  segment of a required context, never the whole string: a check run's reported
  name is the `/`-joined chain of the job names reaching it, so the same gate
  posts one depth on the pull-request path and another on the release path, and
  comparing whole strings would walk straight past the nested spelling. The
  chain the ruleset actually pins is carried into the replacement it prints.

`lisa doctor` reports a retired name too, but only on the **ruleset template**
surface: doctor makes no network call by contract, so the live sweep — where a
hand-made ruleset lives — belongs to `lisa health`.

### Why the ruleset script alone could not catch it

Its scope is "make my templates match". The affected ruleset in #3067 was
hand-made, named `enforce pr rules`, not one of the four Lisa ships. `--dry-run`
correctly reported adding `🔍 Quality Checks / 🔎 Structural Rules` to the
ruleset it manages, and never mentioned `🔍 Quality Checks / 🔎 AST Grep Scan`
surviving in the ruleset it does not. Running it to completion left the
repository blocked. Any per-managed-ruleset comparison has that blind spot by
construction; the sweep is what does not.

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
register records "test:cov passed" and cites nothing. Standardising what comes
**back** is what would let jest and vitest both satisfy `coverage-adequacy`, and
let an attestation quote a number instead of a verdict.

**What actually ships is smaller, on purpose.** The runner records each gate as:

```json
{ "gate": "coverage-adequacy", "status": "pass | fail | unknown", "level": "required", "label": "✅ Verification Coverage" }
```

inside a run record carrying the `subject` (tree and commit), the `contract`
(`moment` and `gates_digest`), the run `verdict`, and `observed_at`.

- **`status`** is three-valued. `unknown` is not a synonym for `fail`: only a
  gate that ran and passed is `pass`, and anything not measured is `unknown`.

An earlier version also carried `work`, `measures`, `prover` and freshness
fields for a release-reuse checker. No tool parser ever filled them, so they
were always null or restated the exit code, and nothing read them. They were
removed with that checker (CodySwannGT/lisa#4794). Recording a work count, real
measures or a prover version is still the right direction for attestation.
Add each one when a parser exists to fill it and a reader exists to use it,
not before.

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

## One property, several parts

A repository with more than one part — an API in one folder, a web client in
another — proves the same property with a different command in each. A gate
says so with `parts`, and says what it is for with three more keys:

```json
"code-style": {
  "commit": "required",
  "criteria": ["SI7"],
  "owner": "Platform team",
  "tier": "authoritative",
  "parts": [
    { "scope": "api", "command": ["go", "vet", "./..."] },
    {
      "scope": "web",
      "command": ["npm", "run", "lint"],
      "parameters": { "max-warnings": { "value": 0, "direction": "ceiling" } },
      "proof": {
        "violation": ".lisa/controls/proofs/lint-web.violation.patch",
        "clean": ".lisa/controls/proofs/lint-web.clean.patch",
        "failure_shape": ["problems found"],
        "timeout_seconds": 120,
        "external_effects": []
      }
    }
  ]
}
```

| key | on | meaning |
| --- | --- | --- |
| `criteria` | gate | The requirement ids the gate serves, written as the specification writes them. |
| `owner` | gate | The person or team that answers for the gate. |
| `tier` | gate | `authoritative` (the author of a change cannot get around it) or `advisory`. |
| `parts` | gate | One entry per folder the gate covers. |
| `scope` | part | The folder, written from the repository root; `.` is the whole repository. |
| `command` | part | What checks it, as a list with one item per argument. |
| `parameters` | part | Named settings, each `{ value, direction }`; `direction` is `floor` or `ceiling` and marks a number as a threshold. |
| `proof` | part | Two patch files under `.lisa/controls/proofs/` — one that breaks the rule, one that does not — plus how a failure prints, a time limit, and anything the proof does outside the repository. |
| `evidence` | part | What supports declaring the part: the places the audit found the check, or the audit questions a person answered. See "A part says what supports it". |

**`command` is a list and never a string.** It is started directly, with no
shell in between, so `;` and `&&` are characters in an argument rather than
instructions. A string would have to be split by something, and whatever splits
it is a shell or an imitation of one — so validation refuses a string instead
of splitting it.

**A gate with parts resolves to one entry per part.** Each carries every field
an entry always had, then `scope` and `argv`. `task` and `command` are `null`
on purpose: `command` is the text a shell is handed, and a part's argument list
must never become one. A gate with no parts resolves exactly as it did before
the key existed, field for field, and `tests/unit/controls/paved-road-regression.test.ts`
holds that.

**With parts, the parts are the only prover.** A `run` or an `await` beside
them is refused, for the reason a moment may not declare both: one declaration
with two things claiming to prove it has to be resolved by picking, silently.
A second prover written for one moment is refused by `validate` and at that
moment. The runner at any other moment says a problem waits elsewhere and
runs, because there the gate has exactly one thing to run. A task named for
the whole gate and a malformed part are refused at every moment.

**Two parts of one gate may not cover the same folder**, and a folder has one
spelling — `api`, not `api/` or `./api` — so every reader can compare two
scopes as text.

**A key Lisa does not read on a part is refused**, as it is on a gate. A part
is read by several tools that never see each other, so a misspelt `parameters`
would be a threshold nothing holds while every tool reported the declaration
valid. A key that starts with `x-` is the project's own and passes through
unread.

### How the runner runs a part

`lisa-run-gates.mjs` runs each part on its own and reports each on its own
line, named by gate and folder:

```
  PASSED     required code-style in api           ["go","vet","./..."]
  FAILED     required code-style in web           ["npm","run","lint"] (exit 1) — …
```

**The list is started as written, in the part's folder.** The program is the
first item and every other item is one argument. No shell is involved at any
point, so the report prints the list as JSON to show where each argument
starts and ends. The command gets the runner's own environment, as every gate
command does.

**The folder is resolved on disk before anything starts.** A scope names a
folder inside the repository, and a name is only inside the repository if
what it _is_ on disk is: a committed link called `api` that leads somewhere
else would start the command there. So the runner resolves the folder through
every link and starts the command only when the result is a folder inside the
repository.

**A part that cannot start is not proved, and says why.** A folder that does
not exist, a folder that leads outside the repository, and a program that is
not installed each print `UNPROVABLE` against the part, with the folder or
the program named. That blocks a required gate exactly as a failure does, and
it is never a pass. The command of a part that cannot start is not run
anywhere else instead.

**A part is judged the way every gate is.** Exit 0 from a command that says it
ran no tests is not proved; a command that was killed is `KILLED`, not
failed; and a failure the classifier does not recognise is read against the
part's `proof.failure_shape` before it is called unknown.

**A gate is proved by all of its parts.** The commit and push hooks stand a
built-in check down only against a gate the runner proved, and one part going
unproved leaves the whole gate unproved. Passing parts are needed and are not
enough: the parts must also reach every path the change touches, which "A
part the change does not touch" sets out. The evidence envelope records one
row per part, with the folder in `scope`.

Three things are not built for parts yet. A part's command has thirty minutes
rather than two hours, which is the longest the process supervisor accepts for
a command started this way. On Windows a part's output is not captured, so a
failure there is reported from its exit code alone. And a part is never read
from the push gate's pass cache or admitted through `pushGate.admission`: it
runs every time and starts immediately.

### A part the change does not touch

In a repository with two parts, a change to one should not run the other's
check, and must not be reported as having passed it. So at commit and at push
the runner works out which paths the change touches, and leaves out a part
whose folder holds none of them:

```
  🔎 This commit changes 1 path(s). A part runs only when one of them is inside its folder; a part for the whole repository always runs.
  PASSED     required code-style in api           ["go","vet","./..."]
  NOT APPLICABLE required code-style in web       the change touches nothing inside "web", so ["npm","run","lint"] was not run. Not counted as proved
✅ commit: 1 proved, 0 failed (optional), 0 not proved, 0 killed, 1 not applicable here, of 2 gate(s) declared. Each part of a gate is counted on its own. 1 part(s) this change does not touch were not run, and are counted as not applicable, never as proved.
```

**A part left out by mistake is a folder nothing checked.** That is the
mistake that matters, so the rule has one direction: a part is left out only
when the runner is sure the change does not touch it. Everything it is not
sure about runs the part.

| Moment            | What "the change" is                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `commit`          | The staged paths, read from the index git names for this commit. A rename counts at its old and its new path, and a deletion counts. |
| `push`            | For each ref being pushed, what differs between the commit the remote holds and the commit being sent.   |
| every other moment | Not worked out. Every part runs.                                                                        |

The change is **not known**, and every part runs, when:

- there is no git, or the runner was not started at the top of a repository;
- git is set up to answer for some other repository (an inherited `GIT_DIR`
  or `GIT_INDEX_FILE`), or fails, or is killed;
- nothing is staged — which is also what a runner started by hand sees, and
  a run to check the repository must not report every folder as untouched;
- the caller did not say what is being pushed, or the list is empty or is not
  written the way git writes it;
- a ref is new on the remote (a first push of a branch, a new tag), because
  there is nothing to compare it with;
- git does not hold the commit the remote has;
- more than 100 refs are pushed at once;
- the push changes no file at all;
- the change edits `.lisa.config.json`, the file that says what each part
  runs.

An amended commit is read like any other: the paths staged on top of the
commit being amended. Amending only the message stages nothing, so every part
runs.

A push of several refs adds their paths together, and one ref that cannot be
compared makes the whole push "not known". A ref being deleted sends no
commit and adds no path. A forced push is read like any other: the two ends
are compared as they are.

**The pushed range comes from the push hook, and only from there.** Git
writes `<local ref> <local object> <remote ref> <remote object>` for every
ref on the hook's standard input, and nothing else knows both ends. The
caller hands that text to the runner with `--push-refs=<file>`, or
`--push-refs=-` to have the runner read its own standard input. When the flag
is absent the runner reads the file named by `LISA_PUSHED_REFS_FILE`, which
the push hook of a stack template has exported since it began keeping a copy
of that text. The runner never guesses a range from the branch that happens to
be checked out.

With `-`, standard input is read to its end before any gate starts: every
gate command inherits it and git writes it once, so whichever read it first
would leave the other nothing. A gate's command then finds it empty, and a
caller whose gates read the pushed refs themselves hands over a file instead.

**The caller must hand over everything git wrote, or nothing.** The runner
cannot tell a list that is short because few refs are pushed from one that is
short because something read part of it first. A hook that runs after other
hook content — which may have read one line of standard input and left the
rest — must not pass `-`: the runner would narrow to the refs it was left
with, and could leave out a part that only a consumed ref touches. Such a
caller either keeps its own complete copy and passes the file, or passes
nothing, so that every part runs.

**How a path is matched to a folder.** Paths are compared from the repository
root, one whole segment at a time: `api` holds `api/main.py` and not
`api-v2/main.py`. Git is asked for names in a form it never quotes, so a
folder with a space or a non-ASCII letter in its name matches like any other.
Letter case and the two ways of composing an accented letter are ignored,
because a filesystem may ignore them too; that can only run a part that was
not touched. A folder that is a link is matched under its declared name and
under the folder it leads to. A changed path that the folder lies below
counts as well: a nested repository (a submodule) or a link above the folder
is one path to git, which says nothing about what moved underneath it, so a
part for `vendor/engine/src` runs when `vendor/engine` changed.

**`.` always applies**, and a part for it is never left out.

**A shared file at the root does not trigger a folder's part.** A change to a
lint configuration in the repository root touches no path inside `api`, so the
`api` part is left out even though that file changes what its command does.
The runner cannot know which root files a command reads. A project that needs
the check to run for such a change declares a part with scope `.`, which
always runs. `--parts=all` runs every part whatever the change touches, for a
run by hand.

**What a part left out is, to everything that reads a run.** Its state is
`SKIPPED` with `untouched: true`. It is never started, never read from or
written to the pass cache, and never shared with another gate that names the
same command. The evidence envelope records it with `status: "unknown"` and
`applicable: false`. The tally counts it under "not applicable here".

**A gate is reported as covered only when its parts reached the whole
change.** The commit and push hooks of a stack template stand a built-in
check down against each gate the runner names in the `--coverage` file, and
they stand it down for the whole commit or push. So a gate with parts is
named only when every path the change touches is inside the folder of a part
that ran. Otherwise the gate is withheld, the runner says why, and the
built-in check runs. With parts for `api` and `web`:

| the change | the gate in `--coverage` | what the runner prints |
| --- | --- | --- |
| `api/a.go` | named | nothing more |
| `api/a.go` and `tools/b.js` | withheld | `code-style has no part for 1 path(s) this change touches ("tools/b.js"), so the built-in check for it still runs.` |
| `tools/b.js` | withheld | `No part of code-style applies to this change, so the built-in check for it still runs.` |
| not known | withheld | `What this change touches is not known and code-style has no part for the whole repository, so the built-in check for it still runs.` |

The last row is the same rule, not a second one. When the change is not known
every part runs, and nothing says the folders they cover are all of it: a
commit that edits `.lisa.config.json` is "not known", and that file is by
definition outside `api` and `web`. A gate with a part for scope `.` is named
whatever the change touches, because that part reaches every path. A project
whose parts are meant to replace the built-in check for every change declares
one.

"Inside" is read strictly here, where "touches" above is read generously. A
nested repository that moved is one changed path; a part for a folder inside
it runs, and does not make that path covered. Letter case and the composition
of an accented letter are compared exactly here, where "touches" ignores
them: a change to `API/x.js` runs the part for `api`, and is still a path no
part covers, because on a filesystem that tells the two apart `API` is
another folder. Where the filesystem treats them as one and git recorded the
other spelling, that only keeps a built-in check that could have stood down.

A hook that does not pass `--coverage` cannot keep one built-in check on its
own. When a gate would be withheld for one of these reasons and nothing
failed, it is answered 78 and runs every built-in check it has. The parts
that ran stay on record: the evidence envelope carries their rows under the
verdict `fell-back`. A caller that passed `--builtins=none` has no built-in
check to keep, and the table under "A caller with no built-in checks" says
what its exit 0 means.

## A part says what supports it

A register entry is a statement that a rule governs a folder, and it may be
written only where something supports it. A part records that in `evidence`:

```json
{
  "scope": "api",
  "command": ["ruff", "check", "."],
  "evidence": {
    "locators": [{ "path": "api/ruff.toml", "line": 1 }],
    "questions": ["SI2@api"]
  }
}
```

`locators` are the places the audit found the check, each the audit report's
own `{ path, line }`. `questions` are the ids of the audit questions a person
answered, each the id the report records the answer under: `<requirement>@<scope>`.
Either may be left off; one of them must be there.

The other examples in this note show a part without `evidence`. Each is a
valid declaration, and the runner runs it. The register refuses it until the
part names what supports it.

Three pieces of code each hold a different part of that, because each can see
a different thing:

| where | what it refuses | why there |
| --- | --- | --- |
| `validate` (the shipped registry) | `evidence` that is written wrongly: not an object, an unknown key, an empty list, a path outside the repository, a line below 1, the same place twice, or neither list. | It ships to every repository and reads no report. `evidence` is optional here, because nothing that runs a part reads it. |
| `lisa controls register` | A part with no `evidence` at all. | The register is where "this rule governs this folder" becomes a record. It never reads the audit report, so it stays the same bytes on every machine. |
| `lisa controls declaration-check` | A place the audit did not report for a requirement the gate serves, in that folder or in the report's whole-repository section; a question the report holds no answer to, or whose answer is about another requirement or another folder; and a part for a requirement the audit still asks about. | It is the one place the declaration and the audit report are both in reach. |

**A gate with no parts is outside all three.** Its one entry comes from the
declarations Lisa ships for a supported project type, it has no part to carry
evidence, and it generates exactly as before. `lisa controls seed` is what
declares those: it says whether the whole repository is one piece of software
on a supported type and, when it is, runs the same `seedGates` that
`lisa apply` runs. Everywhere else the configure step declares parts from the
audit's findings, one decision at a time.

**A threshold on an unsupported stack is the host's.** `lisa controls
propose-threshold` turns a value measured with the host's own tool into the
parameter to propose, `{ value: <measured>, direction }`, and nothing else
goes into it: there is no default in that code to fall back on.

## A declared threshold moves one way

A parameter with a `direction` is a threshold, and `threshold-monotonicity`
holds it: a `floor` may rise and never fall, a `ceiling` may fall and never
rise. The prover is the one that already held Lisa's own threshold files
(`plugins/src/base/hooks/threshold-ratchet*.mjs`, shipped to every repository
as `scripts/check-threshold-ratchet.mjs` and its two siblings). It compares
`.lisa.config.json` between the base and the change, so it needs no threshold
file, no `package.json` and nothing installed — only `node` and git.

It walks the thresholds the base declares and asks of each whether it is still
held at least as tightly. Everything else follows from that one question:

| the change | verdict |
| --- | --- |
| a floor goes down, or a ceiling goes up | refused |
| a floor goes up, a ceiling goes down, or the value stays | allowed |
| the parameter, its part, its gate or the file is removed | refused: removing a floor lowers it all the way |
| the part's folder or the gate is renamed | refused, even when the threshold moved with it |
| `direction` is dropped, or a floor becomes a ceiling or the reverse | refused |
| the value stops being a number | refused |
| the file stops being valid JSON while it held a threshold | refused |
| a parameter with no `direction` changes or goes | not compared |
| a new parameter, part or gate | allowed |
| the base declares no thresholds, has no such file, or has one that is not valid JSON | allowed: nothing readable was held |

**What is held is the declared number, and only that.** The check compares
`value` as it is written in `.lisa.config.json`. It never runs the host's tool
and never reads where that tool takes its limit from — a `fail_under` in
`.coveragerc`, a number in a script, an argument in the part's own `command`
— so a limit lowered there while the declared number stays the same is not
refused. The parameter records the number; the part's command is what applies
it, and keeping the two equal is the host's to do. `lisa controls
propose-threshold` says this to the operator in `yes_means`, and the
configure step tells them to put the same number in the command where the
tool takes it as an argument.
`tests/integration/threshold-ratchet-declared-parameters.test.ts` holds both
halves: a lowered declared floor is refused, and a limit lowered in the tool's
own settings is not seen.

**A rename is refused on purpose.** A threshold is named by its gate, its
folder and its parameter. Nothing in two versions of a file can tell a renamed
folder from a part that was removed beside an unrelated one that was added, or
show that a floor under a new name covers the code the old one covered. So a
rename leaves the way any deliberate loosening does.

**There is one way out, and it is not new.** A person records a
`thresholdRatchet.allow` entry in `.lisa.config.json` with a reason and an
`until` day, in a change of its own; the check honours it only once it is on
the base side, and only through that day. For a declared threshold `file` is
`.lisa.config.json` and `key` is
`gates.<gate>.parts[<folder>].parameters.<name>` — every refusal prints the
exact pair. Nothing written beside the parameter is read as permission.

**The prover reads the declaration and does not validate it.** `validate`
decides what a valid `gates` block is. A shape it would refuse yields no
threshold here rather than an error, because a comparison that throws on a
hand-edited file compares nothing.
`tests/unit/controls/declared-thresholds-register.test.ts` holds the prover and
the register to the same list of thresholds for one declaration.

**What still has to call it.** The files reach every repository Lisa is applied
to, and the coding agent's after-edit hook runs them wherever the plugin is
installed. The commit and pull-request callers are the TypeScript and Rails
templates' hooks and the reusable quality workflows. The gate's default task,
`check:thresholds`, is a package script, so a repository with no
`package.json` declares the gate as a part instead:

```json
"threshold-monotonicity": {
  "push": "required",
  "parts": [
    {
      "scope": ".",
      "command": ["node", "scripts/check-threshold-ratchet.mjs", "--base", "origin/main"],
      "proof": { "failure_shape": ["blocked by the threshold ratchet"] }
    }
  ]
}
```

The `failure_shape` is what lets the runner print `FAILED` for a loosened
threshold. Without it the runner still blocks, but calls the result
`UNPROVABLE`, because the registry declares no failure shape for this gate.
`tests/integration/threshold-ratchet-declared-gate.test.ts` runs this
declaration through the shipped runner in a repository with no `package.json`.
What calls the runner there — a push hook in a repository the templates were
never applied to — is separate work.

## The control register

The `gates` block is the only thing a person or an agent writes. The control
register at `.lisa/controls/register.json` is generated from it, so the one
file an operator or an auditor reads cannot disagree with what runs:

```
lisa controls register [path]          # write the register
lisa controls register [path] --check  # write nothing; fail when it differs
```

Both read the declaration through the shipped registry — `readGates`,
`validateGates`, `resolveMoment` — and restate none of it. A declaration
`validate` refuses is refused here with the same lines. So is a
`.lisa.config.json` that is valid JSON and is not an object — a list, `null`,
a number — and one whose `gates` is not an object: `readGates` refuses each in
one sentence rather than read it as a file that declares nothing, so no empty
register is written from a damaged file.

**One entry per gate and folder.** A gate with `parts` gets an entry per part;
a gate with none gets one entry for the whole repository (`scope` is `.`),
taken from what `resolveMoment` returns for it today.

| field | what it states |
| --- | --- |
| `id` | `<gate>@<scope>`, for example `code-style@api` or `code-style@.`. Nothing else goes into it, so it does not change when other gates or folders are added or removed. |
| `gate` | The gate the entry was generated from. |
| `criteria` | The gate's `criteria`, in catalogue order. A gate that declares none gets the requirements the criterion catalogue maps to it. |
| `scope` | The part's folder, or `.`. |
| `tier` | The gate's `tier`. A gate that declares none is `authoritative` when it is `required` on the hosting platform, in a deployment or in a scheduled run, and `advisory` otherwise. A declared `authoritative` has to meet the same test (see below). |
| `enforcement_points` | One `{ moment, level, location }` per moment the gate is declared at and not `off`, in the order the moments happen. `location` is `coding-agent`, `local-checkout`, `hosting-platform`, `deployment-pipeline` or `scheduled-run`. |
| `measuring_mechanism` | `{ kind, … }`: a part's `command` (`argv`), a `task` (`task`, `command`), an awaited `external-check` (`name`, `posted_by`), a shipped `interceptor`, the workflow's `built-in` job, or `none`. An enforcement point measured differently carries its own. |
| `parameters` | The part's `parameters`, or `{}`. |
| `proof` | The part's `proof` with every key present; `null` where the declaration does not say. |
| `evidence` | The part's `evidence` as `{ locators, questions }`, both lists present. On every entry generated from a part; absent on the entry of a gate with no parts. |
| `accountable_party` | The gate's `owner`, or `null`. |

**The same declaration gives the same bytes.** Keys are sorted at every depth,
entries are ordered by gate and then by folder, and nothing in the file is a
date or a path of the machine it was written on. `--check` compares byte for
byte and names each entry that differs.

**Whether a requirement id exists is checked here.** `validate` checks only
how a `criteria` id is written, because the registry ships to repositories
that do not carry the criterion catalogue. Generating the register refuses an
id the catalogue does not list as in scope.

**A declared `authoritative` has to be true.** A gate may declare `advisory`
whatever its moments: that only understates it. A gate that declares
`authoritative` is refused unless its entry is `required` somewhere the author
of a change does not control: on the hosting platform, in a deployment or in a
scheduled run. A hook in the author's own checkout can be skipped and a coding
agent's session is the author's own, so `required` at `commit` or `push` alone
does not make a rule authoritative, and a register that said so would tell
every reader that a rule cannot be skipped when one flag skips it. The check
is made per entry, so a gate with `parts` is refused for each folder where it
does not hold, and the line says what to change: require the gate at
`pull-request` (or at a deployment or scheduled moment), or declare it
`advisory`, or leave `tier` out. The working-out of an undeclared tier and
this refusal share one test (`src/controls/register-tier-rule.ts`).

The format is published as `schemas/control-register.schema.json` in the Lisa
package. Every object in it is closed, so a new fact about an entry is a new
key in the schema and in `src/controls/register-types.ts` together;
`tests/unit/controls/register-schema.test.ts` fails when one has a key or a
value the other does not.

## A pull-request executor Lisa did not write

Lisa ships the file that runs the gates on a pull request for one hosting
platform, GitHub. On any other the host's agent writes it, and the declaration
says where it is, on the gate's `pull-request` entry:

```json
"code-style": {
  "pull-request": {
    "level": "required",
    "executor": { "platform": "gitlab", "path": ".gitlab-ci.yml" }
  }
}
```

| key | meaning |
| --- | --- |
| `platform` | The hosting platform, in lower-case letters and digits with hyphens between words. `github` is the one Lisa ships the file for; anything else is a platform Lisa did not write the executor for. |
| `path` | The file, from the repository root, under the spelling rules of a part's `scope`. `.` is refused: it names the repository, not a file. |

**It sits on the moment entry, and only at `pull-request`.** `validate`
refuses it at any other moment, and refuses any key in it but those two unless
the key starts with `x-`. A moment-level key is one an older Lisa ignores; a
gate-level key would make an older Lisa refuse the whole block. It changes
nothing about what the moment resolves to.

**Every gate checked at the pull-request moment names the same executor, or
none does.** One command, `lisa-run-gates.mjs --moment=pull-request`, runs all
of them, so they all run from one file. Generating the register refuses a
declaration that names the file on some of those gates and not on others, or
that names two. A gate that only awaits a check another system reports may
leave it out.

**The register records it and marks the entry unproved.** The entry's
`pull-request` enforcement point carries `executor`. When the platform is not
GitHub the entry also carries `"status": "unproved"`, until
`.lisa/controls/evidence.json` holds a record of both halves of that entry's
proof, each saying the half held: a record with the entry's id as `entry_id`,
`half` set to `violation` and `result` set to `held`, and one with `half` set
to `clean` and `result` set to `held`. A half that was run and did not hold
does not count. A record that names a `moment` counts only when it is
`pull-request`. An entry with no `status` is
not thereby proved; the verdict says what was proved.

**So the register is generated from two committed files, and `--check` stays
honest.** For a declaration that names such an executor, the same declaration
and the same evidence give the same bytes, and `--check` regenerates from both.
The committed register is out of date exactly when one of them changed since it
was written, and the difference is reported against the entry, with a sentence
saying the status comes from the evidence file. The clock is never read: how old
a record is decides whether a verdict may rely on it, and a register that
changed because time passed would fail its own check with nothing changed. For
every other declaration the evidence file is not read at all, and the register
is what it always was.

The contract the file must meet is in the enforce skill, at
`plugins/src/base/skills/lisa-enforce/references/pull-request-executor.md`.

## Required checks from the register

A check is only a gate when the hosting platform refuses the merge without it.
`lisa controls protect` holds the platform to the register:

```
lisa controls protect [path]           # read, compare, hand over; changes nothing
lisa controls protect [path] --apply   # also change the setting, when allowed
```

**The safe result is the default.** Whether a tool may change what a
repository requires before a merge is the owner's decision, and many
organisations say no. So without `--apply` the command can only read: it
compares the live rulesets with the register and writes
`.lisa/controls/merge-protection-change.md` for an administrator. With
`--apply` it sends a change only after a read of the repository says the
signed-in account administers it — the flag alone is not enough, and neither is
the permission. Permission is learned from that read, never from a write that
failed. On any platform but github.com nothing is sent in either mode.

**Only an authoritative, required pull-request entry derives a check.** The
names come from `contextsFor`, called on the gates of those entries and no
others, so an `advisory` gate is not made blocking here even where it is
`required` on a pull request.

**A gate with `parts` derives one check, not one per part.** `contextsFor`
gives a gate one name however many parts it has, and that is right for a
required check: the platform keeps one requirement per name and cannot hold
the same name twice. It is sound only while one status is reported under that
name and that status fails when any part fails. A carrier that reported one
status per part under the shared name would let a passing part answer for a
failing one, so the carrier owns that, not the ruleset.

**Nothing about a ruleset is built twice.** Reading, comparing, planning and
writing are `lisa-reconcile-policy.mjs` (`readLivePolicy`, `reconcileContexts`,
`planRepairs`, `applyRepairs`); a ruleset that has to be created takes its
branches, enforcement and bypass list from `lisa-ruleset-payload.mjs` and holds
the status-check rule only; which rulesets are enforced on the branch is
`lisa-ruleset-reach.mjs`. Repository settings and the shape of other rules are
never touched: the plan is given no settings drift to repair.

**What is reported is what was read back.** After a change the rulesets are
read again through `lisa health`'s ruleset reader and compared again. A
platform that accepted the change and did not keep it is `blocked`, with the
difference, never `wired`.

**A check that is already required is never changed.** A required check is a
name and, where the settings say so, the one app allowed to report it, and the
platform's own settings page pins a check to an app by default. An awaited
check that declares no app (`await` with no `posted_by`) has no opinion about
the app, so it is required as soon as an enforced ruleset requires its name,
whatever app that ruleset pins it to, and it is in no change. The reconciler's
own comparison is stricter there — it wants such a check unpinned in the
ruleset it would write to — which is right for a tool that rewrites a ruleset
to match a declaration and wrong for one that only adds what is missing: the
host's pinned check read as missing, and the repair replaced it with one any
source may report. Beyond that case the rule is general. Before anything is
sent, every planned payload is compared with the ruleset as it was read, and a
plan that would drop a required check, drop its app, or name another app for it
is refused whole, with a sentence naming the check and both apps.

**A check is only made required once it has been reported, where the branch
runs it and by the source that would be required.** A required check that never
reports does not fail a pull request; the platform holds it waiting for ever,
with no failure to read. So before a missing check is sent, the command reads
the check runs and commit statuses on the head of the protected branch and,
while a name is still unseen, on the heads of the five pull requests most
recently **merged** into it, found among the thirty most recently updated
closed ones — a pipeline that runs only on pull requests never reports on the
branch itself. An open pull request, one closed without being merged, and one
from a fork that never landed show what somebody proposed, not what the branch
runs, and are not read. A result counts only from the source the change would
pin the check to: GitHub Actions for a check a pipeline job runs, the declared
app for an awaited check that names one, any check run or commit status for an
awaited check that names none. A commit status does not say which app wrote
it, so it never counts for a pinned check. Among the results that qualify,
whether a name counts is `verifyContextsPosted` in the registry. These are
reads only. A name the platform shows no qualifying result for is `not-ready`,
and when it was seen from another source the sentence says which; one it could
not be asked about, because a read failed or a list came back incomplete, is
`unknown`. Neither is in any write, and each carries a sentence saying what has
to happen first. A plan that would require a check from an app other than the
one it was shown to be reported by is refused.

**A read that does not settle a question is "not known", never a guess.** The
ruleset list is asked for a hundred at a time, the largest page the platform
gives, and a page that comes back full is an incomplete read: nothing is
compared and nothing is changed. A ruleset whose branch conditions the matcher
does not model may or may not cover the branch, so a check that reads as
missing while such a ruleset requires it is `unknown`, is not listed as a
difference, and is not made required a second time. The default branch name
the platform gives is checked the way `--branch` is before it is put in a
request path; one that is not a branch name ends the run with nothing compared.

**Every request names its host.** Where a repository is hosted is decided from
its remote address, and a request is sent only for github.com. `gh` decides
for itself where a call goes — `GH_HOST`, else the host its configuration puts
first — so every call from the one door the requests go through
(`protect-requests.ts`) is `gh api --hostname github.com …`. That covers
`lisa controls protect`, the merge-protection read of the audit, and the
canary requests of the attest step, which all go through that door.

**Two more checks are held back without asking the platform.** One a pipeline
job would report, in a repository with no `.github/workflows` folder: nothing
can report it — the same rule the ruleset applier follows. And one the
repository lists under `github.rulesets.dropRequiredChecks`.

**Rulesets are the only merge protection it reads.** That is what the ruleset
scripts it is built from read. A check required through a classic branch
protection rule is enforced by the platform and is still reported here as not
required, so the handover file asks for a ruleset and says why.

The command prints one JSON document on stdout — per register entry and per
requirement it serves, `wired` or `blocked` and why — and exits 0 when every
derived check is required, 2 when an entry is blocked, 1 when it could produce
no result. The handover file carries no date, so a second run that finds the
same thing writes nothing; it is removed once nothing is left to hand over.

## Carriers for a repository on no project type

A declared check only governs a repository when something runs it. The hooks
that call the gate runner ship with the stack templates, so on any other
repository nothing does. `lisa controls install-carriers` is what makes git
call the runner at commit and at push there:

```
lisa controls install-carriers [path]           # install, or change nothing
lisa controls install-carriers [path] --check   # write nothing; say what a run would write
```

**The runner goes where `lisa apply` puts it.** `scripts/lisa-run-gates.mjs`,
`scripts/lisa-gates.mjs` and the part of `scripts/lib/` the runner loads, found
by following its relative imports from the package the command runs from. That
is the destination `all/copy-overwrite/scripts/` already has, so a repository
that later adopts a project type has one copy, which `lisa apply` then
refreshes like any other file it owns. A private folder would have left a
second copy that nothing updates.

**It never replaces a file it did not write.** Every whole file it places is
listed in `.lisa/controls/carriers.json`. A missing file is created, a file
that is already byte for byte what would be written is left alone, and a file
that differs is replaced only when the record lists it. Anything else belongs
to the repository: the run stops and writes nothing at all, because a hook
that called a runner that is not there would stop every commit. The record
holds nothing that differs between two checkouts of the same commit, so it is
committed.

**A file it may not change is found before anything is written.** Every write
is planned first. A file the person running the command has no permission to
change is found while planning: a hook file like that is one `blocked` point
with a sentence, and the rest of the run goes ahead; a file every carrier
needs (the runner, the record, `.gitignore`) stops the run with nothing
written. A write can still fail for a reason planning cannot see. The run
then gives no result (exit 1), does not undo the writes it made, and its last
line lists them. It says "nothing was written" only when that is so.

**The carrier is one short script per moment**, `.lisa/hooks/pre-commit` and
`.lisa/hooks/pre-push`. It asks for Node first and, without it, stops the
operation with one sentence naming Node; it never passes having checked
nothing. Then it goes to the top folder of the checkout, which is two folders
above the script wherever it was started from, and hands over to the runner
with `--builtins=none`, passing the hook's arguments and standard input on
untouched. A hook that changed folder before it called the carrier therefore
still runs the checks, from the folder the declaration is written for.

**The push carrier tells the runner what is being pushed only where it is
sure to have all of it.** The runner leaves out a part a push does not touch
([A part the change does not touch](#a-part-the-change-does-not-touch)), and
must be handed everything git wrote on the hook's standard input or nothing.
So the push carrier passes `--push-refs=-` unless its caller sets
`LISA_PUSH_STDIN_USED`, and who starts it decides:

| Who starts the push carrier | What it is handed | At push |
| --- | --- | --- |
| git itself, where `core.hooksPath` is `.lisa/hooks` | everything git wrote | a part the push does not touch is left out |
| Lefthook, through `use_stdin: true` | everything git wrote, even when another command read some first (measured on Lefthook 2.2.2) | the same |
| the lines added after a hook's own content (Husky, a hooks folder, git's own) | nothing: the call sets `LISA_PUSH_STDIN_USED` and closes standard input (`</dev/null`) | every part runs |
| the pre-commit framework | an empty standard input (measured on pre-commit 4.7.0) | every part runs |

Lines added at the end of a hook run after its content, which may already
have read a ref, and nothing can put that back. Taking a copy first would
mean writing above that content, in the part of the file that belongs to the
repository, so it is not done. A hook that keeps a whole copy of its own can
still hand it over, by exporting `LISA_PUSHED_REFS_FILE` above the added
lines. The framework names one ref of a push in its environment and no more,
so that is not read either. A branch the remote has never seen runs every
part whoever starts the carrier.

**Whoever owns hooks keeps them.** The evidence is weighed in a fixed order,
and the call to the carrier is added in the owner's own way:

| Owner, in order of evidence | Where the call goes |
| --- | --- |
| `core.hooksPath` naming a folder of the repository | marked lines at the end of that folder's hook file |
| Husky (`.husky/`) | marked lines at the end of `.husky/pre-commit` and `.husky/pre-push` |
| Lefthook (`lefthook.yml` and its other names) | a `lisa-gates` command under the hook's `commands` |
| the pre-commit framework (`.pre-commit-config.yaml`) | one `repo: local` entry at the end of `repos` |
| a hook written by hand in git's hooks folder | marked lines at the end of that hook file |
| nothing | `core.hooksPath` is set to `.lisa/hooks` in the repository's own configuration, which is not committed |

In a shell hook the added lines begin by reading the exit status of whatever
ran above them, so a hook that failed before still fails, with the same
status, and the carrier does not run. A hook manager's YAML file is added to
by line, never parsed and rewritten, and the result is kept only when it
parses to exactly what the file meant before plus the one entry. A file that
cannot be added to safely — not a shell script, not started by git, in a
folder outside the checkout that `core.hooksPath` names, or replaced by Lisa
on every update — is left as it is, and the point is reported `blocked`.

**Lines added to a hook have to be reached.** A hook that leaves before its
end takes the added lines with it: the result would say `installed` and every
commit would pass unchecked. So every line above the place the call goes is
read (`src/controls/carrier-hook-reach.ts`), and the hook is left as it is,
with the point `blocked`, when one of them can end it:

- `exec <program>` anywhere. An `exec` that only redirects (`exec < /dev/tty`)
  is accepted.
- any `exit` that could leave with success: `exit 0`, an `exit` whose status
  is a variable, and an `exit` with no status or with `$?` anywhere but the
  last part of `|| exit` (`|| exit $?`, `|| exit`), where the status it
  carries is a failure.

An `exit` with a written non-zero status (`exit 1`) is accepted wherever it
stands, inside an `if` included: every way it leaves fails the hook, so git
stops the commit itself and nothing passes unchecked. An `exit $?` inside an
`if` is refused. It may be safe, but proving it means following the shell's
control flow, and a wrong proof is a commit that passes unchecked; refusing
costs one paste. The reader
follows quotes, comments and here-documents, so `npm exec` and an `exit` in a
message are not taken for commands. It does not follow a file the hook reads
in, `eval`, or a function called later. The blocked point names the line and
carries the lines to add by hand, the two marker lines included: placed where
they always run, a later run finds them by the markers and reports the point
as wired, and `lisa controls reconcile` reads them as Lisa's.

The same questions are asked of a hook that already holds the lines. A hook
changes after it was wired: someone adds an `exit 0` above the lines, or the
file loses its permission to be started. Such a point is `blocked`, not
`already-wired`.

**The call holds in a checkout it was not written for.** Git's own hooks
folder serves every working tree of a repository and every branch checked out
in one, so the lines added there outlive the commit they were added on. They
depend on neither the folder the shell is in nor the carrier being there:

- They ask git for the top folder of the checkout and start the carrier from
  there. They ask twice. In a linked working tree git names its own folder to
  the hook and not the top folder, so once the hook has changed folder git
  answers with the folder the shell is in (measured on git 2.56); asked again
  without what git named, it finds the top folder from where the shell is.
  The first answer that holds the carrier is used.
- The carrier is there: it runs, and its exit status is the hook's.
- The carrier is not there, and the commit checked out does not contain it:
  one sentence on standard error says the declared checks did not run in this
  checkout and why, and the commit or push goes through. A branch that never
  had Lisa's files has to stay usable.
- The carrier is not there in any other case: the commit or push stops with a
  sentence. That is a carrier removed from a checkout whose commit has it.

The commit is what is asked because carrier files are committed: "this
checkout never had the carrier" is "the checked-out commit does not contain
`.lisa/hooks/pre-commit`".

**Where a project type's own hook already calls the runner with
`--coverage`, nothing is added.** A second call would run every gate twice.
Those points are reported `already-wired`, through `lisa-stack-hook`.

**`core.hooksPath` is not committed.** A new clone has the files and not the
setting, so git runs no carrier there until the command has run once in that
checkout. `--check` exits 3 in such a clone and names the setting, which is
how a later reconcile step can tell. The same holds for a hook manager that
is set up in the repository but not switched on in a checkout: the carrier is
declared, and the point is `blocked` with the manager's own install command.
A manager counts as switched on when the hook git runs is the one the manager
itself generates, told by what only the manager writes there: the line
`File generated by pre-commit`, or Lefthook's `call_lefthook` (in its earliest
versions `lefthook run`) on a line that is not a comment. The manager's name
alone proves nothing: a hook written by hand can mention it in a comment.

**What one checkout wires, every working tree of the repository may use.**
Git's own hooks folder and the repository's configuration belong to the
repository, not to one working tree. Installing through a linked working tree
writes the hook in the main repository's hooks folder, and where nothing owns
hooks `core.hooksPath` is set in the configuration all of them read. Both are
still written, because the call holds in the other checkouts (above), and the
result says so in one sentence whenever the repository has more than one
working tree: that the hook is shared by every checkout of this repository,
or that the setting is.

**No path of the operator's machine is printed.** A result is saved, passed
to the enforce report and shown to people. A path inside the checkout is
written from the repository root. A hook in git's shared folder, which is
outside the top folder in a linked working tree, is written
`<git-common-dir>/hooks/pre-commit` (`git rev-parse --git-common-dir` prints
the folder). Anything else outside the checkout is named by its file name
alone, `<outside the checkout>/pre-commit`.

**The pre-commit framework's stages are written in the names the file uses.**
The framework renamed its stages in 3.2.0 (`commit` to `pre-commit`, `push`
to `pre-push`), and a version before that refuses a whole configuration that
names a stage it does not know. Which version each person runs cannot be seen
from the file, so nothing is guessed. The old names are written when the file
asks for a version before 3.2.0 (`minimum_pre_commit_version`) or already
uses an old name (`commit` or `push` in `default_stages` or in a hook's
`stages`): such a file works today with whatever version its people run, and
the carriers are added in the names it already works with. In every other
file the new names are written. Neither case was measured against an old
version of the framework; the rule only keeps the carriers from being the
first entry in a file to use a name the rest of it does not.

The command prints one JSON document on stdout: one entry per enforcement
point, carrying the `location` and `moment` the register uses for the same
point and one of `installed`, `updated`, `already-wired` or `blocked` with a
reason. It exits 0 when git runs the declared checks at both moments, 2 when
a point is blocked, 3 under `--check` when a run would write something, and 1
when it could produce no result. Edit-time carriers for coding agents are a
further kind of carrier on the same command and result
(`CARRIER_PLANNERS` in `src/controls/carriers.ts`); the next section
describes them.

## Edit-time carriers for coding agents

The earliest place to stop a bad change is the moment an agent writes the
file. That moment is `post-tool`, and what carries it is the agent's own hook,
not git's. `--agents` adds that kind of carrier to the same command:

```
lisa controls install-carriers [path] --agents                # the agents the "harness" setting names
lisa controls install-carriers [path] --agents=claude,codex   # the agents named
```

**The roster is read or named, never guessed.** On its own, `--agents` reads
the `harness` setting of `.lisa.config.json`: `fleet` (or `all`) is every
agent, any other value is that one agent. With names it takes any of `claude`,
`codex`, `cursor`, `agy`, `copilot`, `opencode`, `devin`, or `fleet`, separated
by commas; that is the only form that works where there is no `harness`
setting. Lisa's other commands read a missing `harness` as Claude Code. Doing
that here would write down, as the repository's roster, an agent nobody named
and leave every other agent unrecorded, so a roster that cannot be read gives
no result (exit 1) and says how to name it. Without `--agents` the command
does, prints and writes exactly what it did before the flag existed.

**The registration lives in the repository, not in a plugin.** A repository on
no project type may have Lisa's plugin installed for an agent and nothing
applied to it, and a teammate may have no plugin at all. So each agent's hook
is registered in the file that agent reads from the repository, which is
committed and is there for everyone who clones it. Every such hook starts one
carrier, `.lisa/hooks/post-tool`, placed beside the commit and push carriers
and listed in the same record.

**What "has a hook" means.** An agent can be made to refuse a write when three
things hold: it runs a hook after one of its file-writing tools finishes; that
hook can be registered in a file the agent reads from the repository; and the
hook's result reaches the agent as a failure it has to act on. The table is
`AGENT_SURFACES` in `src/controls/carrier-agent-surfaces.ts`, and a suite holds
it to what Lisa already ships: an agent has the surface exactly where Lisa
ships its own blocking post-edit hook (the threshold ratchet) to it.

| Agent | Hook after a write | Where the carrier is registered | What a refusal looks like | How that is known | Tested |
| --- | --- | --- | --- | --- | --- |
| Claude Code (`claude`) | `PostToolUse` | `.claude/settings.json`, one entry merged into `hooks.PostToolUse`, matcher `Write\|Edit\|MultiEdit\|NotebookEdit` | exit status 2, the failure on standard error | documented | the registered command is started with a synthetic write event |
| Codex (`codex`) | `PostToolUse` | `.codex/hooks.json`, one entry merged into `hooks.PostToolUse`, matcher `Edit\|Write\|apply_patch` | exit status 2, the failure on standard error | documented | same, with an `apply_patch` event |
| Cursor (`cursor`) | `postToolUse` | `.cursor/hooks.json`, one entry merged into `hooks.postToolUse`, matcher `Write\|Edit` | exit status 0 and one JSON object on standard output whose `additional_context` holds the failure | read from the agent's shipped program | same |
| OpenCode (`opencode`) | `tool.execute.after` | `.opencode/plugin/lisa-controls-carrier.js`, a file Lisa owns | an error thrown from the plugin, holding the failure | measured (recorded in the wiki) | the plugin is loaded from the repository and its hook is called |
| Copilot (`copilot`) | `postToolUse` | `.github/hooks/lisa-controls.json`, a file Lisa owns | exit status 2, the failure on standard error | assumed | the registered command is started with a synthetic write event |
| Devin (`devin`) | `PostToolUse` | `.devin/hooks.v1.json`, one entry merged into `PostToolUse`, matcher `^(write\|apply_patch\|edit\|notebook_edit)$` | exit status 2, the failure on standard error | assumed | same |
| Antigravity (`agy`) | none that can refuse | nothing is installed | not possible: its hook after a tool must answer with an empty result | its own hooks guide | the gap is recorded, and the register names the agent |

"Tested" means the suite reads the command back out of the file the agent
reads, starts it the way the agent does with a made-up write event on standard
input, and checks the refusal that row describes; the carrier, the gate runner
and the declared check all really run. It does not mean the agent itself was
run. The two rows marked `assumed` are where to look first if an agent seems
to ignore a failing write: Lisa's other hooks for those agents rely on the
same convention, and nobody has measured it after a file write. The result
carries the row's last two columns on every agent point (`refusal`,
`refusal_evidence`) so a reader can decide how far to trust each one.

**A settings file is added to, never rewritten.** Claude Code, Codex, Cursor
and Devin read a file the repository may already own. One entry is added to
the one list it belongs in, in the file's own indentation, and every other
byte stays: other keys, other hooks, comments, and an entry beside Lisa's
that the repository wrote on one line. The entry goes after everything the
repository wrote in that list, a comment after its last entry included, and
the comma it needs is written directly after the entry before it, in front
of such a comment. Where an older entry of Lisa's is replaced, what is taken
out is that entry, one comma, and the whitespace only it needed (the line it
stood alone on); a comment between it and a neighbour stays where it is. The
text is edited by position
(`src/controls/carrier-json-place.ts`) and not through a JSON editor that
formats what it writes, because such an editor formats whole lines and
reflows whatever shares a line with the entry. The edited text is used only
when it parses to exactly what the file meant before, with Lisa's own
handlers taken out and the entry added. Lisa's entry is recognised by its
command, compared exactly, so no marker key is added to a schema Lisa does
not own. A file that is not JSON, whose list is not a list, or that cannot be
added to without changing what it means, is left as it is; that agent's point
is `blocked` and the reason holds the exact entry to add by hand. Copilot and OpenCode read a file of their own from a folder, so
Lisa places a whole file there under its own name and lists it in the record.

**What the carrier does.** It checks for Node and refuses, naming Node, when
it is missing. It reads the event on standard input, runs
`scripts/lisa-run-gates.mjs --moment=post-tool --builtins=none` from the
repository root, and treats any exit but 0 as a refusal, along with a missing
runner and a run of more than two minutes. The write has already happened; a
refusal is the agent being told, in the one way its hook contract passes on,
that the file does not pass.

**Every check declared at `post-tool` runs after every write.** The runner
leaves out an untouched part at commit and at push only, where git says what
changed; at any other moment "not known" runs every part, and nothing here
adds a second way to skip. What the carrier does pass on is the written file's
path, in `LISA_EDITED_FILE`, the variable Lisa's own on-edit hooks already set
for a declared task: a check that wants to look at one file can, and one that
ignores it checks its whole folder. A check too slow for that belongs at
commit.

**It is for a repository on no project type.** On a supported project type
Lisa's plugin hooks already run a task declared at `post-tool` for the
properties they prove. Installing the edit-time carrier there as well runs
that task a second time after each write; nothing breaks, and nothing is
gained. A check declared as `parts` is run by the carrier alone.

**An agent with no such hook is written down, not skipped.** Nothing is
installed for it. `unenforceable_on` is added to the `post-tool` entry of
every gate checked there:

```json
"post-tool": { "level": "required", "unenforceable_on": ["agy"] }
```

| Rule | Why |
| --- | --- |
| A non-empty list of agent names, each once, from the names the `harness` setting uses | One spelling, so `Agy` cannot be read as an agent other than `agy`. |
| Only at `session-start`, `pre-tool` and `post-tool` | Those are the moments an agent's own hooks carry. Every other moment is carried by git, the hosting platform or a pipeline, so the key would say nothing there. |
| On the moment entry, in its long form | An older Lisa ignores a moment key it does not know; a gate-level key would make it refuse the whole gates block. |

The gate registry validates the key and it changes nothing about what the
moment resolves to. The control register carries the list onto the
enforcement point at that moment, on every entry of the gate, in one fixed
order. `.lisa.config.json` is edited in place: only that value is added, a
short entry (`"post-tool": "required"`) becomes the long form because the
short form has nowhere to hold a list, an agent is only ever added, and a
second run changes nothing. When nothing is declared at `post-tool` there is
nothing to record on; the point says so, and a later run records it.

**The result.** Agent points follow the commit and push points in
`enforcement_points`, one per agent on the roster, with `kind: "agent-hook"`,
`location: "coding-agent"`, `moment: "post-tool"`, the agent's own name for
its `hook`, and `agent`. An agent with no hook has the outcome
`unenforceable`, with `hook: null`, the reason, and `recorded_on` naming the
gates that now carry it. `unenforceable` is not a failure: the command still
exits 0. `roster` says which agents were asked for and whether they were read
or named.

## Open items

- Tests are excluded from the typecheck program (`tsconfig.json` is
  `include: ["src/**/*"]`, `exclude: ["**/*.test.ts", ...]`), so the
  `🔍 Type Check` gate has never checked a test file. Three agents shipped
  `@returns {object}` without CI noticing.
- The former missing `security:audit` task is supplied by the canonical
  audit runner introduced for #4521. It shares package/version/path matching
  with the built-in consumers; see [audit exclusions](../dependency-audit-exclusions.md).
  `check:work-item` and `check:thresholds` also exist in `package.json`.
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
- `rails/copy-overwrite/lefthook.yml` runs `lisa-work-item.mjs validate-push`
  and has no gate runner anywhere in it, so `gates.traceability` is inert at
  push for a Rails consumer — the lefthook counterpart of the
  `quality-rails.yml` gap below, and closing it means bringing the runner to
  that hook rather than bolting a second switch onto one command.
- `quality-rails.yml` carries the same `work_item_traceability` job and **no
  gate façade at all** — no `moment` input, no `package_manager` input, and so
  no resolve block. `gates.traceability` is therefore still inert for a Rails
  consumer, exactly as #2680 describes. Converting that workflow means bringing
  the façade to it, not bolting a second on/off mechanism onto one job.

<!-- Experiment marker for CodySwannGT/lisa#4018 (arm A). Removed with the branch. -->

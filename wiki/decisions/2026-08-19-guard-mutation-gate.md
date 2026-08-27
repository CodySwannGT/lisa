# Decision: Mutation Gate Scoped at the Guard Scripts

Date: 2026-08-19

Status: Accepted

Ticket: CodySwannGT/lisa#2770

## Context

Eight controls were found in one week reporting success while doing nothing. An
empty-string fallback resolved a required-context match to nothing and reported
`not_required`. `RegExp.test(true)` coerced a non-string and passed. An array was
validated for shape but not membership, so `[null]` threw past the error
envelope. A `# shellcheck disable=… -- prose` directive made ShellCheck fail to
parse and silently stop checking the rest of the file. A hook wrote a config to a
path no reader loads.

Every one was green and every one had tests. The tests exercised the happy path,
so they proved the code ran — never that the guard could bite. They surfaced
because a review bot happened to look at an upgrade PR, which is luck, not
process.

Mutation testing is that check run mechanically: flip a condition, empty a string
literal, negate a return, rerun the tests, and if nothing fails, that branch has
no test with teeth. Each defect above is a mutation that would have survived.

## What Stryker already was here

Not a runner. Before this change Stryker existed in three places, none of which
executed anything in this repository:

1. `stryker` is a declared `threshold-ratchet` family (`kind: "stryker"`,
   matching `stryker.conf.json` anywhere), with a comparator that ratchets
   `thresholds.break` upward and reports removed mutate targets and added `!`
   negations as weakenings.
2. `stryker.conf.json` ships as a create-only template for the TypeScript and
   Expo stacks, and `@stryker-mutator/*` is a governed devDependency in the
   TypeScript, Expo and CDK `package.lisa.json` files.
3. `.github/workflows/quality.yml` carries a `test_mutation` job whose first step
   greps `package.json` for the literal `"test:mutation"`.

This repository had no `stryker.conf.json`, no `test:mutation` script and no
Stryker dependency, so that job resolved nothing and printed a skip notice on
every pull request. The mechanism was complete and nothing was attached to it —
which is the same shape as the defects that prompted the work.

So this change wires an existing runner rather than introducing one, and it
enforces the floor through the existing ratchet family rather than a parallel
mechanism. `stryker.conf.json` at the repository root is matched by the `stryker`
family with no change to `threshold-ratchet-families.mjs`.

## Decision

`bun run test:mutation` runs Stryker over the guard scripts named one by one in
`stryker.conf.json`, against a narrowed vitest config, on every pull request.

### The floor is the measured score

`thresholds.break` is **32**, the integer floor of a measured **32.14%** over
4,649 mutants in the committed mutate list. It is not an aspiration. A gate that
is red on arrival gets bypassed and then ignored, and the ratchet is what makes
the number move: `thresholds.break` may only rise, and lowering it needs a
`thresholdRatchet.allow` entry merged from the base side.

### `thresholds` is config-owned, and the file says so

The floor exists in two files: `.lisa.config.json`
(`quality.mutation.strykerThresholds`) declares it, and `stryker.conf.json`
(`thresholds`) is where Stryker reads it. The sync registry binds them, so they
are one value wearing two hats — and they drifted apart unnoticed
(CodySwannGT/lisa#2968), because `stryker.conf.json` is the only *partial* sync
binding in the registry. Every other synced artifact is written wholesale, so a
hand-edit to one is obviously wrong and gets overwritten; this is the one file
where editing its other keys is correct and editing `thresholds` is silently
wrong.

Two executable controls hold the boundary, because a comment at that rung has
measured near-zero adherence here:

- **The sync refuses an _unrecorded_ divergence.** When the declared and
  enforced floors disagree and nothing says why, `lisa sync` fails naming both
  values and the file each came from, and writes nothing — in either direction,
  dry run included. Writing the declared floor can raise it above the score the
  codebase actually measures, reddening the gate on unchanged code; absorbing
  the enforced floor would silently lower a declared standard. Neither is a
  decision a sync gets to make.
  (`src/sync/stryker-thresholds-ownership.ts`.)
- **A _recorded_ divergence is honoured, not blocked.** When
  `_thresholdsDivergence` still records both live numbers and a reason, sync
  proceeds, leaves the enforced floor alone, and reports a
  `divergence-honoured` action naming both values and the reason. This half
  matters as much as the refusal: a guard that blocks routine work during a
  sanctioned exception gets deleted rather than obeyed, and the exception here
  is deliberate and open-ended. A declaration that has gone stale against
  either live value is no longer a record of a decision, so it stops exempting
  anything and the refusal returns.
- **Nothing else in the toolchain is affected.** `lisa apply` never runs the
  config sync, so a refusal cannot reach the fleet; the only callers are
  `lisa sync`, `lisa ui` (skippable with `--no-sync`), and the read-only health
  probe.
- **The file states its owner, checkably.** `stryker.conf.json` carries
  `_thresholdsOwner` naming the owning config key, and — while the two are
  deliberately allowed to differ — a `_thresholdsDivergence` block recording
  both numbers and why. A hand-edit of `thresholds` that leaves that block
  behind fails a test naming the key; once the two agree, the block must be
  deleted.

The number itself is deferred, not settled: it must be set from a measured
aggregate once bounding unbounded child spawns (CodySwannGT/lisa#2940) stops
crediting timed-out mutants as killed. Sizing a floor against a distribution
that is still clipping is the defect, not the fix.

That the ratchet runs at all was verified rather than assumed, because until
CodySwannGT/lisa#2787 it did not: the `threshold_ratchet` job looked for
`scripts/check-threshold-ratchet.mjs`, which this repository has never had — it
ships that script as a template and mirrors only 2 of the 11 copy-overwrite
scripts under `scripts/`. The job took its early return every time, so no quality
threshold in this repository had ever been compared. The job now falls back to
the in-repo template path, and running that path directly against the base
returns cleanly, which is what makes the one-way claim a gate rather than a
sentence. On this change itself the comparator has no base-side file to compare,
so the property binds from the next pull request onward;
`tests/unit/scripts/mutation-gate-wiring` covers the interim by feeding
`compareFile` the committed config against a lowered copy and requiring the
finding.

The rounding down leaves 0.14pp of margin, about six mutants, which is thin on
purpose. Within a fixed tree the score is deterministic — two runs returned the
same figure to the decimal, and the four different figures measured during this
work each track a change to the tree, not noise. The one genuinely variable input
is timeout classification, and it moves in the safe direction: a timeout counts
as a kill, so a slower machine scores higher, and the three timeouts observed in
every run are worth 0.07pp at most if a faster one reclassified all of them.

**Read 32% as uncovered, not clean.** 2,675 of the 4,649 mutants — 58% — were
never tested at all, and that is most of what the figure measures. Of the 1,974
that were covered, 76% died. So the number says "32% of this guard code has a test
that can be *proved* to bite, and the rest is unmeasured", not "these guards are
barely tested". Anyone reading it without that will draw the wrong conclusion, and
the reason is structural: Stryker credits a kill only when the mutated module
loads in the test's own process, and a large share of these guards are tested by
running them as subprocesses.

Per-file scores at the baseline, which are the useful part of the number:

| Guard | Score | Killed | Survived | Uncovered | Mutants |
| --- | ---: | ---: | ---: | ---: | ---: |
| `lisa-test-node.mjs` | 66.67 | 22 | 6 | 5 | 33 |
| `lisa-reconcile-policy.mjs` | 62.43 | 462 | 167 | 111 | 740 |
| `lisa-floor-collisions.mjs` | 59.85 | 79 | 16 | 37 | 132 |
| `lisa-gates.mjs` | 59.22 | 469 | 129 | 194 | 792 |
| `lisa-run-gates.mjs` | 48.59 | 138 | 35 | 111 | 284 |
| `threshold-ratchet-compare.mjs` | 41.27 | 78 | 34 | 77 | 189 |
| `threshold-ratchet-families.mjs` | 38.94 | 88 | 43 | 95 | 226 |
| `lisa-destructive-guard.mjs` | 19.61 | 30 | 3 | 120 | 153 |
| `lisa-work-item.mjs` | 6.10 | 128 | 47 | 1,925 | 2,100 |

(`lisa-gates.mjs` and `lisa-floor-collisions.mjs` each include timeout-classified
mutants in the killed column, which is how Stryker counts them.)

`lisa-work-item.mjs` is 45% of the run and contributes 128 kills, because almost
all of its tests drive it as a subprocess (see *What this cannot reach*). It is
kept in scope anyway: dropping the largest guard from a gate about guards is
exactly the scope shrink the ratchet exists to refuse, and its uncovered mass is
a true finding rather than noise.

### It runs on pull requests, and there is no nightly split

The measured full run is **3m16s** wall on a 4-way local box, 3m41s on a repeat run: a 68s dry run plus 4,649 mutants at an average of 1.63 tests each,
which `coverageAnalysis: "perTest"` is what makes possible. Against the
`test_mutation` job's existing 60-minute budget that needs no split, so it did
not get one. A
diff-scoped variant was considered and rejected on a second ground as well: with
`break` a single global number, scoping the run to changed files changes the
denominator, and a pull request touching only `lisa-work-item.mjs` would score
6.10% against a 32% floor and be red on arrival for no defect at all.

The gate is declared `test-meaningfulness: { "pull-request": "optional" }`. The
job runs and goes red on a regression; `optional` means it does not yet imply a
branch-protection context. Promotion to a required context is governed by
`.github/required-check-promotions.json`, which demands proven headroom measured
against a run that reproduced the failure the budget prevents. That evidence does
not exist yet, and claiming it would be the same defect in a new place.

### The suite list is derived, never written down

`vitest.config.mutation.ts` computes its `include` from `stryker.conf.json` — the
unit suites that reach a mutated guard through static `import` declarations,
transitively through test helpers. A hand-maintained list is the failure this
gate is for: it goes stale in silence, and a guard whose only suite dropped off
the list scores nothing while the aggregate still clears the floor.

That also makes the static import load-bearing rather than stylistic. `import()`
of a URL assembled at runtime is invisible to Vite's module graph, so neither
this resolver nor Stryker's own related-files filter sees the edge and every
mutant in the guard is reported uncovered. `tests/unit/scripts/threshold-ratchet`
was converted from a runtime-URL import to a static one in this change, which is
what brought the ratchet modules' 415 mutants into the gate; before the
conversion both scored 0.00 with every mutant uncovered.

### The gate has its own bite test

`tests/integration/mutation-gate-bite` runs the gate that actually guards pull
requests — the committed `stryker.conf.json`, all nine guards, **no threshold
override** — twice: once with every suite, once with
`tests/unit/scripts/lisa-gates.test.ts` withheld. The first must pass, the second
must fail. Measured: **32.14% intact, 28.72% withheld, against the committed
floor of 32**, and the withheld run exits 1 with `Final mutation score 28.72
under breaking threshold 32`.

Withholding a suite is mechanically the same weakening as gutting its assertions
— a test that does not run cannot kill a mutant — and it cannot leave the working
tree modified if the process dies mid-run. `lisa-gates.test.ts` was chosen by
measurement rather than by eye: its 3.42-point margin is the widest of the
candidates tried, so an ordinary improvement elsewhere cannot quietly lift the
weakened run back over the line. Withholding
`lisa-reconcile-policy-verdicts.test.ts` also bites (31.02) but leaves under a
point of room.

**The first draft of this test was itself inert, and that is worth recording
rather than quietly fixing.** It mutated a single guard against a threshold of 45
invented for the occasion: 48.59% intact, 36.27% withheld. It went red, which
looked like proof — but 36.27 passes the real floor of 32, so the withheld run
would have sailed through the actual gate. The test failed only because of the
substituted number. A bite test that cannot bite, inside the gate built to find
exactly that, found by a review bot rather than by us.

So the test now carries `assertNoSyntheticThreshold`: Stryker echoes the
threshold it judged against, and that number is compared to
`stryker.conf.json` on both runs. The two status assertions already catch a crude
override — a break of 45 fails the intact run outright — but they cannot catch a
fake chosen to sit *between* the two scores, which is precisely the shape the
first draft had. Proved by reintroducing one: with a synthetic break of 30, both
runs behave exactly as the test expects and it still fails, by name —

```
AssertionError: the gate must be judged against the committed thresholds.break,
never a number invented for this test: expected 30 to be 32
```

The run costs about three minutes, because two full gate runs is what an honest
answer costs here. The cheap version is the one that was wrong.

## What this cannot reach

Reported rather than omitted, because a gate whose gaps are undocumented is the
thing being fixed.

**Guards tested only out-of-process.** Stryker attributes a kill to a test only
when the mutated module is loaded in the test's own process. Suites that copy a
script into a temporary project and run it as a subprocess exercise it for real,
but nothing can attribute the result to a mutant, so every mutant reads as
uncovered. This is most of `lisa-work-item.mjs`'s 6.10%, and it is why
`check-state-classification.mjs`, `lisa-schema-validate.mjs`,
`lisa-command-envelope.mjs`, `check-nightly-e2e-health.mjs`,
`check-skipped-required-checks.mjs`, `check-verification-coverage.mjs` and
`check-threshold-ratchet.mjs` are not in the mutate list at all — every one is
genuinely tested, and none of those tests can be credited with a kill.

**Guards whose tests assert their own bytes.** `scripts/lib/invoked-as-script.mjs`
was in the first mutate list and had to come out. Its suite asserts that the lane
copies are byte-identical to the canonical file, and instrumentation changes the
bytes, so the dry run went red before a mutant was tried. That is a real
incompatibility, not a configuration mistake: a file cannot be both mutated and
byte-asserted in the same run.

**Derived copies.** `typescript/copy-overwrite/scripts/threshold-ratchet-*.mjs`
and the `rails/` equivalents are generated from `plugins/src/base/hooks/` by
`scripts/build-plugins.sh` and differ only by a managed-file banner. The
canonical source is mutated; mutating the copies would double the runtime to
re-prove the same logic.

**Shell guards.** `plugins/src/base/hooks/` is mostly `.sh`, and the ShellCheck
directive defect in the motivating set was a shell defect. Stryker has no shell
mutator, so this gate provably cannot catch the thing that motivated part of it.
Every shell guard here is uncovered, not clean, and this decision does not
pretend otherwise. `hook-scripts-parse` and the per-hook suites are what exercise
them today.

*Amended 2026-08-25 (CodySwannGT/lisa#3111), with the measurement the original
paragraph left to inference.*

**Widening `mutate` is not the fix, and is strictly worse than the gap.** The
obvious reading of the paragraph above is that a `.sh` path in `mutate` would
produce zero mutants — a harmless no-op. It does not. Measured directly, with a
throwaway config naming one shell file:

```
INFO ProjectReader Found 1 of 7937 file(s) to be mutated.
ERROR Stryker Unexpected error occurred while running Stryker
  Error: Unable to parse …/scripts/build-plugins.sh. No parser registered for .sh!
      at parse (@stryker-mutator/instrumenter/dist/src/parsers/create-parser.js:13:19)
```

Stryker's instrumenter is per-language and dispatches on extension. An extension
with no parser throws out of instrumentation, **before any mutant is generated**,
so a single `.sh` entry does not merely fail to measure that guard — it takes the
score of every other guard in the list with it. There is no `mutate` list, glob,
or plugin setting that changes this; closing the gap would need a shell mutation
tool, which is a different tool, not a different config.

**Both halves are now executable, not prose.** `lisa-mutation.mjs` refuses a
`mutate` entry Stryker cannot parse as `uninstrumentable-mutate-target` (exit 1,
naming the crash it prevented), and reports a diff whose only guard changes are
shell as `uninstrumentable-language` rather than `nothing-to-mutate`. The two
outcomes were previously one grey line, and they are opposite claims: one says
nothing this gate watches changed, the other says a guard changed and the gate is
structurally blind to it.

**What does measure a shell guard: the driving test.** Run the script as a
subprocess against a payload table and assert the verdict — blocked or allowed —
with a control on *both* sides. That is a bite test even though it is not a
mutation test, and this repository already does it well in places:
`tests/helpers/safety-net-guard-harness.ts` drives `parity-safety-net.sh` with
`EXIT_BLOCKED`/`EXIT_ALLOWED` payload tables, and
`tests/unit/hooks/enforcement-fallback.test.ts` pins both "blocks the bypass" and
"lets an ordinary command through". A test that only runs `bash -n`, greps the
script's source, or asserts the file exists is a *source-shape* check and is not
evidence of bite — `hook-scripts-parse` and `shellcheck-directives` are both in
that category, so the sentence above naming them as what exercises the shell
guards was too generous.

**Shell guards with no driving test at all** — surveyed 2026-08-25, meaning
nothing in `tests/` ever executes them to see whether they refuse:

*Enforcement guards (can refuse inside a live agent session):*

- `plugins/src/base/hooks/block-direct-issue-create.agy.sh`
- `plugins/src/base/hooks/block-instruction-file-edits.agy.sh`
- `plugins/src/base/hooks/block-shell-json-parsing.agy.sh` — the asymmetry is
  the finding: the two sibling agy shims, `block-no-verify.agy.sh` and
  `parity-safety-net.agy.sh`, both have full both-sided suites. These three have
  zero references anywhere in `tests/`.
- `plugins/src/base/hooks/threshold-ratchet.sh` — only wiring and
  `fs.existsSync` assertions.
- `src/codex/scripts/sg-scan-on-edit.sh`, `src/codex/scripts/rubocop-on-edit.sh`
- `all/copy-overwrite/scripts/lisa-hooks/block-managed-file-edits.sh` — the
  *shipped* copy. Its source is well tested and the host dispatcher dispatches
  this copy, but it is absent from the `GUARDS` roster in
  `tests/unit/hooks/host-enforcement-fallback.test.ts`, so the copy has neither a
  driving test nor a drift pin.

*CI and operational guards (refuse in a pipeline or at a terminal):*

- `scripts/check-rules-pairing.sh` — appears in `tests/` once, as a string in a
  workflow trigger-path list.
- `scripts/github-status-check.sh`, `scripts/test-intent-routing.sh` — zero
  references; the second is itself a validator whose entire purpose is to fail.
- `scripts/setup-deploy-key.sh`
- `plugins/src/base/skills/lisa-jira-evidence/scripts/post-evidence.sh` and its
  `rails`/`expo` twins — three `exit 1` refusal paths, source-text greps only.
- `rails/copy-contents/scripts/lisa-mutation.sh` — every `lisa-mutation` suite
  targets the `.mjs`; the referencing tests only write it into a fixture.
- `expo/`, `nestjs/`, `harper-fabric/create-only/scripts/zap-baseline.sh`
- Refusal paths only, in otherwise-action scripts: `scripts/lisa-update-local.sh`,
  `scripts/lisa-commit-and-pr-local.sh`, `scripts/cleanup-worktrees.sh`,
  `scripts/cleanup-github-branches.sh`,
  `scripts/cleanup-local-merged-branches.sh`,
  `scripts/cleanup-amplify-branches.sh`, `scripts/lisa-remote-env/setup.sh`.

**Driven, but with only one side.** No refusal-only suite was found; every
one-sided case is *allows-only* — the script is executed successfully and nothing
proves it can refuse: `sg-scan-on-edit.sh` (typescript and rails),
`rubocop-on-edit.sh` (rails), `lisa-edit-gate.sh` and its three byte-identical
copies (its `|| exit 2` propagation is never asserted, though
`tests/integration/support/pre-tool-refusal-harness.ts` already exposes a
`taskExit` option for it), `scripts/lisa-github-repo-settings.sh`,
`scripts/lisa-github-repo-setup.sh`,
`rails/copy-overwrite/scripts/lisa-clean-git-env.sh`,
`remote-agent-aws-setup.sh`, and `download-attachment.sh`. The `lint-on-edit.sh`
sibling *does* have a refusal case asserting `toBe(2)`, which is what the others
should look like.

**A mutation-equivalent for shell was considered and declined.** Two shapes were
weighed. Mutating the *payload table* rather than the source measures the table's
coverage, not the guard's — it cannot distinguish a guard that refuses correctly
from one that refuses everything, which is the discrimination the whole gate is
for. An external shell mutation tool (`mutate.sh`, `bashmutant` and similar) means
adopting an unmaintained dependency, a second runner, and a second threshold
family, to cover roughly thirty small scripts whose branches are shallow enough
that a both-sided payload table gives equivalent evidence for far less machinery.
The recommendation is therefore the cheaper arm of #3111 — the honest,
executable acknowledgement above — plus closing the driving-test gaps listed
here, which is ordinary test work rather than new infrastructure.

## Two things the review caught that the gate did not

Both are the same class this gate exists for, found inside it, and both are
recorded rather than quietly patched.

**The suite resolver read imports by hand.** It matched `from "…"` on
semicolon-split statements, so it silently dropped single-quoted specifiers,
side-effect imports with no `from` clause, and — because splitting on `;` merges
two semicolon-free declarations — every specifier but the last of such a pair.
Prettier makes those forms rare here, which is precisely why it would have gone
unnoticed: the resolver was correct by accident of formatting. Each omission is
invisible in the worst way, since the suite simply never joins the run and the
guard reports its mutants as uncovered. It now uses TypeScript's own
`preProcessFile`, which reports every form. The derived list is unchanged at 28
suites — the fragility was the finding, not a present miscount.

**The sandbox survived failed runs.** Stryker's `cleanTempDir` defaults to
removing the sandbox only after a *successful* run, so exactly the runs worth
investigating were the ones leaving a full second copy of the tree behind, and a
leftover sandbox costs the next `lint:slow` 1,191 parse errors at paths outside
every tsconfig project. Now `"always"`, alongside the test's own cleanup and
ignore entries in both the root and template lint/format configs.

## Consequences

- The floor can only rise. Closing any gap above means adding a mutate target,
  which the ratchet permits; removing one needs a human-approved allow entry.
- `tests/unit/scripts/mutation-gate-wiring` asserts the routes by which this gate
  could go vacuously green: a renamed script the CI grep misses, a `break` of
  zero, a mutate entry pointing at a path that no longer exists, and a guard no
  suite reaches.
- Converting a guard's suite from a runtime-URL import to a static one is the
  cheapest way to raise the score, and it raises it for a real reason.

## Amendment — 2026-08-20: Lisa runs the gate it ships

Ticket: CodySwannGT/lisa#2823

`test:mutation` in this repository was `stryker run` — the whole list, every
time — while every consumer got `node scripts/lisa-mutation.mjs` under a `force`
pin: diff-only, self-skipping, and pointed at just the files a branch changed.
So the one repository able to notice a defect in the shipped gate was the one
repository not running it, and the pre-push hook's own comment described a
script this repository did not have. `test:mutation` is now
`node scripts/lisa-mutation.mjs`, a twelve-line entry point into the shipped
implementation — the same arrangement `scripts/lisa-work-item.mjs` already uses.

### A straight copy would have installed an inert gate

The shipped wrapper's eligibility filter was
`f.startsWith("src/") || f.startsWith("lib/")` with a `.ts`/`.tsx` extension
test. **Zero of this repository's mutate targets survive it** — they are `.mjs`
guard scripts under `all/copy-overwrite/scripts/` and `plugins/src/base/hooks/`.
Adopting it unchanged would have replaced a gate that at least fails loudly with
one that selects no file, generates no mutant and exits 0 on every run: the
defect class this gate exists to find, installed as the gate.

So the filter now reads the project's own Stryker `mutate` declaration and
matches changed files against those globs, falling back to exactly the old
hardcoded patterns when no `mutate` key is declared. Two things follow for
consumers, both corrections rather than changes of intent:

- A project whose sources are not under `src/` or `lib/` gets a gate that works
  instead of one that is silently empty.
- `--mutate` REPLACES the configured patterns, so a changed `lib/` file used to
  be handed to Stryker even though both shipped `stryker.conf.json` templates
  exclude `lib/`. It no longer is.

### Empty and clean are now different outcomes

A diff-only gate that mutates nothing exits 0, exactly like one that mutated
plenty and killed everything. The wrapper now separates them by name:

| Outcome | Exit | Means |
| --- | ---: | --- |
| `mutation-gate: scoped-run` | Stryker's | Files were selected and mutated |
| `mutation-gate: nothing-to-mutate` | 0 | The branch changed no mutate target |
| `mutation-gate: inert-mutate-config` | **1** | The patterns select no tracked file **at all** |
| `mutation-gate: no-diff-base` | 0 | No merge-base resolved (shallow clone) |
| `mutation-gate: disabled` | 0 | `mutation.gate.json` says so |

`nothing-to-mutate` prints how many files changed, how many were selected, which
declaration selected them, and the sentence *"NO mutant was generated and NO
score was computed"*. `inert-mutate-config` is the one that matters most and it
costs one `git ls-files`: a legitimate empty diff and a permanently broken gate
produce the same empty selection, and only the second is a defect — so the
second fails.

### The diff-scoped variant this document rejected, and what changed

The original text rejected diff scoping on the ground that "with `break` a
single global number, scoping the run to changed files changes the denominator,
and a pull request touching only `lisa-work-item.mjs` would score 6.10% against
a 32% floor and be red on arrival for no defect at all."

That objection is answered in three parts, and one part of it still stands.

**The premise moved.** `lisa-work-item.mjs` is no longer 6.10; the measured
per-file table below is what to read instead.

**The whole-list score is still gated on every pull request.**
`tests/integration/mutation-gate-bite` runs the committed configuration over
every mutate target with no threshold override and requires the intact run to
clear `thresholds.break`. That is a full run, on current suites, on every PR —
so nothing the full gate used to catch stopped being caught, including the case
diff scoping structurally cannot see: **a test file gutted without touching the
guard it covers is not in the diff**, and the intact run is what notices.

**Where a single target scores below the floor, red-on-arrival is real.** The
honest framing is that the aggregate floor is what lets a weak guard hide behind
strong ones; scoped to a diff, the floor applies to what you touched. The fix
when that bites is to strengthen the tests for the file you changed, or to
accept the wider diff — never to lower `break`, which the ratchet refuses
anyway.

### The gate script is itself a mutate target

`typescript/copy-overwrite/scripts/lisa-mutation.mjs` joined the mutate list in
the same change. It decides what every other guard's mutants are computed from,
so a defect in it disables everything downstream of it silently — the same
argument that put the guards in the list. It joined
`mutation-gate-bite`'s `WITHHELD_GUARDS` at the same time, because a new
well-covered target raises the weakened run as well as the intact one, which is
the margin erosion that list was rewritten to prevent.

### The diff-scoped run narrows the dry run too

The dry run is the fixed cost a diff-scoped run cannot otherwise shrink — 159s
of the whole gate's work, paid whether one guard is mutated or nine. The wrapper
exports `MUTATION_SCOPE` with the files it selected, and
`vitest.config.mutation.ts` narrows its derived `include` to the suites reaching
those guards. A suite that cannot reach a mutated guard cannot kill one of its
mutants, so dropping it is free; and narrowing can only ever remove kills, so no
value of `MUTATION_SCOPE` turns a failing gate green. An unrecognised scope falls
back to the whole list, because running everything is slow and running nothing is
a gate that reports success having mutated nothing.

### Bite tests

`tests/integration/mutation-gate-diff-bite` drives the real `scripts/lisa-mutation.mjs`
against a real Stryker in a throwaway project, three times: the mutate target
changed with tests that kill every mutant (passes), the same change with the
assertions gutted to a `typeof` check (**fails**), and a doc-only branch (exits 0
having reported `nothing-to-mutate`, with no Stryker sandbox on disk to show it
never started). The fixture's `break` is 100 — *every mutant must die* — which is
the one threshold that cannot be a number invented to sit between two scores.

`tests/unit/scripts/lisa-mutation-gate` covers selection and the outcome
vocabulary, driving `runGate` against real temporary git repositories with a
stand-in for the Stryker binary that records its argv and chooses its exit code.

Shown failing against the pre-fix code rather than asserted to be meaningful.
Restoring the hardcoded `src/`+`lib/` filter fails seven by name, including
*selects Lisa's own .mjs guard scripts*, *selects a .mjs guard outside src/,
which the old filter could not*, and *fails when the mutate config selects
nothing in the repository*. Restoring the old one-line "Nothing to mutate."
message fails the empty-diff control by name: *reports nothing-to-mutate
distinguishably, and never starts Stryker*.

### Measured

Measured 2026-08-20 on an 18-core machine under heavy contention (loadavg 76–160
throughout, dozens of concurrent Stryker processes from other agents). Every
number below is from that machine, so treat them as an upper bound on wall clock
and read the RATIO, not the seconds.

**The whole-list run — what every push used to pay.** `bun run test:mutation:full`,
the committed configuration, 5,515 mutants over nine targets:

```
Final mutation score of 53.62 is greater than or equal to break threshold 32
Done in 38 minutes and 38 seconds.
```

122 of the kills are timeouts, which the contention inflates: a timeout counts as
a kill, so a busier machine scores slightly higher. The 32.14 recorded above was
measured before `lisa-work-item.mjs`'s suites improved.

**That inflation is now measured and bounded rather than merely noted.** A later
whole-list run put the figure at 117 timeouts of 3,455 detected — 3.39%, worth up
to 2.00 score points, so the printed score was a function of how busy the box
was. Every completed run through the gate now prints the count, the score as
reported, and the score recomputed with timeouts NOT credited; the recomputed one
is judged against `thresholds.break`, and a run whose timed-out share of detected
mutants exceeds a ceiling fails naming the share. Both checks sit on top of
Stryker's own verdict and can only tighten it — nothing there can turn a red run
green. Raising `timeoutMS` is explicitly not the remedy: it converts a timeout
into a slow pass and hides the identical gap.

`test:mutation:full` runs through the shipped gate (`--all`) rather than invoking
`stryker run` directly, for exactly this reason — the whole-list run is the one
big enough for the timeout bucket to matter, and it used to bypass the accounting
entirely.

Per-file, which is the part that matters for a diff-scoped gate:

| Guard | Score |
| --- | ---: |
| `lisa-test-node.mjs` | 66.67 |
| `lisa-reconcile-policy.mjs` | 62.43 |
| `lisa-floor-collisions.mjs` | 59.85 |
| `lisa-gates.mjs` | 59.40 |
| `lisa-work-item.mjs` | 55.48 |
| `threshold-ratchet-compare.mjs` | 47.24 |
| `threshold-ratchet-families.mjs` | 38.94 |
| `lisa-run-gates.mjs` | 37.83 |
| `lisa-destructive-guard.mjs` | **19.61** |

**Eight of the nine clear the floor on their own; `lisa-destructive-guard.mjs`
does not.** So the red-on-arrival case the original text warned about is real and
has exactly one address today: a branch touching only that guard scores 19.61
against 32 and the gate refuses it. That is not a reason to lower `break` — 19.61
means 120 of its 153 mutants have no test that can be shown to bite, and the
aggregate is what was hiding it. It is recorded here so the next person to meet
it knows it is a finding rather than a misconfiguration.

**The diff-scoped run — what this branch actually pays.**

On this branch — which changes 17 files, one of which is a mutate target —
`bun run test:mutation` selects that one file and hands it to Stryker:

```
🧬 mutation-gate: scoped-run — Stryker on 1 of 17 changed file(s), selected by stryker.conf.json:
   • typescript/copy-overwrite/scripts/lisa-mutation.mjs
INFO ProjectReader   Found 1 of 7656 file(s) to be mutated.
INFO Instrumenter    Instrumented 1 source file(s) with 356 mutant(s)
INFO DryRunExecutor  Initial test run succeeded. Ran 52 tests in 32 seconds.
Final mutation score of 81.93 is greater than or equal to break threshold 32
Done in 3 minutes and 52 seconds.
```

| | whole-list | diff-scoped |
| --- | ---: | ---: |
| Wall clock, end to end | **2,332s (38m52s)** | **246s (4m06s)** |
| Mutants generated | 5,515 | 356 |
| Mutants tested | 4,812 | 321 |
| Tests in the dry run | every suite reaching any target | 52 |
| Score | 53.62 | 81.93 |
| Floor | 32 | 32 |

**9.5x less wall clock at the push moment**, on the same machine minutes apart.
The dry run is most of what remains: 32s of the 246s, and it is 32s rather than
the whole suite because `MUTATION_SCOPE` narrowed `vitest.config.mutation.ts`'s
`include` to the one suite that reaches the one guard being mutated.

The two scores are not comparable and should not be compared — 53.62 is nine
guards, 81.93 is one file, and the second number says nothing about the other
eight. What makes the scoped run trustworthy is not its score but that it names
what it measured: **1 of 17 changed files, 356 mutants, 52 tests**. A run that
measured nothing prints `nothing-to-mutate` and says so in five lines.

## Amendment — 2026-08-27: push runs mutate changed lines, not whole files

Ticket: CodySwannGT/lisa#3317

File selection removed most of the whole-list cost, but it still had an
unbounded shape for the largest guards: a two-file review follow-up
instrumented **3,550 mutants** and selected **3,398** for testing because each
small edit handed the entirety of both multi-thousand-line files to Stryker.
After five minutes only 1,610 had completed and the remaining estimate exceeded
an hour. The run was interrupted; that was a performance failure in the push
gate, not evidence about the tests.

The ordinary diff gate now parses Git's zero-context hunk headers and passes
Stryker `path:start-end` entries for only the new-side lines in each selected
file. Adjacent hunks are merged. A deletion-only hunk has no current line on
which Stryker can place a mutant, so it produces the explicit
`no-current-lines-to-mutate` outcome rather than being misreported as either a
measured pass or a branch that changed no mutate target. `--all` is unchanged:
scheduled whole-list measurement still uses the committed patterns with no
range override.

The same branch after line scoping selected **11 changed ranges and 34 mutants**.
It completed in **2m42s** with a 76.47 score and no timeouts. The 373-test dry
run remained 2m25s of that total, so this does not claim the fixed cost is gone;
it removes the unbounded mutant phase that had projected beyond an hour. The
`MUTATION_SCOPE` suite selector strips the range suffix before matching guards,
preserving its fail-safe whole-list fallback for genuinely unrecognised paths.
The real strong/weak diff bite now changes executable code, proving the ranged
gate both passes tests that kill its mutants and fails the same change after the
assertions are gutted.

## Amendment — 2026-08-21: the destructive guard, 19.61 → 96.08

The amendment above recorded `lisa-destructive-guard.mjs` at **19.61** — 30
killed, 3 survived, **120 uncovered** of 153 — as a finding rather than a
misconfiguration, and ruled that the fix was to strengthen the tests and never
to lower `break`. This is that fix, measured.

**The 120 uncovered mutants were not untested. They were unseen.** Three suites
exercised the guard; only one reached it through a static `import` declaration.
The other two loaded it with `await import(pathToFileURL(…).href)` inside
`beforeAll`, and this document already says why that is invisible: the specifier
is assembled at runtime, so neither `vitest.config.mutation.ts`'s resolver nor
Stryker's own related-files filter can see the edge. Both suites passed on every
run and neither could kill a mutant. 19.61 is very nearly the score of the one
visible suite.

This is the same defect, in the same shape, this document records fixing once
before: the `threshold-ratchet` suites were converted from a runtime-URL import
to a static one, which is what brought their 415 mutants into the gate — before
the conversion both modules scored 0.00 with every mutant uncovered. It recurred
in a second file, undetected, because nothing checked for it.

### What changed

**Both suites converted to static imports.** That alone took the guard from
19.61 to **84.97** — 130 killed, 17 survived, 6 uncovered — with no new
assertion written. The tests were always this strong; the gate could not see
them.

**The byte-assertions moved out**, to `destructive-guard-source-shape.test.ts`.
The document's own rule is that a file cannot be both mutated and byte-asserted
in the same run: `expect(guardSource).not.toMatch(/process\.env/u)` reads the
sandbox copy, and Stryker instruments that copy with a
`process.env.__STRYKER_ACTIVE_MUTANT__` read. The behavioural halves are inside
the gate; the structural half is deliberately outside it, along with the
assertions about which tree ships `check-state-classification.mjs`.

**Tests written for the residue**, in `destructive-guard-boundaries.test.ts`.
The 17 survivors were not noise — each named a property nothing asserted. A
denial whose message was deleted still refuses, so no behavioural test noticed
the reason could vanish; a value with no alphanumeric segment could classify as
non-production and every existing case still passed. That took the guard to
**96.08** — 147 killed, **6 survived, 0 uncovered** of 153.

| | before | static imports | + boundary tests |
| --- | ---: | ---: | ---: |
| Score | **19.61** | 84.97 | **96.08** |
| Killed | 30 | 130 | 147 |
| Survived | 3 | 17 | 6 |
| Uncovered | 120 | 6 | 0 |
| Gate on a single-file branch | exit 1 | exit 0 | exit 0 |

`thresholds.break` is unchanged at 32, and no `thresholdRatchet.allow` entry was
added for the `stryker` family.

### The six that remain are equivalent mutants

Named, so the next person does not spend an afternoon on them:

| Mutant | Why no test can kill it |
| --- | --- |
| `typeof value !== "string" \|\| …` → `false \|\| …` | every non-string normalizes to `""`, which is already an unresolved sentinel, so the second clause catches what the first would have |
| `/[^a-z0-9]+/u` → `/[^a-z0-9]/u` | the two differ only by empty strings between adjacent delimiters, and `.filter(Boolean)` removes exactly those |
| `fields?.environment`, `request?.resolvedEnvironment`, `request?.requestedStage` → non-optional | all three are reached only after `isDestructive` returned true, which a nullish argument cannot do |
| `argv ?? []` → `argv ?? ["Stryker was here"]` | the placeholder is not a flag, so all three returned fields are identical |

### The aggregate was the concealment, and still is

The whole-list score was 53.62 against a floor of 32 while this guard sat at
19.61. Nothing in a whole-list run says which file is carrying which. What
exposes it is the **diff-scoped** gate (#2823): a branch touching one mutate
target is judged on that target's score alone, which is why this guard was
red-on-arrival and why the fix could not be deferred.

Two tests now hold the property:

- `mutation-gate-wiring` asserts the guard's derived suite list has four
  entries. A count, not a roster of filenames — this document records what a
  hardcoded filename costs — and converting any of them back to a runtime
  import fails it by name.
- `mutation-gate-bite` gained a per-guard block: the guard mutated alone with
  its suites intact must clear the committed floor, and with all but one suite
  withheld it must go red against that same floor. Withholding *every* suite
  does not weaken the gate, it stops it — Stryker's `vitest.related` filter
  finds nothing and exits with a `ConfigError` before computing a score — so
  one suite is kept, which reproduces the state this amendment describes.

The guard also joined `WITHHELD_GUARDS` in the whole-list bite. It was not added
to the mutate list; it was already there. But ~117 new kills land in **both**
the intact and the weakened run, which is precisely the erosion the
`WITHHELD_GUARDS` comment records — arriving from a raised target rather than a
new one.

### What is still not reached

Nothing here changes *What this cannot reach*. In particular the guard's own
central limitation is unchanged and untouched by this work: it cannot verify
that the environment an adapter reports is the environment it connected to. The
score says its tests can bite, not that the control is complete.

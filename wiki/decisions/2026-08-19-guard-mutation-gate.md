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
them today; a mechanical bite test for shell guards is unsolved and wants its own
work item.

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

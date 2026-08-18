# The e2e wiring contract

What an expo consumer's CI must look like so that "the e2e suites are green" is
the same claim in every repo, and so a person moving between repos finds the
same file doing the same job under the same name.

Defined **after** measuring, not before: four repos were read on 2026-08-18 and
no two wire e2e the same way. Only two files exist in all four — and **a shared
filename is not a shared file.** Both of those two differ in every repo that has
them. Read the next section before trusting this one.

## The measured starting point — presence only

```text
                            tunnl   gemini  propswap  gunnertech
maestro-e2e.yml               Y       Y        Y          Y
nightly-e2e-health.yml        Y       Y        Y          Y
--- everything below diverges ---
playwright-e2e.yml            -       Y        -          -
maestro-native-e2e.yml        -       -        -          Y   (never ran)
nightly-e2e-gate.yml          Y       -        -          -   (local fork)
nightly-e2e-report.yml        Y       -        Y          -
nightly-e2e-tracker.yml       Y       -        -          -   (skipped)
nightly-e2e-tracking-issue    -       Y        Y          -   (propswap never ran)
nightly-e2e-bypass-reaper     Y       Y        Y          -
parity-{gate,nightly,determ}  Y       -        -          -
e2e-mock-shapes.yml           Y       -        -          -
nightly-mutating-e2e.yml      -       -        Y          -
e2e-account-sweeper.yml       -       -        Y          -
e2e-inbox-access-check.yml    -       -        Y          -
```

## Why it drifted — measured at both layers, and neither converges

The table above is a **presence** census, and presence is the layer that works.
Content is the layer that doesn't, and a filename census cannot see it.

### Layer 1 — the caller workflow (`create-only`, and it forks permanently)

Lisa *does* ship expo callers. All six live in `expo/create-only/.github/workflows/`
and `expo/copy-overwrite/` holds **zero** workflow files. Read the strategy
rather than assuming what "create-only" means (`src/strategies/create-only.ts`):

```ts
// Create-only strategy: Create file if not exists, never update
//  - Create if not exists
//  - Skip silently if exists (whether identical or different)
await this.copyFileExclusive(sourcePath, destPath, constants.COPYFILE_EXCL);
```

So it creates whenever the file is **absent — on every apply, not just at
scaffold**, which is why presence spreads. And once present it is skipped
forever, *identical or not*, which is why content forks the moment it lands and
never comes back. Every consumer's copy is frozen at whatever Lisa shipped the
day that repo first applied, and every subsequent Lisa improvement reaches nobody.

Measured 2026-08-18 — each repo's copy vs Lisa's current template:

```text
                              tunnl        gemini       propswap     gunnertech
ci.yml                      +81/-35      +98/-40      +138/-37     +82/-36
deploy.yml                  +126/-41     +27/-63      +2/-3        +34/-64
maestro-e2e.yml             +201/-118    +160/-113    +109/-116    +105/-113
nightly-e2e-health.yml      +1/-1        +137/-112    +126/-147    +238/-149
nightly-e2e-bypass-reaper   +50/-13      IDENTICAL    +0/-3        absent
nightly-e2e-report.yml      IDENTICAL    absent       IDENTICAL    absent
```

**23 of 24 repo×file pairs are diverged or absent; 3 are identical.** The two
files that exist in all four repos are also the two nobody can update. And the
one file that is byte-identical wherever it exists — `nightly-e2e-report.yml` —
is the **newest**, added 2026-08-12. That is the mechanism proving itself: files
arrive clean and rot from the moment they land.

### Layer 2 — the reusable (`uses:`), which should converge and also doesn't

A caller's real job is to `uses:` a versioned reusable, and that layer *can*
converge because it resolves at run time. It doesn't:

```text
tunnl       maestro-e2e  -> maestro-native-e2e @main     health -> @v3.27.0
                                                          report -> @v2.345.1
gemini      maestro-e2e  -> maestro-native-e2e @main     health -> @v3.14.8
                            playwright-e2e -> quality @main
propswap    maestro-e2e  -> maestro-native-e2e @main     health -> FULLY LOCAL
                                                          report -> @v2.345.1
gunnertech  maestro-e2e  -> FULLY LOCAL                  health -> FULLY LOCAL
```

**Four of the eight health/maestro callers invoke no Lisa reusable at all** —
they are local reimplementations, which is the same defect as tunnl's
`nightly-e2e-gate.yml` fork (§4), just spread across three repos.
`gunnertech/frontend` is not a Lisa e2e consumer in any sense. The callers that
*do* delegate span **four different refs**, including `@v2.345.1` — where the
reusable does not exist at all, so that call can never load (Lisa #2702).

### What this means for the fix

**Do not simply flip these files to `copy-overwrite`.** They carry real local
content — tunnl's `maestro-e2e.yml` is 11,111 B against Lisa's 7,662 B — and
overwriting would destroy work in all four repos. The order that survives
contact with reality:

1. **Make every caller actually call a reusable.** The four local
   reimplementations are the real divergence; the caller's line count is a
   symptom.
2. **Put the logic in the reusable and pin one ref.** That layer converges by
   construction; the caller should be thin enough that freezing it is harmless.
3. **Only then move the thin caller to `copy-overwrite`.** Local extras move out
   to a separately-named workflow first (§5), never into the shared file.

## 1. Filenames are fixed, and name the SUITE

| file | calls | ref | lane | required when |
| --- | --- | --- | --- | --- |
| `.github/workflows/maestro-e2e.yml` | `…/maestro-native-e2e.yml` | `@main` | `create-only` → **must become `copy-overwrite`** | `.maestro/flows` exists |
| `.github/workflows/playwright-e2e.yml` | Lisa's Playwright surface | `@main` | not yet shipped | Playwright specs exist |
| `.github/workflows/nightly-e2e-health.yml` | `…/nightly-e2e-health.yml` | **immutable tag** | `create-only` → **must become `copy-overwrite`** | always |
| `.github/workflows/nightly-e2e-report.yml` | `…/nightly-e2e-report.yml` | **immutable tag** | `create-only` → **must become `copy-overwrite`** | always |

Two columns carry rules, not description:

**`ref`.** A workflow that *gates a merge* pins an **immutable tag or SHA**, never `@main` — what decides whether code may merge must not change under you between two runs of the same pull request. That covers `nightly-e2e-health` and `nightly-e2e-report`. A suite workflow that only *runs* may track `@main`. Lisa's own integration suites enforce this, and the pin must name a ref where the reusable actually exists — see #2702, where two templates shipped pinned to a version predating the file they call and therefore could never load.

**`lane`.** Stated per file because it decides whether the row is enforced or aspirational (§4a). Every row above currently ships `create-only`, which is why none of them converge; the migration to `copy-overwrite` is the work, and until it happens this table describes an intent rather than a guarantee.

The caller is named for the **suite** (`maestro-e2e`), never for the reusable
workflow it calls (`maestro-native-e2e`). A repo carrying both names carries a
duplicate.

**Forbidden:** two callers for one suite; two jobs reporting the same **check
name** across different workflows.

The rule is about the reported check identity, not the workflow-level `name:`.
Branch protection keys on the check name a job reports, and a reusable call
reports it as `<workflow name> / <reusable job name>`. So a workflow-level
collision is neither necessary nor sufficient for a real one.

Measured on a live PR rather than assumed — tunnl's two files share a workflow
`name:` and report **distinct** checks:

```text
🌙 Nightly E2E Health            <- the hand-written fork (§4)
🌙 Nightly E2E Health / 🌙 Gate  <- the Lisa caller
```

They are separately addressable, so neither can satisfy the other's requirement.
An earlier draft of this document claimed the opposite. The reason to retire the
fork is **duplicated implementation**, not context ambiguity — a weaker argument
than the one first written, and the correct one.

## 2. Playwright gets its own workflow, and both e2e gates are DECLARED

Owner ruling: gemini's shape — Playwright in its own `playwright-e2e.yml` — is
the standard, and it must be configurable through `.lisa.config.json` exactly as
the other test surfaces are.

**The mechanism already exists and no repo uses it.** Lisa's gate registry
declares both:

| gate | task | moments |
| --- | --- | --- |
| `e2e-browser` | `test:e2e` | `PR_ONWARD`, `CONTINUOUS` |
| `e2e-native` | `test:e2e:native` | `PR_ONWARD`, `CONTINUOUS` |

Measured 2026-08-18: **zero of four repos declare either.** Two declare
`test-node-suites` and nothing else.

So a conforming repo declares what it has:

```jsonc
"gates": {
  "e2e-browser": { "pull-request": "required" },   // has Playwright specs
  "e2e-native":  { "pull-request": "required" }    // has .maestro/flows
}
```

and exposes the matching `test:e2e` / `test:e2e:native` scripts.

**When a suite is absent, OMIT its gate — do not declare it `off`, and do not
point it at a no-op script.** A repo with no `.maestro/flows` declares no
`e2e-native`, and conformance checks that the declared set equals the present
set, in both directions:

| suite present | gate declared | verdict |
| --- | --- | --- |
| yes | yes | conforms |
| no | no | conforms |
| yes | no | **fails** — a suite nobody gates |
| no | yes | **fails** — a gate with nothing to run |

Both failing rows matter, and the last one is why `off` and no-op scripts are
forbidden rather than merely discouraged: each produces a green check that ran
nothing, which is indistinguishable on the PR page from a green check that ran
the suite and passed. Omission is auditable; a satisfied-but-empty gate is not.

**PREREQUISITE, not optional.** A declared gate is resolved by
`lisa-gates.mjs`, which ships from Lisa **3.17.0**. A repo pinned below that
declares a gate no resolver can find, and the gate passes having verified
nothing. Measured pins on 2026-08-18: tunnl `3.27.0` ok, propswap `^3.23.0` ok,
**gemini `3.14.8` and gunnertech `3.14.8` cannot resolve**. Declaring an e2e
gate in those two before their pin moves produces a green check that means
nothing — the exact defect this contract exists to prevent, delivered by the
fix for it. **Move the pin first.**

## 3. Trigger shape is declared, not incidental

```yaml
on:
  schedule: [{ cron: "<offset per repo, reason stated inline>" }]
  workflow_dispatch:
    inputs: { platform: { type: choice, options: [all, android, ios] } }
```

**Permitted triggers, exhaustively.** A suite workflow declares `schedule` and
`workflow_dispatch`, and nothing else. It does **not** declare `pull_request`,
`push`, or `workflow_run`. A caller carrying any other trigger is non-conforming.

**What `PR_ONWARD` means for an e2e gate — it does not run the suite.** The
`e2e-browser` / `e2e-native` gates at `PR_ONWARD` (§2) **read last night's
recorded result**; they never execute flows on the pull request. Running a full
native suite per PR is the thing this shape exists to avoid. So the gate is fast
and its verdict is about the *nightly*, which is why §2's freshness and
completeness rules carry the weight — a stale or narrowed nightly is the only
way this gate can lie.

**Cron offsets carry a machine-parseable reason.** Suites sharing a backend must
not collide, and a bare cron cannot be distinguished from an unconsidered
default. The reason sits on the line above the cron in exactly this form:

```text
# nightly-offset: <reason>   e.g.
# nightly-offset: +90m after propswap; shared staging backend, avoids fixture collision
- cron: "30 4 * * *"
```

Grammar: a comment line matching `^#\s*nightly-offset:\s*\S.*$` immediately
preceding the `cron:` entry. Conformance parses it (§7) — a cron with no
preceding `nightly-offset:` line fails, and so does one whose reason is empty.

## 4. Two files are deleted; one is a FORK to retire carefully

| file | evidence | disposition |
| --- | --- | --- |
| `gunnertech/maestro-native-e2e.yml` | `workflow_call`, **never ran**, duplicate of that repo's own `maestro-e2e.yml` | delete |
| `propswap/nightly-e2e-tracking-issue.yml` | `workflow_call`, **never ran** — reusable with no caller | delete |
| `tunnl/nightly-e2e-gate.yml` | a hand-written **fork of the gate**, declaring `name: 🌙 Nightly E2E Health` — the same check name as that repo's Lisa caller | retire only after moving its tracker integration |

**The third is not a dead file and must not be deleted outright.** Measured:
`nightly-e2e-health.yml` is a thin caller of
`CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@v3.27.0`, while
`nightly-e2e-gate.yml` is a local reimplementation with its own guard assertions
that also drives the `nightly-e2e-tracker` integration. Deleting it would remove
a mechanism people demonstrably use (§6).

The shared workflow `name:` turns out **not** to be dangerous: measured on a
live PR, the two report distinct check names and cannot satisfy each other (§1).
So the case for retiring the fork rests on duplicated implementation alone —
two gates to keep correct, one of which no longer receives Lisa's fixes. Retire
it, but move what only it does first.

**And tunnl is not alone.** The same defect — a local reimplementation where a
`uses:` should be — appears in `propswap/nightly-e2e-health.yml` and in *both*
of gunnertech's e2e workflows. Four forks across three repos, of which tunnl's
is merely the one visible from a filename census because it also collides on
`name:`. Retiring the fork is a portfolio-wide item, not a tunnl cleanup.

## 4a. Every file this contract names states its delivery lane

| lane | behaviour | converges? |
| --- | --- | --- |
| `copy-overwrite` | rewritten on every `lisa apply` | **yes** — drift is corrected automatically |
| `create-only` | created when absent on any apply; skipped forever once present, identical or not | **presence only** — content forks on landing and never returns |
| `uses:` reusable | resolved at run time from the ref the caller names | **yes, if the caller delegates and the ref is shared** |

A file's lane is not a packaging detail — it decides whether a rule in this
document is enforced or merely aspirational. An entry with no stated lane is
incomplete.

The distribution of `nightly-e2e-report.yml` is the worked example: the two
repos that have it did not *choose* it and the two without did not *decline* it.
It was added on 2026-08-12, and presence tracks nothing but whether a repo has
applied since. No amount of consumer discipline changes that.

## 5. Project-specific extras STAY project-specific

Owner ruling: none of these get standardized, and none get upstreamed.

```text
tunnl      parity-gate.yml  parity-nightly.yml  parity-determinism.yml
           e2e-mock-shapes.yml
propswap   nightly-mutating-e2e.yml  e2e-account-sweeper.yml
           e2e-inbox-access-check.yml
```

They carry a machine-parseable declaration on the line after `name:`, in exactly
this form:

```text
# e2e-local: <reason>   e.g.
# e2e-local: propswap-only; sweeps abandoned e2e accounts against the shared GIDX sandbox
```

Grammar: `^#\s*e2e-local:\s*\S.*$`. Conformance (§7) requires it on every
workflow whose filename is not in §1's table, and fails on an empty reason.

**An undeclared extra is drift; a declared one is a decision** — and the marker
is what makes that distinction checkable rather than a matter of opinion. It
also gives the next person reading an unfamiliar workflow the one thing they
actually need: why it is here and not in Lisa.

## 6. The tracking issue EARNS its place — measured, and it belongs in Lisa

I hypothesised this job was dead because two of three workflow implementations
never execute. **That was wrong, and the workflow-level view is what made it
look wrong.** Measured across all four repos:

```text
TunnlAI/frontend      3 issues   #462 CLOSED (9 comments), #545 CLOSED, #604 OPEN
PropSwapLLC/frontend  7 issues   #906 CLOSED (8), #917 OPEN (5), #918/#954 CLOSED
geminisportsai/fe-v2  4 issues   #6587 CLOSED (6), #6531 CLOSED (5), #6514 CLOSED (5), #6621 OPEN
gunnertech/frontend   1 issue    #385 CLOSED
```

Authored by `app/github-actions`, marked `<!-- nightly-e2e-tracker -->`, and
they **auto-close on green** — gunnertech#385's closing comment: *"Both nightly
e2e suites are green as of 2026-08-14… Closing."* One issue per suite, opens on
red, accumulates human comments, closes itself. Five-to-nine-comment threads are
engagement, not noise.

**And the implementation is in a different place in every repo**, which is why a
workflow-name sweep mis-read it:

```text
tunnl       .github/workflows/nightly-e2e-gate.yml  +  nightly-e2e-tracker.yml
gemini      scripts/report-nightly-e2e.mjs          (no workflow carries it)
propswap    neither — yet has 7 issues
gunnertech  neither — yet has 1 issue
```

Two repos file tracking issues with **no local implementation at all**, so part
of this already comes from Lisa. That settles the design question: the function
is wanted, it works, and it belongs in Lisa as one reusable rather than as four
divergent local answers plus two invisible ones.

**Do not standardize the NAME before consolidating the implementation.** Naming
is the last step, not the first.

## 7. Conformance is checkable, or this is decoration

Machine-checkable from the repo tree alone:

| check | rule |
| --- | --- |
| filenames | present per §1, one caller per suite |
| `uses:` target | matches §1, and the reusable **exists at the named ref** |
| ref shape | merge-gating callers pin an immutable tag/SHA, never `@main` |
| delivery lane | every §1 file's lane is declared and matches what Lisa ships |
| trigger block | `schedule` + `workflow_dispatch` only; no other trigger |
| cron reason | `^#\s*nightly-offset:\s*\S.*$` immediately precedes each `cron:` |
| declared gates | the declared set **equals** the set of suites present, both directions (§2) |
| local extras | every non-§1 workflow carries `^#\s*e2e-local:\s*\S.*$` |
| check identity | no two jobs across workflows report the same check name (§1) |

The check **fails on an unreadable repo** rather than skipping it, and **fails
on an empty workflows directory** — zero files found is a discovery failure, not
conformance. That rule is here because a check that cannot find its subject
reporting success is the defect class this portfolio hit repeatedly on the day
this was written.

## What this does not cover

Suite CONTENT — which flows exist, what they assert, whether they pass. A repo
can conform perfectly and have a red suite. This makes "green" mean the same
thing everywhere; it does not make anything green.

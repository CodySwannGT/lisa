# The e2e wiring contract

What an expo consumer's CI must look like so that "the e2e suites are green" is
the same claim in every repo, and so a person moving between repos finds the
same file doing the same job under the same name.

Defined **after** measuring, not before: four repos were read on 2026-08-18 and
no two wire e2e the same way. Only two files exist in all four.

## The measured starting point

```
                            tunnl   gemini  propswap  gunnertech
maestro-e2e.yml               Y       Y        Y          Y
nightly-e2e-health.yml        Y       Y        Y          Y
--- everything below diverges ---
playwright-e2e.yml            -       Y        -          -
maestro-native-e2e.yml        -       -        -          Y   (never ran)
nightly-e2e-gate.yml          Y       -        -          -   (duplicate name)
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

## Why it drifted — and why blaming the consumers is wrong

Lisa ships the reusable workflows but **not the callers**:

```
REUSABLE, called via uses:   maestro-native-e2e.yml   nightly-e2e-health.yml
                             nightly-e2e-report.yml   quality.yml
COPY-OVERWRITE scripts       check-nightly-e2e-health.mjs  check-e2e-coverage.mjs
                             classify-maestro-failures.mjs
                             nightly-e2e-suites.schema.json
CALLER workflows for expo    NONE
```

`harper-fabric` and `phaser` each receive a `ci.yml` through copy-overwrite;
`expo` receives none. Every expo consumer hand-authors its caller, four
hand-authored files drifted into four shapes, and nothing could detect it
because no declared shape existed. **This contract is that declaration.**

## 1. Filenames are fixed, and name the SUITE

| file | calls | required when |
| --- | --- | --- |
| `.github/workflows/maestro-e2e.yml` | `…/maestro-native-e2e.yml@main` | `.maestro/flows` exists |
| `.github/workflows/playwright-e2e.yml` | Lisa's Playwright surface | Playwright specs exist |
| `.github/workflows/nightly-e2e-health.yml` | `…/nightly-e2e-health.yml@main` | always |

The caller is named for the **suite** (`maestro-e2e`), never for the reusable
workflow it calls (`maestro-native-e2e`). A repo carrying both names carries a
duplicate.

**Forbidden:** two callers for one suite; two workflow files declaring the same
`name:` (that is how a required context gets satisfied by the wrong workflow —
measured in one repo today).

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

e2e suites are nightly + dispatch; they do not gate PRs directly. The **nightly
health gate** is what gates PRs, reading last night's result. Crons are offset
per repo so suites sharing a backend do not collide, and the offset states its
reason inline — a bare cron cannot be distinguished from an unconsidered
default.

## 4. Three files are DELETED, not harmonised

Owner ruling: these are dead, and a dead file does not get a standard name.

| file | evidence |
| --- | --- |
| `gunnertech/maestro-native-e2e.yml` | `workflow_call`, **never ran**, duplicate of that repo's own `maestro-e2e.yml` |
| `propswap/nightly-e2e-tracking-issue.yml` | `workflow_call`, **never ran** — a reusable workflow with no caller |
| `tunnl/nightly-e2e-gate.yml` | declares `name: 🌙 Nightly E2E Health` — **the same check name as that repo's `nightly-e2e-health.yml`** |

The last is the dangerous one. Two files producing one check name means a
required context can be satisfied by whichever ran, and nothing on the PR page
distinguishes them.

## 5. Project-specific extras STAY project-specific

Owner ruling: none of these get standardized, and none get upstreamed.

```
tunnl      parity-gate.yml  parity-nightly.yml  parity-determinism.yml
           e2e-mock-shapes.yml
propswap   nightly-mutating-e2e.yml  e2e-account-sweeper.yml
           e2e-inbox-access-check.yml
```

They carry an inline comment naming why they are project-specific. An undeclared
extra is drift; a declared one is a decision.

## 6. OPEN — not yet ruled

- **`nightly-e2e-report.yml`** — tunnl and propswap have it, gemini and
  gunnertech do not. Lisa ships a reusable version. Whether the two adopters
  chose it or inherited it, and whether anything reads its output, is being
  measured.
- **`nightly-e2e-tracker` / `-tracking-issue`** — same job, three hand-written
  implementations, none calling Lisa, two names. tunnl's is `skipped`,
  propswap's has **never run**, gemini's runs and fails. The question is not
  which name wins but whether the function earns its place; if it does, it
  belongs in Lisa as a reusable rather than three local copies.

Neither is standardized until measured. A harmonised name for a job that has
never done anything is worse than no entry at all.

## 7. Conformance is checkable, or this is decoration

Machine-checkable from the repo tree alone: filenames present, each caller's
`uses:` target, the trigger block, declared gates versus suites actually
present, and whether every extra carries a declaration comment.

The check **fails on an unreadable repo** rather than skipping it, and **fails
on an empty workflows directory** — zero files found is a discovery failure, not
conformance. That rule is here because a check that cannot find its subject
reporting success is the defect class this portfolio hit repeatedly on the day
this was written.

## What this does not cover

Suite CONTENT — which flows exist, what they assert, whether they pass. A repo
can conform perfectly and have a red suite. This makes "green" mean the same
thing everywhere; it does not make anything green.

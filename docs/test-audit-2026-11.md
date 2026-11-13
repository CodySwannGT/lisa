# Test cost audit, November 2026

Audit for CodySwannGT/lisa#4615 (Spike F1 under epic #4582). It answers one
question: which of the heaviest test files cost a lot and add little? It
recommends; it deletes nothing. The follow-up, CodySwannGT/lisa#4616, acts on
it.

The per-row data behind every table here is committed beside this page as
[`test-audit-2026-11.data.json`](test-audit-2026-11.data.json).

## Answer in brief

- **Nothing in the audited set qualifies for deletion.** Of the files with a
  measured value, every one either kills at least one mutant that no other
  file kills, or (six work-item suites) shows zero unique kills only
  inside a 10% sample, which proves nothing. Files that drive their subject
  through a child process or a shell script cannot be credited by Stryker, so
  the issue's own rule forbids deleting them on that basis. The remaining
  in-process files were not reached by either mutation run.
- **Most heavy test time cannot be valued by mutation at all.** Of the 2459s the 272 audited files cost, 1820s (74%, 196 files) is in files Stryker cannot credit with a kill. 463s (19%, 57 files) is in-process code that neither mutation run reached. Only 175s (7%, 19 files) has a measured value. Unique-kill evidence can retire very little of the heavy set, so the cuts have to come from slimming.
- **The savings are in slimming, not deleting.** The largest are:
  - a cluster of work-item proof suites that drive the work-item CLI as a
    child process, although an in-process harness for the same CLI already
    exists;
  - six files where one test sits out a fixed production deadline (15 to 30
    seconds) of wall clock;
  - three integration files that run real external tools (the pinned history
    scanner, and a real Stryker run). Whether those belong on every pull
    request is a decision for the owner.
- **A product defect turned up along the way.** `lisa-lint-staged-preflight.mjs`
  passes `timeout: 15_000` to `spawn`. When a tool cannot start (a missing or an unrunnable executable), Node keeps that timer referenced, so the preflight process stays
  alive for the full 15 seconds after it has already decided. A bare
  `node -e` reproduction takes 15.02s. A host whose pre-commit tool is broken
  waits 15 seconds per broken tool before the refusal prints. Three unit cases
  pay the same 15 seconds each, which is 45 of that file's 45.4 seconds.

### Projected time saved, by recommendation

Seconds are summed per-file test time from the local measured run (see
Method), not CI wall clock. Wall clock falls by less than this, because files
run in parallel.

| Recommendation | Unit files | Unit seconds | Integration files | Integration seconds | Projected saving (s) |
|---|---:|---:|---:|---:|---:|
| delete | 0 | 0 | 0 | 0 | 0 |
| slim | 23 | 493 | 2 | 62 | 422 |
| move to on-demand | 0 | 0 | 3 | 224 | 224 |
| keep | 165 | 837 | 63 | 471 | 0 |
| out of scope (S-C) | 12 | 347 | 4 | 25 | 0 |

How each saving is projected:

- **slim (deadline wait):** the slowest test's time minus one second, which
  assumes the deadline becomes injectable and the kill assertion stays.
- **slim (work-item proof suites):** the file's time minus its test count
  times 0.36s. 0.36s per test is the slowest measured per-test rate among the
  existing in-process `work-item-cli-*` suites (`work-item-cli-trackers`); the
  pooled rate across all eight is 0.12s. This is an estimate until #4616
  converts one suite and measures it.
- **slim (Jest shard reports):** 60% of the file, assuming one shared whole
  run and shard pair replaces ten. This is an estimate.
- **move to on-demand:** the whole file leaves the pull-request path.

## Method

### Cost

- **One measured run per scope**, on 2026-11-13, at commit `95e64c76ff` (the
  `feat/4582-fast-push` integration branch), on an 18-core macOS machine
  shared with other agents (1-minute load average 6 to 10 during the runs).
  No CI timing artifacts existed yet to read instead.
- Both runs set `CI=1`, so the per-file timing reporter (#4592) wrote
  `tmp/test-timings/<scope>.json`. They also set `LISA_ACCESS_MAP=1`, so the
  test access map tracer (#4593) wrote `tmp/test-access-map/<scope>.json`,
  exactly as the CI jobs do. The tables were produced with
  `node scripts/test-timing-report.mjs --dir <artifacts> --json`.
- Unit: `bun run test:unit`, 1,686 files, 29,948 tests, 1,938.2s summed file
  time, 300.9s wall. The top 200 files are 86.6% of unit time. CI run
  41330364793, which the issue cites, measured 89%.
- Integration: `bun run test:integration`, 269 files, 4,241 tests, 867.4s
  summed file time, 280.1s wall. 72 files make up 90.0% of integration time.
  That script already excludes the packed-host journey
  (`shared-runtime-packed-hosts.test.ts`), which D3 (#4606) is moving to
  on-demand. In CI run 41330364793 that one file was 880s of 1,538s.
- File time is Vitest's span from a file's first test start to its last test
  end, the same definition the timing report uses.
- `CI=1` turns a missing local runtime into a failure instead of a deferral,
  so some files failed fast. In the unit run, five files had 48 failing tests:
  four `npm-update-*` files needed a pinned updater Node the machine lacked,
  and one `check-shell-guard-refusal-coverage` case failed (not investigated). In the
  integration run, `npm-update-dual-lock` and `rails-helper-test-isolation`
  failed for the same reason (Ruby activerecord was missing). Those files'
  times are therefore understated. None of them is in the slim, move or
  delete rows.

### Value: unique mutation kills

- **Definition, from the issue:** a mutant is uniquely killed by a test file
  when every test that kills it belongs to that file. A file with zero unique
  kills adds no protection that mutation testing can detect.
- **Runs:** Stryker 9.6.1 with the repository's own `stryker.conf.json`
  (Vitest runner, `coverageAnalysis: "perTest"`, concurrency 4), launched
  through `lisa-test-run` the way `test:mutation` launches it. `--mutate` and
  `--reporters json,clear-text,progress` were passed on the command line, and
  `MUTATION_SCOPE` narrowed the test set to the suites that reach the mutated
  guard. `stryker.conf.json` was not edited. Attribution comes from each
  mutant's `killedBy` in the JSON report.
- **`--disableBail` is required, and the issue's recipe omits it.** By default
  Stryker stops a mutant's run at the first failing test, so `killedBy` names
  one test and every kill looks unique. The first run of M1 without the flag
  reported unique kills equal to total kills for every file, which is that
  artefact. Both runs below used `--disableBail`.
- **M1, `typescript/copy-overwrite/scripts/lisa-mutation.mjs`, whole file:**
  1546 mutants, 1012 killed, 6 timed out. All seven suites that reach the guard have unique kills: `lisa-mutation-gate.test.ts` 504, `lisa-mutation-timeout-accounting.test.ts` 74, `mutation-gate-wiring.test.ts` 16, `mutation-gate-shell-evidence.test.ts` 16, `lisa-mutation-sandbox.test.ts` 14, `lisa-mutation-renames.test.ts` 5, `vendored-script-defects.test.ts` 3. None of them is a deletion candidate.
- **M2, `all/copy-overwrite/scripts/lisa-work-item.mjs`, a sample:** the file
  is 7,240 lines and 73 suites reach it, so it was sampled. Five 150-line
  windows at a fixed stride were mutated (lines 600-750, 2000-2150,
  3400-3550, 4800-4950 and 6200-6350). 616 mutants, 432 killed, 2 timed out. 16 suites have unique kills in the sample. 36 suites reach the guard by import but covered no mutant. These include every work-item proof suite that drives the CLI through `proofCli`, which confirms the blind spot by measurement rather than by reading the code. 20 in-process suites killed mutants, but none uniquely, in the sample: `work-item-lifecycle-reconciliation.test.ts`, `work-item-merge-base-completion.test.ts`, `work-item-amended-merge-exemption.test.ts`, `work-item-comment-projection.test.ts`, `work-item-cli-pull-request.test.ts`, `work-item-back-merge-exemption.test.ts`, `work-item-push-promote-exemption.test.ts`, `work-item-authored-trailers.test.ts`, `work-item-cli-binding.test.ts`, `work-item-gate-scope-advice.test.ts`, `work-item-session-url.test.ts`, `work-item-unreachable-ancestry.test.ts`, `work-item-evidence-release-cli.test.ts`, `work-item-cli-acli-isolation.test.ts`, `work-item-jira-backlink-adf.test.ts`, `work-item-contract-version.test.ts`, `npm-update-gate-proof.test.ts`, `work-item-trailer-definition.test.ts`, `npm-update-backlink-pagination.test.ts`, `npm-update-gh-requests.test.ts`. Kills in a sample are a lower
  bound. A file with at least one unique kill in the sample is proven to add
  protection. Zero in the sample proves nothing.
- **Blind spot, from the issue:** Stryker activates a mutant inside the test's
  own process, so a test that drives the code under test as a separate
  process can never be credited with a kill. Such rows say "not measurable",
  never zero, and are never recommended for deletion. The same holds for
  shell scripts, which Stryker cannot instrument at all (no shell parser; see
  the `stryker.conf.json` comment), and for every integration suite, which
  the mutation Vitest config excludes by design because they drive real
  subprocesses.
- **How "drive" was decided for rows the mutation runs did not reach:** a
  static scan of the test file and its directly imported `tests/` helpers for
  spawn calls (`spawnSync`, `boundedSpawnSync`, `execFile` and similar), and
  for imports of repository modules. "process" means it spawns and imports no
  module under test; "mixed" means both. This is a heuristic. The mutation
  runs override it wherever they reached a file. Example: the
  `work-item-cli-*` suites spawn `git` to build fixtures but run the CLI
  in-process.

### Categories

- **guard-of-guards:** tests of test infrastructure (the test runner, the
  latency budget, the mutation gate, coverage wiring, admission, the gate
  runner and push plumbing).
- **duplicate journeys:** the same journey run more than once, for example
  once per agent-specific copy, once per route, or once per platform arm.
- **prose checks:** tests whose subject is Markdown content.
- **real-process tests that could run in-process:** a child process is used
  where an in-process seam exists or could exist.
- **other**, refined where it helps: *deadline wait* (one test sits out a
  fixed timer), *shell guard* (the subject is a shell or Python guard, so
  there is no in-process route), *repo-wide scan*, *real vendor binary*, and
  *real CLI or workflow step*.

| Category | Files | Seconds |
|---|---:|---:|
| S-C scope | 16 | 372 |
| duplicate journeys | 22 | 176 |
| guard-of-guards | 30 | 261 |
| other | 41 | 218 |
| other: deadline wait | 6 | 206 |
| other: real CLI or workflow step | 70 | 364 |
| other: real vendor binary | 3 | 188 |
| other: repo-wide scan | 5 | 42 |
| other: shell guard | 58 | 302 |
| prose checks | 2 | 8 |
| real-process tests that could run in-process | 19 | 324 |

### Unique-kill values across the audited rows

| Unique-kill value | Files | Seconds |
|---|---:|---:|
| measured | 19 | 175 |
| not measurable (child process) | 54 | 438 |
| not measurable (child process: covered no lisa-work-item.mjs mutant in M2) | 18 | 357 |
| not measurable (integration) | 72 | 781 |
| not measurable (shell) | 52 | 245 |
| not measured (timebox) | 57 | 463 |

### What was excluded, and why

- **The temp-folder and stray-process policing machinery (S-C, #4586).** Out
  of scope by the issue. These rows are listed with "out of scope (S-C)" and
  carry no recommendation. They match `scratch`, `tmpdir-growth`,
  `test-run-supervision`, `cleanup-sweep`, `reclaim` or `fleet-admission`.
- **The Markdown wording cull (#4867), already merged.** Its classification
  (`tests/phrase-manifest/classification/test-assertions.json`) lists the 153
  test files it edited. None of them is among the 272 audited files, so there
  was nothing to exclude. The two prose-check rows below hold no WORDING
  site.
- **The packed-host journey.** Excluded from `test:integration`, and handled
  by D3 (#4606).

### Where the timebox stopped

Every file in the issue's scope has a row: the top 200 unit files and the 72
integration files that make up 90% of integration time. What the time ran out
for is the mutation **value** measurement:

- Two Stryker runs were made: M1 (the whole of `lisa-mutation.mjs`) and M2 (a
  roughly 10% sample of `lisa-work-item.mjs`).
- "not measured (timebox)" marks in-process or mixed files whose modules
  neither run mutated. None of them is recommended for deletion.
- Stryker cost on this machine: M1 took 19 minutes for 1,546 mutants with
  `--disableBail`. M2 took 42 minutes for 616 mutants, because many of the 73 reaching suites cover each mutant. Mutating the whole of `lisa-work-item.mjs` the same way would take about 7 hours (616 mutants per 750 lines, scaled to 7,240 lines), which is beyond this timebox and is the first thing #4616 should run before it deletes any work-item suite.

## Judgment calls for the owner

These rows depend on a value judgment, not on a measurement:

- `tests/unit/scripts/work-item-proof-denials.test.ts` (46.4s): **slim**. every denial runs twice, once per route (direct, applying sweep), each through a spawned CLI; drives `scripts/lisa-work-item.mjs` as a child through `proofCli`; the in-process `cli()` harness in tests/support/work-item-cli.ts already exists
- `tests/unit/scripts/work-item-lifecycle-reconciliation.test.ts` (25.6s): **keep**. runs the CLI in-process (`cli()`), not as a child; ~1.9s per case comes from building an accepted-proof fixture per case. 41 kills in the M2 sample but none unique. A sample zero is not evidence, so measure the whole file in #4616 before considering deletion; a shared fixture is the cheaper first step
- `tests/unit/scripts/work-item-stacked-push.test.ts` (16.3s): **keep**. runs each case through the native stdin entrypoint AND in-process (its own header); the pair is deliberate
- `tests/integration/history-secret-evidence.test.ts` (96.6s): **move to on-demand**. drives the genuine pinned history scanner (11.1% of integration time); the only proof against vendor behaviour, so the question is whether every PR must pay for it or only PRs touching the history-secret code
- `tests/integration/history-secret-private-report.test.ts` (80.8s): **move to on-demand**. same genuine scanner; two cases are 17.6s and 14.6s
- `tests/integration/mutation-gate-bite.test.ts` (46.2s): **move to on-demand**. proves the production mutation config bites (real Stryker, 30.2s + 16.1s); already excluded from `test:integration:push`. The cheaper diff-bite suite (4.2s) stays in the PR path
- `tests/integration/quality-unit-progress.test.ts` (31.8s): **slim**. one case waits for the real 30-second production progress timer (31.5s of 31.8s); its header says the real timer is the point, so injecting a shorter one is an owner call
- `tests/integration/lisa-test-run-jest-shards-reports.test.ts` (29.7s): **slim**. every case runs a whole Jest run plus two shards (~3s each, 10 cases); one shared whole+merged pair with every reporter would serve most cases, but some vary reporter options
- `tests/integration/history-secret-scanner-path.test.ts` (10.3s): **keep**. same genuine scanner as history-secret-evidence; decide together with it
- The in-process work-item suites with zero unique kills in the M2 sample (`work-item-lifecycle-reconciliation.test.ts`, `work-item-merge-base-completion.test.ts`, `work-item-amended-merge-exemption.test.ts`, `work-item-comment-projection.test.ts`, `work-item-cli-pull-request.test.ts`, `work-item-back-merge-exemption.test.ts`): **keep for now**. A sample cannot prove a zero, so #4616 should mutate the whole guard first. They are cheap (1.8s to 4.1s each), except work-item-lifecycle-reconciliation (25.6s).
- All agent-parity rows (category "duplicate journeys"): **keep**. Each agent's copy of a guard is proven separately on purpose (the parity rule in AGENTS.md). Sampling one copy per change is possible, but it is a policy change, not an audit finding.

## Unit files (top 200 by time)

| # | File | Seconds | Tests | Unique mutation kills | Category | Recommendation | Note |
|---:|---|---:|---:|---|---|---|---|
| 1 | `tests/unit/config/scratch-leak-guard.test.ts` | 88.6 | 15 | not measurable (child process) | S-C scope | out of scope (S-C) |  |
| 2 | `tests/unit/scripts/automation-provenance.test.ts` | 67.1 | 66 | not measurable (child process: covered no lisa-work-item.mjs mutant in M2) | other: deadline wait | slim | `refuses a hung live canonical resolver` waits out a fixed 30s production deadline (30.7s of 67.1s); make the deadline injectable and keep the kill assertion |
| 3 | `tests/unit/scripts/measure-tmpdir-growth-performance.test.ts` | 53.5 | 1 | not measurable (child process) | S-C scope | out of scope (S-C) |  |
| 4 | `tests/unit/config/scratch-authority-concurrency.test.ts` | 50.0 | 17 | not measured (timebox) | S-C scope | out of scope (S-C) |  |
| 5 | `tests/unit/scripts/work-item-proof-denials.test.ts` | 46.4 | 50 | not measurable (child process: covered no lisa-work-item.mjs mutant in M2) | duplicate journeys | slim (judgment) | every denial runs twice, once per route (direct, applying sweep), each through a spawned CLI; drives `scripts/lisa-work-item.mjs` as a child through `proofCli`; the in-process `cli()` harness in tests/support/work-item-cli.ts already exists |
| 6 | `tests/unit/scripts/lint-staged-preflight.test.ts` | 45.4 | 31 | not measured (timebox) | other: deadline wait | slim | three refusal cases take exactly 15.0s each: `spawn(..., { timeout: 15_000 })` keeps a referenced timer alive after a spawn error, so the CLI lingers for the full PROBE_TIMEOUT_MS (reproduced in a bare node one-liner: 15.02s). A product latency defect on the refusal path; fixing it removes ~44s here with no assertion change |
| 7 | `tests/unit/config/test-run-supervision-wiring.test.ts` | 41.8 | 5 | not measurable (child process) | S-C scope | out of scope (S-C) |  |
| 8 | `tests/unit/config/cdk-scratch-lifecycle.test.ts` | 35.1 | 12 | not measured (timebox) | S-C scope | out of scope (S-C) |  |
| 9 | `tests/unit/scripts/lisa-work-item.test.ts` | 35.1 | 176 | 0 unique of 0 kills, 2 covered (M2: lisa-work-item.mjs, 10% sample) | real-process tests that could run in-process | keep | the subprocess suite the in-process harness was built beside; its header says the subprocess cases stay (signal handling is only provable in a child) |
| 10 | `tests/unit/scripts/work-item-proof-publish-retry.test.ts` | 32.8 | 8 | not measurable (child process: covered no lisa-work-item.mjs mutant in M2) | real-process tests that could run in-process | slim | drives `scripts/lisa-work-item.mjs` as a child through `proofCli`; the in-process `cli()` harness in tests/support/work-item-cli.ts already exists |
| 11 | `tests/unit/config/scratch-owner.test.ts` | 30.7 | 19 | not measured (timebox) | S-C scope | out of scope (S-C) |  |
| 12 | `tests/unit/scripts/github-attestation-verifier.test.ts` | 30.5 | 52 | not measured (timebox) | other: deadline wait | slim | `kills an actual nonterminating verifier` waits out the verifier's fixed 30s `timeout` (30.0s of 30.5s); make it injectable |
| 13 | `tests/unit/scripts/work-item-lifecycle-reconciliation.test.ts` | 25.6 | 14 | 0 unique of 41 kills, 67 covered (M2: lisa-work-item.mjs, 10% sample) | other | keep (judgment) | runs the CLI in-process (`cli()`), not as a child; ~1.9s per case comes from building an accepted-proof fixture per case. 41 kills in the M2 sample but none unique. A sample zero is not evidence, so measure the whole file in #4616 before considering deletion; a shared fixture is the cheaper first step |
| 14 | `tests/unit/scripts/work-item-proof-evidence-release.test.ts` | 25.4 | 23 | not measurable (child process: covered no lisa-work-item.mjs mutant in M2) | real-process tests that could run in-process | slim | drives `scripts/lisa-work-item.mjs` as a child through `proofCli`; the in-process `cli()` harness in tests/support/work-item-cli.ts already exists |
| 15 | `tests/unit/scripts/work-item-proof-codepipeline.test.ts` | 25.0 | 21 | not measurable (child process: covered no lisa-work-item.mjs mutant in M2) | real-process tests that could run in-process | slim | drives `scripts/lisa-work-item.mjs` as a child through `proofCli`; the in-process `cli()` harness in tests/support/work-item-cli.ts already exists |
| 16 | `tests/unit/scripts/process-tree-runner.test.ts` | 23.2 | 61 | not measured (timebox) | other | keep | the subject IS process reaping; 61 cases, none over 1.7s |
| 17 | `tests/unit/scripts/work-item-proof-trust.test.ts` | 22.6 | 11 | not measurable (child process: covered no lisa-work-item.mjs mutant in M2) | real-process tests that could run in-process | slim | drives `scripts/lisa-work-item.mjs` as a child through `proofCli`; the in-process `cli()` harness in tests/support/work-item-cli.ts already exists |
| 18 | `tests/unit/scripts/npm-update-runtime-qualification.test.ts` | 21.8 | 21 | not measured (timebox) | other: deadline wait | slim | two cases bound a real hanging child at ~10.1s each (20.2s of 21.8s) |
| 19 | `tests/unit/scripts/lisa-github-rulesets.test.ts` | 20.2 | 42 | not measurable (child process) | other | keep |  |
| 20 | `tests/unit/hooks/enforcement-fallback-sticky-exemption.test.ts` | 19.3 | 7 | not measurable (shell) | other: shell guard | keep |  |
| 21 | `tests/unit/scripts/review-gate-terminal-neutral.test.ts` | 18.7 | 29 | not measurable (child process) | real-process tests that could run in-process | keep | runs the unchanged prover script with real jq per case (~0.6s each); the prover is shell+jq, so there is no in-process route |
| 22 | `tests/unit/hooks/worktree-binding-read-warning.test.ts` | 18.7 | 64 | not measurable (child process) | other: shell guard | keep |  |
| 23 | `tests/unit/scripts/work-item-proof-freshness-review.test.ts` | 18.2 | 16 | not measurable (child process: covered no lisa-work-item.mjs mutant in M2) | real-process tests that could run in-process | slim | drives `scripts/lisa-work-item.mjs` as a child through `proofCli`; the in-process `cli()` harness in tests/support/work-item-cli.ts already exists |
| 24 | `tests/unit/scripts/work-item-proof-scope.test.ts` | 17.7 | 10 | not measurable (child process: covered no lisa-work-item.mjs mutant in M2) | real-process tests that could run in-process | slim | drives `scripts/lisa-work-item.mjs` as a child through `proofCli`; the in-process `cli()` harness in tests/support/work-item-cli.ts already exists |
| 25 | `tests/unit/scripts/work-item-proof-evidence-pin.test.ts` | 17.3 | 5 | not measurable (child process: covered no lisa-work-item.mjs mutant in M2) | real-process tests that could run in-process | slim | drives `scripts/lisa-work-item.mjs` as a child through `proofCli`; the in-process `cli()` harness in tests/support/work-item-cli.ts already exists |
| 26 | `tests/unit/scripts/lisa-mutation-sandbox.test.ts` | 17.2 | 29 | 14 unique of 65 kills, 77 covered (M1: lisa-mutation.mjs, whole file) | guard-of-guards | slim | `takes the child's own children with it` is 16.1s of 17.2s (a real child-tree reap); the rest of the file is milliseconds |
| 27 | `tests/unit/hooks/commit-msg.test.ts` | 16.7 | 80 | not measurable (child process) | other: shell guard | keep | runs the real commit-msg hook (commitlint) per case |
| 28 | `tests/unit/scripts/work-item-stacked-push.test.ts` | 16.3 | 22 | 1 unique of 62 kills, 108 covered (M2: lisa-work-item.mjs, 10% sample) | duplicate journeys | keep (judgment) | runs each case through the native stdin entrypoint AND in-process (its own header); the pair is deliberate |
| 29 | `tests/unit/config/scratch-refusal-order.test.ts` | 15.8 | 14 | not measured (timebox) | S-C scope | out of scope (S-C) |  |
| 30 | `tests/unit/scripts/work-item-linear-accepted-proof.test.ts` | 15.7 | 7 | not measurable (child process: covered no lisa-work-item.mjs mutant in M2) | real-process tests that could run in-process | slim | drives `scripts/lisa-work-item.mjs` as a child through `proofCli`; the in-process `cli()` harness in tests/support/work-item-cli.ts already exists |
| 31 | `tests/unit/scripts/work-item-linear-production.test.ts` | 15.1 | 15 | 2 unique of 38 kills, 67 covered (M2: lisa-work-item.mjs, 10% sample) | real-process tests that could run in-process | slim | drives `scripts/lisa-work-item.mjs` as a child through `proofCli`; the in-process `cli()` harness in tests/support/work-item-cli.ts already exists |
| 32 | `tests/unit/scripts/review-gate-terminal-skipped.test.ts` | 14.3 | 23 | not measurable (child process) | real-process tests that could run in-process | keep | same harness as review-gate-terminal-neutral; shell+jq prover |
| 33 | `tests/unit/hooks/enforcement-fallback-attribution.test.ts` | 14.0 | 23 | not measurable (shell) | other: shell guard | keep |  |
| 34 | `tests/unit/config/eslint-shipped-mjs-clean.test.ts` | 13.7 | 5 | not measured (timebox) | other: repo-wide scan | keep | lints every shipped .mjs with the shipped config (two cases are 7.1s and 6.5s); the only proof that what Lisa installs passes what Lisa installs |
| 35 | `tests/unit/scripts/work-item-accepted-proof.test.ts` | 13.7 | 4 | not measurable (child process: covered no lisa-work-item.mjs mutant in M2) | real-process tests that could run in-process | slim | drives `scripts/lisa-work-item.mjs` as a child through `proofCli`; the in-process `cli()` harness in tests/support/work-item-cli.ts already exists |
| 36 | `tests/unit/hooks/block-no-verify-command-config.test.ts` | 13.6 | 249 | not measurable (shell) | other: shell guard | keep |  |
| 37 | `tests/unit/config/scratch-run-root-teardown.test.ts` | 12.9 | 4 | not measured (timebox) | S-C scope | out of scope (S-C) |  |
| 38 | `tests/unit/scripts/work-item-sweep-ancestry.test.ts` | 12.8 | 9 | not measurable (child process: covered no lisa-work-item.mjs mutant in M2) | real-process tests that could run in-process | slim | drives `scripts/lisa-work-item.mjs` as a child through `proofCli`; the in-process `cli()` harness in tests/support/work-item-cli.ts already exists |
| 39 | `tests/unit/scripts/work-item-proof-late-read.test.ts` | 12.5 | 5 | not measurable (child process: covered no lisa-work-item.mjs mutant in M2) | real-process tests that could run in-process | slim | drives `scripts/lisa-work-item.mjs` as a child through `proofCli`; the in-process `cli()` harness in tests/support/work-item-cli.ts already exists |
| 40 | `tests/unit/config/scratch-child-authority.test.ts` | 12.0 | 12 | not measured (timebox) | S-C scope | out of scope (S-C) |  |
| 41 | `tests/unit/scripts/lisa-mutation-gate.test.ts` | 12.0 | 123 | 504 unique of 836 kills, 1144 covered (M1: lisa-mutation.mjs, whole file) | guard-of-guards | keep |  |
| 42 | `tests/unit/hooks/block-managed-file-edits-redirects.test.ts` | 11.0 | 94 | not measurable (shell) | other: shell guard | keep |  |
| 43 | `tests/unit/hooks/block-no-verify-eval-payload.test.ts` | 10.8 | 265 | not measurable (shell) | other: shell guard | keep |  |
| 44 | `tests/unit/scripts/check-shipped-surface-removals.test.ts` | 10.3 | 58 | not measured (timebox) | other: repo-wide scan | keep |  |
| 45 | `tests/unit/scripts/npm-update-driver-diagnostic.test.ts` | 9.2 | 18 | not measured (timebox) | other: deadline wait | slim | `never requests an endpoint from unrelated readiness prose` is 8.1s of 9.2s |
| 46 | `tests/unit/scripts/work-item-cli-writes.test.ts` | 8.9 | 61 | 20 unique of 174 kills, 276 covered (M2: lisa-work-item.mjs, 10% sample) | other | keep |  |
| 47 | `tests/unit/scripts/work-item-cli-trackers.test.ts` | 8.7 | 24 | 3 unique of 56 kills, 97 covered (M2: lisa-work-item.mjs, 10% sample) | other: real CLI or workflow step | keep |  |
| 48 | `tests/unit/hooks/block-direct-issue-create-bypasses.test.ts` | 8.5 | 64 | not measurable (shell) | other: shell guard | keep |  |
| 49 | `tests/unit/hooks/enforcement-fallback-notice-rate.test.ts` | 8.4 | 10 | not measurable (shell) | other: shell guard | keep |  |
| 50 | `tests/unit/scripts/plugin-sync-scripts.test.ts` | 8.4 | 8 | not measured (timebox) | other | keep |  |
| 51 | `tests/unit/strategies/remote-agent-aws-observer-reads.test.ts` | 8.2 | 12 | not measurable (shell) | other: shell guard | keep |  |
| 52 | `tests/unit/scripts/install-claude-plugins-self.test.ts` | 8.2 | 21 | not measurable (child process) | other: real CLI or workflow step | keep |  |
| 53 | `tests/unit/plugins/hook-registration.test.ts` | 7.8 | 17 | not measured (timebox) | other: repo-wide scan | keep |  |
| 54 | `tests/unit/hooks/worktree-binding-read-warning-parity.test.ts` | 7.8 | 8 | not measurable (child process) | duplicate journeys | keep | agent-parity copy; parity is an owner rule |
| 55 | `tests/unit/core/no-downstream-project-names.test.ts` | 7.8 | 13 | not measured (timebox) | other: repo-wide scan | keep | the executable form of the never-name-a-downstream-project rule; one 7.8s whole-tree scan |
| 56 | `tests/unit/helpers/io-latency-budget.test.ts` | 7.6 | 29 | not measurable (child process) | guard-of-guards | keep | tests the latency-budget helper every heavy suite relies on |
| 57 | `tests/unit/scripts/work-item-proof-gh-versions.test.ts` | 7.5 | 3 | not measurable (child process: covered no lisa-work-item.mjs mutant in M2) | real-process tests that could run in-process | slim | drives `scripts/lisa-work-item.mjs` as a child through `proofCli`; the in-process `cli()` harness in tests/support/work-item-cli.ts already exists |
| 58 | `tests/unit/hooks/pre-push-audit-transport-parity.test.ts` | 7.0 | 55 | not measurable (child process) | duplicate journeys | keep | agent-parity copy; parity is an owner rule |
| 59 | `tests/unit/hooks/guard-dedupe-security.test.ts` | 6.9 | 12 | not measurable (shell) | other: shell guard | keep |  |
| 60 | `tests/unit/scripts/npm-update-rails-runtime-descriptor.test.ts` | 6.8 | 7 | not measured (timebox) | other | keep |  |
| 61 | `tests/unit/config/knip-shipped-hooks-binaries.test.ts` | 6.7 | 8 | not measurable (child process) | other: real CLI or workflow step | keep |  |
| 62 | `tests/unit/scripts/work-item-coherent-related.test.ts` | 6.6 | 2 | not measurable (child process: covered no lisa-work-item.mjs mutant in M2) | real-process tests that could run in-process | slim | drives `scripts/lisa-work-item.mjs` as a child through `proofCli`; the in-process `cli()` harness in tests/support/work-item-cli.ts already exists |
| 63 | `tests/unit/hooks/worktree-binding-acknowledgement-boundaries.test.ts` | 6.4 | 23 | not measurable (child process) | other: shell guard | keep |  |
| 64 | `tests/unit/scripts/work-item-proof-evidence-overflow.test.ts` | 6.4 | 3 | not measurable (child process: covered no lisa-work-item.mjs mutant in M2) | real-process tests that could run in-process | slim | drives `scripts/lisa-work-item.mjs` as a child through `proofCli`; the in-process `cli()` harness in tests/support/work-item-cli.ts already exists |
| 65 | `tests/unit/scripts/work-item-proof-write-errors.test.ts` | 6.3 | 3 | not measurable (child process: covered no lisa-work-item.mjs mutant in M2) | real-process tests that could run in-process | slim | drives `scripts/lisa-work-item.mjs` as a child through `proofCli`; the in-process `cli()` harness in tests/support/work-item-cli.ts already exists |
| 66 | `tests/unit/hooks/sonar-resolver-deadline.test.ts` | 6.3 | 4 | not measurable (shell) | other: shell guard | keep |  |
| 67 | `tests/unit/strategies/remote-agent-aws-profiles.test.ts` | 6.3 | 8 | not measurable (shell) | other: shell guard | keep |  |
| 68 | `tests/unit/hooks/block-direct-issue-create.test.ts` | 6.3 | 46 | not measurable (shell) | other: shell guard | keep |  |
| 69 | `tests/unit/scripts/npm-update-dual-lock-contract.test.ts` | 6.2 | 12 | not measured (timebox) | other | keep |  |
| 70 | `tests/unit/helpers/fs-latency-budget.test.ts` | 6.1 | 23 | not measured (timebox) | guard-of-guards | keep |  |
| 71 | `tests/unit/scripts/bdd-projection-merge.test.ts` | 6.0 | 4 | not measurable (child process) | other: real CLI or workflow step | keep |  |
| 72 | `tests/unit/hooks/block-direct-issue-create-file-reach.test.ts` | 5.9 | 44 | not measurable (shell) | other: shell guard | keep |  |
| 73 | `tests/unit/config/coverage-include-guard.test.ts` | 5.8 | 22 | not measured (timebox) | guard-of-guards | keep |  |
| 74 | `tests/unit/hooks/guard-dedupe.test.ts` | 5.5 | 12 | not measurable (child process) | other: shell guard | keep |  |
| 75 | `tests/unit/scripts/work-item-multi-item-range.test.ts` | 5.3 | 38 | 1 unique of 84 kills, 154 covered (M2: lisa-work-item.mjs, 10% sample) | other: real CLI or workflow step | keep |  |
| 76 | `tests/unit/hooks/block-direct-issue-create-data-paths.test.ts` | 5.2 | 31 | not measurable (shell) | other: shell guard | keep |  |
| 77 | `tests/unit/scripts/process-tree-runner-interrupt.test.ts` | 5.1 | 15 | not measured (timebox) | other | keep |  |
| 78 | `tests/unit/scripts/work-item-jira-origin.test.ts` | 5.0 | 37 | 46 unique of 129 kills, 180 covered (M2: lisa-work-item.mjs, 10% sample) | other: real CLI or workflow step | keep |  |
| 79 | `tests/unit/secrets/preflight-hardening.test.ts` | 5.0 | 11 | not measured (timebox) | other | keep |  |
| 80 | `tests/unit/helpers/bounded-bash.test.ts` | 4.9 | 5 | not measurable (child process) | guard-of-guards | keep |  |
| 81 | `tests/unit/scripts/work-item-sweep-bounded.test.ts` | 4.9 | 13 | 25 unique of 129 kills, 208 covered (M2: lisa-work-item.mjs, 10% sample) | other: real CLI or workflow step | keep |  |
| 82 | `tests/unit/hooks/block-no-verify-nested-shell-parity.test.ts` | 4.9 | 102 | not measurable (shell) | duplicate journeys | keep | agent-parity copy; parity is an owner rule |
| 83 | `tests/unit/hooks/rails-hook-engine.test.ts` | 4.8 | 17 | not measured (timebox) | other: shell guard | keep |  |
| 84 | `tests/unit/strategies/remote-agent-aws-default-refusal.test.ts` | 4.8 | 6 | not measurable (shell) | other: shell guard | keep |  |
| 85 | `tests/unit/scripts/npm-update-classifier-cache.test.ts` | 4.7 | 30 | not measured (timebox) | other | keep |  |
| 86 | `tests/unit/scripts/history-secret-new-ref-range.test.ts` | 4.7 | 9 | not measured (timebox) | other | keep |  |
| 87 | `tests/unit/hooks/enforcement-fallback-staleness.test.ts` | 4.7 | 15 | not measurable (shell) | other: shell guard | keep |  |
| 88 | `tests/unit/hooks/block-blind-automerge.test.ts` | 4.6 | 52 | not measurable (shell) | other: shell guard | keep |  |
| 89 | `tests/unit/hooks/block-direct-issue-create-noexec.test.ts` | 4.6 | 29 | not measurable (shell) | other: shell guard | keep |  |
| 90 | `tests/unit/hooks/worktree-binding-owner-boundaries.test.ts` | 4.4 | 9 | not measurable (child process) | other: shell guard | keep |  |
| 91 | `tests/unit/hooks/block-no-verify-directory-boundaries.test.ts` | 4.2 | 60 | not measurable (shell) | other: shell guard | keep |  |
| 92 | `tests/unit/scripts/work-item-merge-base-completion.test.ts` | 4.1 | 24 | 0 unique of 85 kills, 151 covered (M2: lisa-work-item.mjs, 10% sample) | other | keep | zero unique kills in a 10% sample is not evidence; measure the whole guard before #4616 considers deletion |
| 93 | `tests/unit/hooks/worktree-binding-repository-recovery.test.ts` | 4.1 | 12 | not measurable (child process) | other: shell guard | keep |  |
| 94 | `tests/unit/strategies/credential-resolver-ladder.test.ts` | 4.1 | 275 | not measurable (child process) | prose checks | keep | reads 63 Markdown files; no WORDING site in the #4867 classification |
| 95 | `tests/unit/core/learnings-lock-acquire.test.ts` | 4.0 | 1 | not measured (timebox) | other | keep |  |
| 96 | `tests/unit/scripts/bdd-deploy-chain.test.ts` | 3.9 | 11 | not measurable (child process) | other: real CLI or workflow step | keep |  |
| 97 | `tests/unit/config/eslint-shipped-config-templates.test.ts` | 3.9 | 8 | not measured (timebox) | other | keep |  |
| 98 | `tests/unit/scripts/jira-evidence-release.test.ts` | 3.8 | 10 | not measurable (child process) | other: real CLI or workflow step | keep |  |
| 99 | `tests/unit/hooks/pre-push-pushed-tree-scope.test.ts` | 3.8 | 21 | not measurable (child process) | other: shell guard | keep |  |
| 100 | `tests/unit/hooks/worktree-binding-guard.test.ts` | 3.8 | 14 | not measurable (child process) | other: shell guard | keep |  |
| 101 | `tests/unit/cli/starter-sync.test.ts` | 3.7 | 15 | not measured (timebox) | other | keep |  |
| 102 | `tests/unit/scripts/review-evidence-wakeup.test.ts` | 3.7 | 21 | not measurable (child process) | other: real CLI or workflow step | keep |  |
| 103 | `tests/unit/scripts/npm-update-github.test.ts` | 3.7 | 38 | not measured (timebox) | other | keep |  |
| 104 | `tests/unit/hooks/block-managed-file-edits-file-reach.test.ts` | 3.7 | 69 | not measurable (shell) | other: shell guard | keep |  |
| 105 | `tests/unit/scripts/jira-cli-config-consumption.test.ts` | 3.7 | 15 | not measurable (child process) | prose checks | keep | reads 3,689 Markdown files but the #4867 cull recorded no WORDING site in it; what is left is structural |
| 106 | `tests/unit/session-manager/cli-answer-record.test.ts` | 3.5 | 14 | not measurable (child process) | other: real CLI or workflow step | keep |  |
| 107 | `tests/unit/config/vitest-deadline-order.test.ts` | 3.5 | 1 | not measurable (child process) | guard-of-guards | keep |  |
| 108 | `tests/unit/hooks/cross-worktree-guard.test.ts` | 3.5 | 13 | not measurable (child process) | other: shell guard | keep |  |
| 109 | `tests/unit/hooks/block-direct-issue-create-refusal-inverse.test.ts` | 3.5 | 22 | not measurable (shell) | other: shell guard | keep |  |
| 110 | `tests/unit/scripts/npm-update-contract.test.ts` | 3.5 | 114 | not measured (timebox) | other | keep |  |
| 111 | `tests/unit/config/stale-deploy-guard.test.ts` | 3.5 | 23 | not measurable (child process) | other: real CLI or workflow step | keep |  |
| 112 | `tests/unit/codex/block-suppress-directives.test.ts` | 3.4 | 37 | not measurable (shell) | duplicate journeys | keep | agent-parity copy; parity is an owner rule |
| 113 | `tests/unit/scripts/history-secret-private-report.test.ts` | 3.3 | 14 | not measured (timebox) | other | keep |  |
| 114 | `tests/unit/hooks/block-blind-automerge-uncovered-base.test.ts` | 3.3 | 33 | not measurable (shell) | other: shell guard | keep |  |
| 115 | `tests/unit/hooks/enforce-verification-gate-v2.test.ts` | 3.3 | 19 | not measurable (shell) | other: shell guard | keep |  |
| 116 | `tests/unit/hooks/block-direct-issue-create-declarations.test.ts` | 3.3 | 27 | not measurable (shell) | other: shell guard | keep |  |
| 117 | `tests/unit/hooks/block-no-verify-directory-parity.test.ts` | 3.3 | 54 | not measurable (shell) | duplicate journeys | keep | agent-parity copy; parity is an owner rule |
| 118 | `tests/unit/hooks/block-managed-file-edits-host-stack.test.ts` | 3.2 | 63 | not measurable (shell) | other: shell guard | keep |  |
| 119 | `tests/unit/hooks/verification-failure-mode-fixtures.test.ts` | 3.2 | 30 | not measurable (shell) | other: shell guard | keep |  |
| 120 | `tests/unit/hooks/enforcement-fallback.test.ts` | 3.2 | 6 | not measurable (shell) | other: shell guard | keep |  |
| 121 | `tests/unit/scripts/work-item-amended-merge-exemption.test.ts` | 3.2 | 5 | 0 unique of 36 kills, 55 covered (M2: lisa-work-item.mjs, 10% sample) | other: real CLI or workflow step | keep | zero unique kills in a 10% sample is not evidence; measure the whole guard before #4616 considers deletion |
| 122 | `tests/unit/hooks/block-no-verify-short-flag.test.ts` | 3.1 | 65 | not measurable (shell) | other: shell guard | keep |  |
| 123 | `tests/unit/session-manager/cli-human-answer.test.ts` | 3.1 | 20 | not measurable (child process) | other: real CLI or workflow step | keep |  |
| 124 | `tests/unit/core/learnings-overflow.test.ts` | 3.1 | 15 | not measured (timebox) | other | keep |  |
| 125 | `tests/unit/config/vitest-scratch-residue.test.ts` | 3.0 | 11 | not measured (timebox) | S-C scope | out of scope (S-C) |  |
| 126 | `tests/unit/scripts/vacuous-required-checks-wiring.test.ts` | 3.0 | 68 | not measurable (child process) | other: real CLI or workflow step | keep |  |
| 127 | `tests/unit/plugins/hook-registration-agreement.test.ts` | 3.0 | 4 | not measured (timebox) | other | keep |  |
| 128 | `tests/unit/hooks/worktree-binding-live-identity.test.ts` | 2.9 | 7 | not measurable (child process) | other: shell guard | keep |  |
| 129 | `tests/unit/hooks/worktree-create.test.ts` | 2.9 | 17 | not measurable (shell) | other: shell guard | keep |  |
| 130 | `tests/unit/hooks/block-host-name-leak.test.ts` | 2.9 | 36 | not measurable (shell) | other: shell guard | keep |  |
| 131 | `tests/unit/hooks/worktree-binding-legacy-ownership.test.ts` | 2.9 | 8 | not measurable (child process) | other: shell guard | keep |  |
| 132 | `tests/unit/scripts/lisa-work-item-pending-update.test.ts` | 2.9 | 12 | 16 unique of 28 kills, 41 covered (M2: lisa-work-item.mjs, 10% sample) | other | keep |  |
| 133 | `tests/unit/hooks/block-direct-issue-create-reader-fence.test.ts` | 2.8 | 19 | not measurable (shell) | other: shell guard | keep |  |
| 134 | `tests/unit/hooks/block-direct-issue-create-cross-repo.test.ts` | 2.8 | 16 | not measurable (shell) | other: shell guard | keep |  |
| 135 | `tests/unit/helpers/gate-capture.test.ts` | 2.8 | 21 | not measurable (child process) | guard-of-guards | keep |  |
| 136 | `tests/unit/session-manager/cli.test.ts` | 2.8 | 24 | not measurable (child process) | other: real CLI or workflow step | keep |  |
| 137 | `tests/unit/session-manager/cli-setup-gap-persist.test.ts` | 2.8 | 10 | not measurable (child process) | other: real CLI or workflow step | keep |  |
| 138 | `tests/unit/scripts/npm-update-husky-compatibility.test.ts` | 2.7 | 9 | not measured (timebox) | other | keep |  |
| 139 | `tests/unit/hooks/cwd-resolution-corpus-parity.test.ts` | 2.7 | 27 | not measurable (child process) | duplicate journeys | keep | agent-parity copy; parity is an owner rule |
| 140 | `tests/unit/codex/codex-edit-hooks.test.ts` | 2.7 | 18 | not measurable (shell) | duplicate journeys | keep | agent-parity copy; parity is an owner rule |
| 141 | `tests/unit/hooks/block-no-verify-file-reach.test.ts` | 2.7 | 55 | not measurable (shell) | other: shell guard | keep |  |
| 142 | `tests/unit/scripts/work-item-comment-projection.test.ts` | 2.7 | 8 | 0 unique of 15 kills, 22 covered (M2: lisa-work-item.mjs, 10% sample) | other | keep | zero unique kills in a 10% sample is not evidence; measure the whole guard before #4616 considers deletion |
| 143 | `tests/unit/cli/starter-sync-command.test.ts` | 2.7 | 11 | not measured (timebox) | other | keep |  |
| 144 | `tests/unit/scripts/work-item-cli-pull-request.test.ts` | 2.6 | 28 | 0 unique of 59 kills, 112 covered (M2: lisa-work-item.mjs, 10% sample) | other: real CLI or workflow step | keep | zero unique kills in a 10% sample is not evidence; measure the whole guard before #4616 considers deletion |
| 145 | `tests/unit/session-manager/ledger-lock.test.ts` | 2.6 | 7 | not measured (timebox) | other | keep |  |
| 146 | `tests/unit/hooks/block-no-verify.test.ts` | 2.6 | 61 | not measurable (shell) | other: shell guard | keep |  |
| 147 | `tests/unit/session-manager/cli-cycle-human-needed.test.ts` | 2.6 | 5 | not measurable (child process) | other: real CLI or workflow step | keep |  |
| 148 | `tests/unit/scripts/work-item-completion-authorization.test.ts` | 2.6 | 10 | not measurable (child process: covered no lisa-work-item.mjs mutant in M2) | other: real CLI or workflow step | keep |  |
| 149 | `tests/unit/codex/block-no-verify-codex.test.ts` | 2.5 | 43 | not measurable (shell) | duplicate journeys | keep | agent-parity copy; parity is an owner rule |
| 150 | `tests/unit/scripts/merge-generated-artifact.test.ts` | 2.5 | 14 | not measured (timebox) | other | keep |  |
| 151 | `tests/unit/opencode/block-direct-issue-create-cross-repo-parity.test.ts` | 2.5 | 21 | not measurable (shell) | duplicate journeys | keep | agent-parity copy; parity is an owner rule |
| 152 | `tests/unit/agy/block-no-verify-agy.test.ts` | 2.4 | 62 | not measurable (shell) | duplicate journeys | keep | agent-parity copy; parity is an owner rule |
| 153 | `tests/unit/hooks/block-direct-issue-create-mcp-substrate.test.ts` | 2.4 | 40 | not measurable (shell) | other: shell guard | keep |  |
| 154 | `tests/unit/hooks/enforcement-fallback-zero-guards.test.ts` | 2.4 | 8 | not measurable (shell) | other: shell guard | keep |  |
| 155 | `tests/unit/opencode/block-host-name-leak-plugin.test.ts` | 2.4 | 16 | not measurable (shell) | duplicate journeys | keep | agent-parity copy; parity is an owner rule |
| 156 | `tests/unit/helpers/staged-dependency-conformance.test.ts` | 2.4 | 8 | not measurable (child process) | guard-of-guards | keep |  |
| 157 | `tests/unit/cli/doctor-merge-drivers.test.ts` | 2.4 | 16 | not measured (timebox) | other | keep |  |
| 158 | `tests/unit/scripts/absent-required-checks-by-branch.test.ts` | 2.4 | 49 | not measurable (child process) | other: real CLI or workflow step | keep |  |
| 159 | `tests/unit/hooks/cleanup-stale-worktrees.test.ts` | 2.3 | 5 | not measurable (shell) | other: shell guard | keep |  |
| 160 | `tests/unit/scripts/check-conflict-markers.test.ts` | 2.3 | 25 | not measured (timebox) | other: repo-wide scan | keep |  |
| 161 | `tests/unit/session-manager/cli-first-prompt.test.ts` | 2.3 | 15 | not measurable (child process) | other: real CLI or workflow step | keep |  |
| 162 | `tests/unit/core/learnings-writer.test.ts` | 2.3 | 26 | not measured (timebox) | other | keep |  |
| 163 | `tests/unit/config/scratch-tmpdir-trust.test.ts` | 2.3 | 9 | not measured (timebox) | S-C scope | out of scope (S-C) |  |
| 164 | `tests/unit/helpers/fs-probe-diagnostic.test.ts` | 2.2 | 11 | not measured (timebox) | guard-of-guards | keep |  |
| 165 | `tests/unit/hooks/parity-push-gate.test.ts` | 2.2 | 8 | not measurable (child process) | duplicate journeys | keep | agent-parity copy; parity is an owner rule |
| 166 | `tests/unit/hooks/guard-dedupe-generated-channels.test.ts` | 2.2 | 12 | not measurable (shell) | duplicate journeys | keep | agent-parity copy; parity is an owner rule |
| 167 | `tests/unit/scripts/work-item-cli-commit.test.ts` | 2.2 | 50 | 4 unique of 85 kills, 133 covered (M2: lisa-work-item.mjs, 10% sample) | other: real CLI or workflow step | keep |  |
| 168 | `tests/unit/hooks/worktree-binding-parallel-agents.test.ts` | 2.2 | 7 | not measurable (child process) | other: shell guard | keep |  |
| 169 | `tests/unit/hooks/worktree-binding-first-write-race.test.ts` | 2.2 | 5 | not measurable (child process) | other: shell guard | keep |  |
| 170 | `tests/unit/scripts/merge-generated-artifact-derived-entries.test.ts` | 2.1 | 15 | not measured (timebox) | other | keep |  |
| 171 | `tests/unit/session-manager/cli-manager.test.ts` | 2.1 | 17 | not measured (timebox) | other | keep |  |
| 172 | `tests/unit/core/workflow-load-consumer.test.ts` | 2.1 | 11 | not measurable (child process) | other: real CLI or workflow step | keep |  |
| 173 | `tests/unit/hooks/enforce-verification-gate-v1.test.ts` | 2.1 | 15 | not measurable (shell) | other: shell guard | keep |  |
| 174 | `tests/unit/scripts/bdd-writer-admission.test.ts` | 2.1 | 2 | not measurable (child process) | guard-of-guards | keep |  |
| 175 | `tests/unit/scripts/nightly-e2e-health-discovery.test.ts` | 2.1 | 21 | not measured (timebox) | other | keep |  |
| 176 | `tests/unit/core/learnings-overflow-identity.test.ts` | 2.0 | 4 | not measured (timebox) | other | keep |  |
| 177 | `tests/unit/session-manager/cli-token-provider.test.ts` | 2.0 | 14 | not measurable (child process) | other: real CLI or workflow step | keep |  |
| 178 | `tests/unit/scripts/bdd-reporting.test.ts` | 2.0 | 8 | not measurable (child process) | other: real CLI or workflow step | keep |  |
| 179 | `tests/unit/scripts/check-orphan-test-processes.test.ts` | 2.0 | 20 | not measured (timebox) | guard-of-guards | keep |  |
| 180 | `tests/unit/hooks/enforcement-fallback-channel-skew.test.ts` | 2.0 | 10 | not measurable (shell) | other: shell guard | keep |  |
| 181 | `tests/unit/scripts/lisa-worktree-guard.test.ts` | 2.0 | 13 | not measured (timebox) | other | keep |  |
| 182 | `tests/unit/session-manager/cli-notify-none.test.ts` | 2.0 | 12 | not measured (timebox) | other | keep |  |
| 183 | `tests/unit/hooks/host-enforcement-fallback.test.ts` | 1.9 | 41 | not measurable (shell) | other: shell guard | keep |  |
| 184 | `tests/unit/scripts/work-item-back-merge-exemption.test.ts` | 1.8 | 8 | 0 unique of 28 kills, 47 covered (M2: lisa-work-item.mjs, 10% sample) | other: real CLI or workflow step | keep | zero unique kills in a 10% sample is not evidence; measure the whole guard before #4616 considers deletion |
| 185 | `tests/unit/core/effectiveness-store.test.ts` | 1.8 | 10 | not measured (timebox) | other | keep |  |
| 186 | `tests/unit/hooks/worktree-binding-guard-wrapper.test.ts` | 1.8 | 2 | not measurable (shell) | other: shell guard | keep |  |
| 187 | `tests/unit/codex/block-managed-file-edits-codex.test.ts` | 1.8 | 5 | not measurable (shell) | duplicate journeys | keep | agent-parity copy; parity is an owner rule |
| 188 | `tests/unit/scripts/check-empty-subject-guards.test.ts` | 1.8 | 18 | not measured (timebox) | other | keep |  |
| 189 | `tests/unit/scripts/work-item-optional-validation.test.ts` | 1.8 | 18 | 5 unique of 87 kills, 172 covered (M2: lisa-work-item.mjs, 10% sample) | other: real CLI or workflow step | keep |  |
| 190 | `tests/unit/hooks/install-rails-hooks.test.ts` | 1.8 | 7 | not measurable (shell) | other: shell guard | keep |  |
| 191 | `tests/unit/scripts/bdd-nonregression.test.ts` | 1.7 | 19 | not measurable (child process) | other: real CLI or workflow step | keep |  |
| 192 | `tests/unit/cli/learnings-overflow-cmd.test.ts` | 1.7 | 4 | not measured (timebox) | other | keep |  |
| 193 | `tests/unit/scripts/check-release-package-identity.test.ts` | 1.7 | 10 | not measured (timebox) | other | keep |  |
| 194 | `tests/unit/hooks/worktree-binding-first-call.test.ts` | 1.7 | 6 | not measurable (child process) | other: shell guard | keep |  |
| 195 | `tests/unit/hooks/worktree-binding-guard-script-reach.test.ts` | 1.7 | 6 | not measurable (child process) | other: shell guard | keep |  |
| 196 | `tests/unit/standards/git-state.test.ts` | 1.7 | 9 | not measured (timebox) | other | keep |  |
| 197 | `tests/unit/config/expo-eslint-local-config.test.ts` | 1.7 | 2 | not measurable (child process) | other: real CLI or workflow step | keep |  |
| 198 | `tests/unit/scripts/measure-tmpdir-growth.test.ts` | 1.7 | 39 | not measured (timebox) | S-C scope | out of scope (S-C) |  |
| 199 | `tests/unit/core/learnings-merge-driver-worktree.test.ts` | 1.7 | 4 | not measured (timebox) | other | keep |  |
| 200 | `tests/unit/session-manager/cli-status-other-cyclers.test.ts` | 1.7 | 11 | not measurable (child process) | other: real CLI or workflow step | keep |  |

## Integration files (90% of integration time)

| # | File | Seconds | Tests | Unique mutation kills | Category | Recommendation | Note |
|---:|---|---:|---:|---|---|---|---|
| 1 | `tests/integration/history-secret-evidence.test.ts` | 96.6 | 17 | not measurable (integration) | other: real vendor binary | move to on-demand (judgment) | drives the genuine pinned history scanner (11.1% of integration time); the only proof against vendor behaviour, so the question is whether every PR must pay for it or only PRs touching the history-secret code |
| 2 | `tests/integration/history-secret-private-report.test.ts` | 80.8 | 25 | not measurable (integration) | other: real vendor binary | move to on-demand (judgment) | same genuine scanner; two cases are 17.6s and 14.6s |
| 3 | `tests/integration/mutation-gate-bite.test.ts` | 46.2 | 4 | not measurable (integration) | guard-of-guards | move to on-demand (judgment) | proves the production mutation config bites (real Stryker, 30.2s + 16.1s); already excluded from `test:integration:push`. The cheaper diff-bite suite (4.2s) stays in the PR path |
| 4 | `tests/integration/quality-unit-progress.test.ts` | 31.8 | 6 | not measurable (integration) | other: deadline wait | slim (judgment) | one case waits for the real 30-second production progress timer (31.5s of 31.8s); its header says the real timer is the point, so injecting a shorter one is an owner call |
| 5 | `tests/integration/lisa-test-run-jest-shards-reports.test.ts` | 29.7 | 10 | not measurable (integration) | guard-of-guards | slim (judgment) | every case runs a whole Jest run plus two shards (~3s each, 10 cases); one shared whole+merged pair with every reporter would serve most cases, but some vary reporter options |
| 6 | `tests/integration/enforcement-fallback-freshness-anchor-startup.test.ts` | 29.2 | 20 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 7 | `tests/integration/review-evidence-check-summary.test.ts` | 23.2 | 39 | not measurable (integration) | other | keep | installed CLI plus real jq; ~0.6s per case |
| 8 | `tests/integration/npm-update-all-host-helpers.test.ts` | 21.9 | 4 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 9 | `tests/integration/jira-shell-auth-destinations.test.ts` | 21.3 | 84 | not measurable (integration) | duplicate journeys | keep | repeats each credential-destination case over four hand-maintained copies of the Jira shell helpers (base/expo/rails); not generated copies, so each copy needs its own proof |
| 10 | `tests/integration/lisa-test-run-shard-cli.test.ts` | 17.9 | 4 | not measurable (integration) | guard-of-guards | keep |  |
| 11 | `tests/integration/enforcement-fallback-freshness-deadline.test.ts` | 16.8 | 15 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 12 | `tests/integration/audit-consumer-parity.test.ts` | 16.1 | 32 | not measurable (integration) | duplicate journeys | keep | agent-parity copy; parity is an owner rule |
| 13 | `tests/integration/staged-module-formatting.test.ts` | 15.5 | 8 | not measurable (integration) | guard-of-guards | keep |  |
| 14 | `tests/integration/vitest-nodenext-local-config.test.ts` | 14.8 | 12 | not measurable (integration) | guard-of-guards | keep |  |
| 15 | `tests/integration/jira-evidence-link-forms.test.ts` | 14.5 | 45 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 16 | `tests/integration/jira-evidence-pr-scoped-uploads.test.ts` | 14.0 | 51 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 17 | `tests/integration/rails-scratch-lifecycle.test.ts` | 13.1 | 12 | not measurable (integration) | S-C scope | out of scope (S-C) |  |
| 18 | `tests/integration/push-collects-integration-tree-once.test.ts` | 11.9 | 9 | not measurable (integration) | guard-of-guards | keep |  |
| 19 | `tests/integration/maestro-native-retry-execution-evidence.test.ts` | 11.3 | 48 | not measurable (integration) | duplicate journeys | keep | runs every case for android and ios through the workflow's extracted Bash |
| 20 | `tests/integration/history-secret-scanner-path.test.ts` | 10.3 | 3 | not measurable (integration) | other: real vendor binary | keep (judgment) | same genuine scanner as history-secret-evidence; decide together with it |
| 21 | `tests/integration/shell-guard-allow-controls.test.ts` | 10.2 | 30 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 22 | `tests/integration/worktree-dependency-boundary.test.ts` | 9.8 | 14 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 23 | `tests/integration/standards-proof-typescript.test.ts` | 9.5 | 2 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 24 | `tests/integration/doctor-nightly-e2e-guard-cli.test.ts` | 9.3 | 28 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 25 | `tests/integration/quality-node-supervision.test.ts` | 8.0 | 17 | not measurable (integration) | guard-of-guards | keep |  |
| 26 | `tests/integration/enforcement-fallback-freshness-edges.test.ts` | 7.8 | 18 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 27 | `tests/integration/third-party-review-check-run-parity.test.ts` | 7.3 | 12 | not measurable (integration) | duplicate journeys | keep | agent-parity copy; parity is an owner rule |
| 28 | `tests/integration/maestro-native-fatal-watchdog.test.ts` | 7.2 | 11 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 29 | `tests/integration/lisa-test-run-jest-shards.test.ts` | 7.1 | 3 | not measurable (integration) | guard-of-guards | keep |  |
| 30 | `tests/integration/third-party-review-check-run-refusals.test.ts` | 6.5 | 34 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 31 | `tests/integration/review-evidence-gate.test.ts` | 6.4 | 26 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 32 | `tests/integration/enforcement-fallback-freshness-laziness.test.ts` | 5.7 | 6 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 33 | `tests/integration/vitest-local-runtime.test.ts` | 5.7 | 6 | not measurable (integration) | guard-of-guards | keep |  |
| 34 | `tests/integration/maestro-native-android-per-flow-retry.test.ts` | 5.5 | 23 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 35 | `tests/integration/maestro-native-retry-scheduling-evidence.test.ts` | 5.2 | 18 | not measurable (integration) | duplicate journeys | keep | android and ios arms |
| 36 | `tests/integration/admission.test.ts` | 5.1 | 3 | not measurable (integration) | guard-of-guards | keep |  |
| 37 | `tests/integration/codex-active-hooks.test.ts` | 5.1 | 1 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 38 | `tests/integration/gate-pass-cache-push.test.ts` | 5.1 | 6 | not measurable (integration) | guard-of-guards | keep |  |
| 39 | `tests/integration/review-evidence-check-summary-waiver.test.ts` | 4.9 | 10 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 40 | `tests/integration/third-party-review-evidence-workflow-executed.test.ts` | 4.9 | 19 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 41 | `tests/integration/rails-learnings-budget-gate.test.ts` | 4.8 | 16 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 42 | `tests/integration/rails-scratch-authority.test.ts` | 4.7 | 17 | not measurable (integration) | S-C scope | out of scope (S-C) |  |
| 43 | `tests/integration/expo-jira-parser-origin.test.ts` | 4.6 | 108 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 44 | `tests/integration/lisa-test-run-packed-bin.test.ts` | 4.6 | 5 | not measurable (integration) | guard-of-guards | keep |  |
| 45 | `tests/integration/rails-scratch-ownership.test.ts` | 4.4 | 23 | not measurable (integration) | S-C scope | out of scope (S-C) |  |
| 46 | `tests/integration/release-strategy-tag-namespace.test.ts` | 4.3 | 11 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 47 | `tests/integration/mutation-gate-diff-bite.test.ts` | 4.2 | 3 | not measurable (integration) | guard-of-guards | keep |  |
| 48 | `tests/integration/prune-verbs-negative-controls.test.ts` | 4.2 | 8 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 49 | `tests/integration/maestro-native-retry-names-evidence.test.ts` | 3.9 | 18 | not measurable (integration) | duplicate journeys | keep | android and ios arms |
| 50 | `tests/integration/build-once-per-push.test.ts` | 3.9 | 4 | not measurable (integration) | guard-of-guards | keep |  |
| 51 | `tests/integration/npm-update-dual-lock.test.ts` | 3.9 | 3 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 52 | `tests/integration/third-party-review-check-run-legacy.test.ts` | 3.7 | 18 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 53 | `tests/integration/review-evidence-check-summary-vocabulary.test.ts` | 3.6 | 8 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 54 | `tests/integration/maestro-native-per-flow-retry.test.ts` | 3.6 | 19 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 55 | `tests/integration/quality-gate-runner-validation.test.ts` | 3.5 | 46 | not measurable (integration) | guard-of-guards | keep |  |
| 56 | `tests/integration/seeded-gates-preserve-hook-outcomes.test.ts` | 3.4 | 3 | not measurable (integration) | guard-of-guards | keep |  |
| 57 | `tests/integration/lisa.test.ts` | 3.2 | 52 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 58 | `tests/integration/emitted-scripts-survive-shipped-fixer.test.ts` | 3.1 | 6 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 59 | `tests/integration/third-party-review-check-run-cli.test.ts` | 3.0 | 15 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 60 | `tests/integration/maestro-native-retry-time-budget.test.ts` | 3.0 | 20 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 61 | `tests/integration/enforcement-fallback-freshness-review-regressions.test.ts` | 2.8 | 7 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 62 | `tests/integration/enforcement-fallback-host-freshness.test.ts` | 2.7 | 2 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 63 | `tests/integration/lisa-check-then-push.test.ts` | 2.7 | 5 | not measurable (integration) | guard-of-guards | keep |  |
| 64 | `tests/integration/push-destination-inheritance.test.ts` | 2.7 | 6 | not measurable (integration) | guard-of-guards | keep |  |
| 65 | `tests/integration/enforcement-fallback-freshness-read-bounds.test.ts` | 2.6 | 6 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 66 | `tests/integration/lisa-cleanup-sweep.test.ts` | 2.5 | 4 | not measurable (integration) | S-C scope | out of scope (S-C) |  |
| 67 | `tests/integration/deploy-moment-evidence.test.ts` | 2.5 | 8 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 68 | `tests/integration/third-party-review-substitute-authors-cli.test.ts` | 2.5 | 12 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 69 | `tests/integration/edit-time-scripts-resolve-gates.test.ts` | 2.4 | 22 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 70 | `tests/integration/jira-evidence-generator-links.test.ts` | 2.3 | 10 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 71 | `tests/integration/pre-tool-refusal-scripts-resolve-gates.test.ts` | 2.3 | 24 | not measurable (integration) | other: real CLI or workflow step | keep |  |
| 72 | `tests/integration/history-secret-bootstrap.test.ts` | 2.2 | 5 | not measurable (integration) | other: real CLI or workflow step | keep |  |

## Reproducing

```sh
# cost: one unit and one integration run that write timings and the access map
CI=1 LISA_TEST_TIMINGS_SCOPE=unit LISA_ACCESS_MAP=1 bun run test:unit
CI=1 LISA_ACCESS_MAP=1 bun run test:integration
mkdir -p audit/test-timings-local-1-unit audit/test-timings-local-1-integration
cp tmp/test-timings/unit.json audit/test-timings-local-1-unit/
cp tmp/test-timings/integration.json audit/test-timings-local-1-integration/
node scripts/test-timing-report.mjs --dir audit --json > timings.json

# value: one guard, all killers recorded (do not drop --disableBail)
MUTATION_SCOPE=typescript/copy-overwrite/scripts/lisa-mutation.mjs \
LISA_TEST_SCRATCH_PREFIXES='["lisa-mutation-","worker-"]' \
  bun run lisa-test-run -- --adapter direct -- node_modules/.bin/stryker run \
  --mutate typescript/copy-overwrite/scripts/lisa-mutation.mjs \
  --reporters json,clear-text,progress --disableBail
# then, for each mutant in reports/mutation/mutation.json with status Killed,
# map killedBy ids to testFiles; a kill is unique when the set has one file.
```

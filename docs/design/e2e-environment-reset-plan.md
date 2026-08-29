# Plan: give every nightly e2e suite a clean environment

**Status:** ruled, not started. Phases 2–5 are unstarted work.
**Owner ruling captured:** 2026-08-19.

Repository identities are deliberately omitted throughout — this repo is public
and `dist/` is in the npm `files` allowlist. Repos are referred to by role.

---

## The problem

The environment façade was built. The guard that proves it is wired was built.
**The caller that actually resets an environment before a suite was never
built**, so each repo hand-wired its own, inconsistently or not at all.

Measured 2026-08-19 against live default branches:

| repo (role) | suite | reset wired? |
|---|---|---|
| frontend A | playwright | yes — but **after** the suite, `if: always()` |
| frontend A | maestro | **no reset at all** |
| frontend B | maestro | one reference, shape unverified |

Frontend A's native suite has been accumulating data nightly. That is the
specific outcome the façade work existed to prevent.

### Why the existing gate does not cover it

`environment-reset` / `environment-reseed` are **guards**, not resets:

```
environment_reset    needs=[]   task: environment:reset:verify
environment_reseed   needs=[]   task: environment:reseed:verify
playwright_e2e       needs=[]   ← does not depend on either
maestro_e2e          needs=[]   ← does not depend on either
```

The `:verify` suffix is deliberate and must stay. `tests/integration/environment-facade-gates.test.ts`
enforces it:

> `environment:reset` is a PRECONDITION a workflow calls before a suite. As a
> gate task it would run on every pull request declaring the gate required,
> converging a shared environment each time.

That test is correct and stays exactly as it is. It constrains the **gate**; it
says nothing about the nightly caller, and describes a workflow that does not
exist.

---

## Phase 1 — contract (RULED)

**Reset runs BEFORE the suite.** Cleanup-after is best-effort: it does not run
when a runner dies, is cancelled, or is evicted, so the next night starts dirty.
Reset-before makes the starting state independent of how the last run ended.

**A failed reset BLOCKS the suite.** A suite against a dirty environment
produces failures nobody can trust — the "56 failures, one broken precondition"
shape. Consequently **a missing verb is a failed reset**, not a skip.

**No no-op defaults.** Lisa must NOT ship `environment:reset` as a no-op via
`defaults` in `package.lisa.json`. A no-op that exits 0 is a vacuous green: the
suite runs against a dirty environment and reports as though it were clean —
the exact defect class removed in #2732. The job resolves the verb and **fails**
when it is absent. A project with genuinely no e2e declares the gate `off`,
which is a visible decision rather than an inferred one.

---

## Phase 2 — `environment-prepare.yml` (Lisa-owned reusable)

Runs `environment:reset` then `environment:reseed` through the façade. Takes the
target environment as an input. Fails loudly.

- Lisa owns **sequencing and failure semantics**; downstream owns what the verbs
  mean.
- Callable **only** from a nightly or dispatch workflow. Never from a PR gate.
- Must fail — not skip — when the verb is undeclared.

---

## Phase 3 — wire into the nightly reusables

Add as a `needs:` predecessor of the suite job in `maestro-native-e2e.yml` and
the Playwright equivalent.

**Maestro needs a reset between legs.** It runs iOS and Android as separate
jobs, and `🚦 Leg order` already serializes them (verified working on the
scheduled nightly 2026-08-19: leg-order held 14+ minutes while iOS ran, against
a 3-second no-op baseline the day before). Sequence:

```
prepare → iOS → prepare → Android
```

Leg-order is the existing hook. This is also the strongest argument for
reset-before: with two legs sharing one environment, "clean up when you're done"
cannot give leg two a clean start.

### Concurrency

Reset is destructive, so two suites must never hold one environment at once.
A **shared environment-level concurrency group** is required — a time-based
stagger is not sufficient:

- the two nightly crons are 2h apart, but a Maestro run now spans both legs
  (iOS alone ran 2h24m on 2026-08-18), and
- GitHub's scheduler routinely lags 20–25 minutes (09:00 cron fired 09:22 and
  09:24 on consecutive days).

---

## Phase 4 — per-repo adoption

Each nightly caller passes its target environment. Frontend A's `e2e-cleanup`
job is **removed** (ruled).

---

## Phase 5 — custom workflow cleanup

Measured workflow counts: 23, 22, 21, 12 across the four frontends, with **20+
workflows appearing in only one repo**.

Classify every single-repo workflow into one of three buckets:

1. **Genuinely project-specific** — e.g. blog/social syndication. Stays.
2. **Should be a Lisa reusable** — e.g. the `claude-*` nightly set
   (code-complexity, test-coverage, test-improvement, auto-fix), hand-rolled per
   repo. Same pattern as the Lighthouse standardisation.
3. **Dead** — e.g. `claude.yml`, already listed in `typescript/deletions.json`.

**Do not delete on a "zero runs ever" heuristic.** That made an earlier delete
list wrong in every row. Confirm each deletion with a positive control — a scan
that finds a known-good reference proves the scan works.

---

## Downstream safety contract for `environment:reset`

`resetEnvironment` TRUNCATEs. The implementation must make firing against a
non-permitted environment structurally impossible, not merely unlikely. Five
layers, and layers 1–2 are the ones that hold when the code is wrong:

1. **Infrastructure** — the lambda is deployed only to permitted stages.
   Production has no such function; the call fails because there is nothing to
   call.
2. **IAM** — the invoking role holds no `lambda:InvokeFunction` outside
   permitted stages, so even a mis-deployed function is unreachable.
3. **Lambda-side stage assertion** — refuses on its own stage identity before
   touching a client.
4. **Caller-side refusal** — the script refuses before invoking, on the same
   identity.
5. **Connected-database assertion** — refuses if the session is not on a
   recognised database, checked *after* connecting.

Layer 5 is the only one that catches a correct stage pointed at the wrong
database — a tunnel, an override, a copied env file.

**Lisa's role here is evidence, not enforcement.** Lisa cannot verify a lambda's
absence in someone's account. `environment:reset:verify` should require the
implementation to *demonstrate* its refusals rather than assert them — the shape
used by the credential-free work-item fixtures, which replace `gh`, `acli` and
`curl` with executables that refuse and say so, so a passing test proves nothing
was contacted.

---

## Sequencing

1. Land the three open PRs first (`#2733`, `#2734`, `#2735`). Two change
   `lisa apply` semantics and one changes the gate registry; building on
   unmerged changes to the same machinery produces conflicts that look like
   defects.
2. `#2733` (refuse to delete a workflow a consumer still calls) **must** be
   merged before any Phase 5 deletion.
3. Phases 2–3 are one agent. Phase 4 is another. Phase 5 last, one repo at a
   time.

---

## Hazards, all measured

- **A conflicted PR dispatches ZERO CI runs**, not failing ones. `mergeable ==
  CONFLICTING` plus `total_count == 0` is a conflict, not an outage.
- **`git stash pop` restores to the working tree, not the index.** A following
  `git commit -F` silently drops the file. Re-stage explicitly.
- **A fresh worktree needs its own install**, and that install runs Lisa's
  postinstall, which rewrites dozens of unrelated files. Stage only the intended
  edit; check `git show --stat HEAD` after committing.
- **Verify a merge by reading the file back off the branch.** A merge on
  2026-08-18 landed 2 of 3 files and reported success.
- **Some suites resolve Bun from the launching runner.** `npx vitest` fails with
  "Expected Bun's package runner" — that is the invocation failing, not the
  repo. Use `bun run test`.
- **Never work in a shared checkout.** Other sessions hold them on their own
  branches with dirty trees.
- **Stale-review test, four points not two**: review commit ≠ head, zero
  unresolved threads, the reviewer has **re-engaged on the new head**, and no
  new substantive comments. Silence on a new head is not a downgrade.

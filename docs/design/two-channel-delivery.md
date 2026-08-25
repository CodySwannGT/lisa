# Two-channel delivery: `@main` removes what only `lisa apply` restores

**The one-line test, before you write the change:**

> Does this change delete something on the `@main` channel that only an
> `apply` restores?

If yes, the two halves land in the wrong order and the property is proved by
nothing in between. Read on. If no, nothing here applies.

## The mechanism

Lisa reaches a consumer down two channels, and they do not move together.

| half | channel | reaches a consumer | needs them to act |
| --- | --- | --- | --- |
| reusable workflow body | `uses: CodySwannGT/lisa/.github/workflows/x.yml@main` | next workflow run | no |
| installed package contents | npm dependency range | next dependency bump | a bump |
| scripts, configs, declarations | `lisa apply` (copy-overwrite, merge, migrations) | next apply | an apply |
| `create-only` artifacts | scaffold time | **never** | manual adoption |

For an *additive* change the asymmetry is harmless: the new workflow finds no
declaration and falls back, exactly as designed.

**For a change that REMOVES a built-in and replaces it with something the
consumer's tree must provide, the halves are not interchangeable and they land
in the wrong order.** The removing half is live everywhere immediately. The
restoring half is live only where somebody applied. In the gap the property is
proved by nothing.

## Why it is silent

There is no failing check to notice. The replacement never runs, so it posts no
context, and **an absent required context is not a red one** — GitHub simply
never hears from it. Every instrument reads normal.

A guard makes it worse rather than better. An *unguarded* read of a missing path
fails the job loudly; a read behind `if [ -f scripts/x.mjs ]` skips, and the
gate quietly proves nothing. The skip is the dangerous shape.

## Why this is not the lesson the repository already knows

The adjacent finding is recorded: *"fixed upstream" is not "a bump brings it"* —
a create-only artifact never reaches an existing repository, so a fix can be
correct upstream and absent downstream forever.

This is its inverse, and more dangerous. There the **fix** travels slowly and
the consumer keeps the old working behaviour; the failure is an improvement that
does not arrive. Here the **removal** travels fast and the **restoration**
travels slowly, so the consumer loses behaviour it had. A slow fix is a missed
improvement. A fast removal with a slow replacement is a regression that nothing
reports.

## The acceptance criterion that was supposed to catch it had the wrong quantifier

The guarantee written to prevent this said the fallback stays until a migration
"guarantees the declaration". The migration runs on `lisa apply`, so it
guarantees a declaration **for anyone who applies** — and the population
receiving the removal is **anyone who runs the workflow**. Different sets, and
the second strictly contains the first.

An acceptance criterion can be satisfied, in good faith, by the wrong set. When
you write one for a change of this shape, name the population, not the
mechanism.

## What measures it

| surface | what it answers | where |
| --- | --- | --- |
| `bun run check:two-channel-couplings` | which caller-tree paths Lisa's own `@main` reusables read, and on which channel each arrives | `scripts/generate-two-channel-couplings.ts` |
| `scripts/two-channel-couplings.json` | the ledger — regenerated in-commit, so a new coupling is a diff a reviewer must look at | ships in the npm `files` allowlist |
| `lisa doctor` → *Two-channel delivery drift* | which of those artifacts a given consumer's checkout does not have | `src/cli/doctor-two-channel-drift.ts` |

Verdicts, and what each one costs:

- **`package-backed`** — the step names a package-relative candidate too, so the
  fast channel delivers the artifact. Not a gap.
- **`apply-lagged`** — host-only, delivered by a refreshing lane. Live everywhere
  immediately, present only where somebody applied. **Recorded, not failed**:
  fourteen of Lisa's own couplings are this, every one deliberate, and an
  allowlist that size stops being a record of decisions and becomes the bypass.
- **`never-delivered`** — host-only, `create-only`. An existing consumer never
  receives it. **Fails** unless ratified with a reason.
- **`undelivered`** — host-only, Lisa ships no such path. **Fails** unless
  ratified with a reason.

A ratification whose coupling no longer exists also fails. A permission left
behind after its subject is gone is inherited for free by the next path that
happens to match.

## The boundary against `check-workflow-package-paths.mjs`

That gate (#2960) asks whether a **package** path a workflow names survives a
release, and says explicitly that host-relative candidates "do not count and are
never extracted". This is that excluded arm. Neither subsumes the other: #2960
asks whether a packaged artifact still exists, this asks whether a caller-tree
artifact ever arrives.

## What this stage does not do

- It reads the **installed** ledger, so `lisa doctor` sees a requirement
  introduced up to one release before the consumer's package. That is exact for
  the population the defect is about — a consumer whose apply is behind — and
  blind to a requirement added to `main` after their last bump. Reading the
  ledger from `main` needs network access `lisa doctor` deliberately does not
  have.
- It measures **one consumer at a time**. A fleet sweep that reads each
  repository's default branch — never a local worktree, which is the author's
  tree and not the fleet's — is the next stage.
- It resolves lanes across **all** stacks rather than the consumer's active
  ones, which is optimistic in one direction: a path shipped `create-only` by
  one stack and `copy-overwrite` by another resolves as `apply`. Written down
  here rather than hidden inside the resolver.
- It recognises caller-tree reads that are **path literals** under `scripts/`,
  `bin/`, or `tools/`. A requirement expressed some other way — an `npm run`
  target, a config key, a declaration block — is not yet in scope.

## Refusing to pass on nothing

Zero reusable workflows, zero steps, zero couplings, or an empty delivery
inventory is a failure and never a clean sweep. Every run prints what it
inspected. An empty comparison and a converged consumer must not produce the
same output — this whole subject is failures that read as normal, and
reproducing that in the check would be perverse.

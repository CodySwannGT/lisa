# Design: reset/reseed production safety — from a check to an absence

> Status: **Design — recorded, not built.** The executable guard described in
> §3 shipped with issue #2491; the deployment-absence design in §4 has not been
> built and is tracked separately.
> Date: 2026-08-14 · Scope: the `reset-seed-coverage` contract's
> `production-fails-closed` assurance.

## 1. The problem this records

The `reset-seed-coverage` eager rule says the strongest thing in the repository:

> Production is refused with no override, escape hatch, or environment variable
> that changes the answer.

It is cited by eight skills. Until #2491, **essentially none of it was
executable.** The effective control was an agent reading prose and choosing to
stop. Conformance for that rung was measured at approximately zero across this
codebase in the same session that produced this document — including
violations by the agent that authored the rules being measured. For a
destructive, irreversible operation, that is the wrong rung.

## 2. Why a check is not the end state

A check is something a future caller can satisfy incorrectly. Three failure
modes survive any in-process guard, by construction:

1. **The guard trusts what the adapter tells it.** Every in-process check
   receives the environment identity from the adapter. An adapter that resolves
   its stage from a caller-supplied string, a build-time variable, or a hostname
   and reports `"dev"` while connected to production passes the guard while
   doing exactly the thing the guard exists to stop. Nothing inside the process
   can detect this, because the process has no independent way to ask "where am
   I really?"
2. **A guard can be refactored away.** The contract's own words: "a script-only
   promise dies in the refactor that drops the safe caller." The guard is one
   import; removing it is one line, and the removal reads as cleanup.
3. **A guard can be argued with.** A refusal is a decision made in code that a
   sufficiently motivated caller — human or agent, under deadline — will look
   for a way around, because a way around is the kind of thing that exists.

**Non-existence beats refusal.** A capability that was never deployed to
production cannot be invoked there by any argument, by any caller, whatever
anyone believes about the environment they are in. It fails closed by
construction rather than by a check someone can satisfy incorrectly or a rule
someone can decline to read.

## 3. What shipped (#2491): the executable guard

`scripts/lisa-destructive-guard.mjs`, shipped to every adopter through
`all/copy-overwrite/`, with the decision wired into `validateEnvelope` in
`lisa-command-envelope.mjs` — the one interface every reset, seed, and verify
adapter must pass through.

The properties it does establish:

- **No override exists to be found.** There is no `force` parameter, no
  `allowProduction` field, and no environment-variable read in the module. A
  test greps the shipped source for the latter, so the claim cannot rot.
- **Ambiguity resolves to refusal.** An environment identity that cannot be read
  classifies as `unresolved` and is treated exactly as production. "I could not
  tell" is never cheaper than "it is production."
- **A dry run is not a pass.** `dryRun: true` does not soften a production
  denial, so `--dry-run` cannot become a one-flag override.
- **`--dry-run` is the default, not an opt-in.** An adapter handed arguments it
  does not understand enumerates instead of mutating; mutating requires an
  explicit `--no-dry-run` or `--execute`.
- **A requested stage is never the source of truth.** It is compared against
  server-resolved identity, and a production *request* is refused even when the
  resolver disagrees — the disagreement itself means one of the two is wrong.
- **No representable success.** A destructive run against a production-resolved
  or unresolvable environment has no valid success envelope, so it can never
  exit 0. Reporting the refusal stays available, which is the only outcome that
  should be.

**What it does not establish:** everything in §2. It closes the narrower hole
Lisa can close from inside a process — an *honest* adapter can no longer report
a successful destructive production run, in any repo, by any path. It does not
and cannot make the destructive path absent.

## 4. The end state: a scoped Lambda that is not deployed to production

Each reset/reseed executes via a dedicated function with a narrowly scoped
execution role, and **that function is not deployed to the production stack at
all.** This is what the rule already asks for and does not get: "Where the
platform can enforce a boundary with roles, grants, or constraints, it does —
the in-process guard remains as defense in depth, never as the primary control."

### Failure modes the design must still close

Recorded because "it does not exist in prod" is a claim, and claims need
assertions.

1. **Absence must be asserted, not assumed.** A check verifies the function is
   absent from the production stack. Otherwise a conditional in the IaC flips
   one day and nobody learns until it matters. Assert the negative — that no
   copy of the destructive path is reachable — rather than that some copy
   behaves correctly.
2. **The execution role is the real boundary.** Scope it so that even in
   non-prod it can only touch `fixture-owned` entities. Non-existence in prod
   and least-privilege in non-prod are independent controls; ship both.
3. **Reachability across accounts.** If the non-prod function can reach
   production data by any path — assumed role, VPC peering, a shared database, a
   replicated store — its absence from the prod stack is cosmetic. Verify the
   network and IAM path, not just the deployment target.
4. **The IaC itself is the control surface.** Whatever conditionally excludes
   the function from prod deserves the same review weight as the guard it
   replaces, because it now *is* the guard.
5. **Drift detection.** Periodic verification that the function is still absent
   and the role still scoped, since both are one merge away from changing.

### Sequence

1. **Verify the platform boundary as it stands today** — for each production
   database, confirm the credentials any agent or CI runner can reach are
   structurally incapable of destructive DDL/DML. This is independent of Lisa
   and holds regardless of agent behaviour. Do this first.
2. Implement the function and its role, with the absence assertion from (1).
3. Scaffold state contracts in the backends, starting with `forbidden` on
   ledgers and payments. No backend in the fleet has one today — verified absent
   in `acmeorga/backend`, `acmeorgb/backend-v2`, `acmeorgd/acmeorgd-backend`.

## 5. Status of the original ticket's gap list

| Claim in #2491 | Status |
|---|---|
| `check-state-classification.mjs` does not ship in the `typescript`/`expo` templates | **Not accurate as of 79c56982d (2026-08-12).** `all/` is processed unconditionally for every project type, so the script lands in both. #2491 measured installed adopter repos rather than the template tree. A regression test now pins the two conditions that could silently break the fanout. |
| No backend in the fleet has a state contract | **Still true.** Out of scope for Lisa; §4 step 3. |
| The production block is delegated to each project's adapter | **Partly closed.** The envelope chokepoint now refuses to represent a successful destructive production run. Resolving the environment honestly is still the adapter's job — §2 failure mode 1. |

A separate gap found while doing this work, not in the original ticket:
`isLisaOwnedTemplate` only auto-refreshes paths containing a `lisa-` segment, so
content fixes to `scripts/check-state-classification.mjs` never reach adopters
who already have the file. This is the same undeliverable-security-fix shape as
#2374. Tracked separately.

# The `environment:*` facade contract

What a project must expose so Lisa's environment gates can prove anything about
it, and what Lisa promises not to care about.

This is defined **before** any repo implements it, per the owner's sequencing
ruling — correct over fast. Six repos were measured on 2026-08-17 and **none**
implements this facade; four use one of three ad-hoc vocabularies and two have
none at all. So this is a green-field definition for half the portfolio rather
than a rename, which is the cheapest moment to get it right.

## The measured starting point

```
repo A (fe)     e2e:reset, e2e:reset:dry-run, e2e:reset:test,
                e2e:seed:teardown, e2e:seed:test
repo B (fe)     e2e:cleanup, e2e:guard:test
repo C (be)     db:connect:{dev,staging,production}, db:psql:*, db:psql:secret:*
repo D (fe)     none
repo E (fe)     none
repo F (be)     none
```

`db:*` was explicitly superseded and is still in use. Two frontends have no
reset vocabulary at all.

## 1. The verb set is `reset` and `reseed`. Nothing else.

Not a new decision — Lisa's gate registry already declares exactly two
environment gates, and their tasks name the verbs:

| gate | task | what it proves |
|---|---|---|
| `environment-reset` | `environment:reset:verify` | the reset exists, and its guard cannot be bypassed by calling it directly |
| `environment-reseed` | `environment:reseed:verify` | the reseed exists, and its guard cannot be bypassed by calling it directly |

So the facade is:

```
environment:reset            return the environment to a known-empty state
environment:reseed           populate the known fixture state
environment:reset:verify     prove the reset's guard refuses (see §4)
environment:reseed:verify    prove the reseed's guard refuses
```

**Mapping the existing vocabularies:** `e2e:reset` and `e2e:cleanup` are both
`environment:reset` — `cleanup` is not a third verb. `e2e:seed:teardown` is
`environment:reset`, not a separate `teardown`: emptying is emptying regardless
of what filled it. `e2e:seed` is `environment:reseed`.

**`seed` is deliberately not a verb.** A project that can only seed, never
re-seed, has a fixture state that drifts with every run. `reseed` names the
requirement — reach the fixture state from *whatever* state you are in.

### The two verbs are independently optional

**A project declares whichever verbs it genuinely has.** The gate for a verb it
does not declare resolves to `off`, exactly as §Adoption already says for a
project that declares nothing. Two gates were always independent; this states
it so the list above is not read as a pair that must be adopted together.

This is not a concession — it is forced by a real project. A suite built on
**shared, long-lived persona accounts** has one engine that converges them back
to their fixture baseline, and no "empty" operation at all. It should not have
one: emptying those accounts would destroy the very fixture every spec depends
on, so the operation would have no caller and writing one would be actively
dangerous.

Two alternatives were considered and rejected:

- **Requiring both, with the missing one implemented as a refusal.** This
  manufactures a command whose only behaviour is to decline, and — worse — a
  refusal-only `reset` *passes* a `:verify` that checks "does the guard
  refuse?". It would look conformant while implementing nothing, which is the
  failure mode §4 exists to prevent.
- **Redefining `reset` as "return to the known baseline".** That collapses the
  two verbs into one: if `reset` reaches the baseline and `reseed` populates
  the fixture state, they describe the same operation. It would also silently
  change the meaning for any project that implemented "known-empty" literally.

**Which verb an engine is, is decided by what it does, not by which it is
nearer to.** An engine that converges to fixture state from whatever state it
finds is `environment:reseed` — that is §1's wording verbatim — even when it is
the only engine the project has, and even when "reset" is the more familiar
name for it.

### Each declared verb must be independently invocable

A gate invokes the verb from outside the test runner, so an operation that only
exists as a step inside a test run — a Playwright setup project, a fixture hook
— is **not** a declared verb no matter how correct its behaviour. That is an
implementation gap rather than a wiring gap, and a project in that position
declares nothing for the verb and gets `off` rather than a failing gate.

## 2. The environment is an ARGUMENT, never a name suffix

```
environment:reset --env=staging      ✅
environment:reset:staging            ❌
```

Three reasons, in order of weight:

1. **The moment already carries it.** Lisa's gate moments are
   `continuous:<environment>`, `pre-deploy:<environment>`,
   `post-deploy:<environment>`. The invoking context knows the environment. A
   name suffix encodes it a second time, and two encodings drift.
2. **A suffix multiplies scripts per environment**, which is what `db:connect:dev`
   / `db:connect:staging` / `db:connect:production` demonstrates. Adding an
   environment then means adding scripts, and forgetting one is silent.
3. **A suffix makes the dangerous case a typo away.** `environment:reset:prod`
   and `environment:reset:production` are different script names and only one
   exists; the other is a "script not found" that some runners report as a
   non-zero nobody reads. An argument can be *validated against a known set*.

**The argument is mandatory and must be validated against an allowlist.** A
missing or unrecognised `--env` MUST refuse with a non-zero exit and name the
accepted values. It must never default — least of all to a development environment, because a default
that is safe in one repo is the production default in another.

This mirrors `resolveMoment`, which was changed on 2026-08-17 to refuse an
unrecognised moment after a typo (`continous:dev`) silently resolved to an empty
gate set and reported "0 proved, 0 failed of 0 gate(s) declared" with exit 0.
The same failure is available here and the same answer applies.

**An allowlist, not a pattern — measured, not hypothetical.** One portfolio repo
deploys production under **both** `production` and `prod`. Any guard keyed on one
of those names silently misses the other, which is a live bypass rather than a
typo waiting to happen. A validated set of accepted values is the only form that
survives a repo whose environment has two spellings; a regex or a prefix match
does not. Where a project genuinely has aliases, the allowlist must contain both
and map them to one canonical target — never accept one and ignore the other.

## 3. Lisa does not care how it is implemented

`environment:reset` is an **interface, not a mechanism.** It may today shell out
to a local script and tomorrow invoke a scoped Lambda; the contract is unchanged
and the name does not move. There is no `environment:reset:remote` — a second
name for the same verb splits conformance and guarantees one of the two rots.

The ratified end state (`docs/design/reset-production-absence.md` §4) is a
dedicated function with a narrowly scoped execution role that **is not deployed
to the production stack at all**. That design's own sequence puts platform
verification first and the function second, so a project implementing this
facade today against a local script is on the intended path, not diverging from
it.

What Lisa asserts is the *boundary*, never the mechanism: that the destructive
path refuses to run against production, and that the refusal cannot be bypassed
by calling the underlying script directly.

## 4. Conformance is `:verify`, and it must prove a refusal

`:verify` is the ratified suffix — it is what the gate registry already invokes.
Not `:test` (repo A) and not `:guard:test` (repo B).

A conforming `environment:reset:verify` MUST:

1. **Prove the guard refuses a production target.** Invoke the real path against
   the production environment name and assert a non-zero exit and a refusal
   message. Asserting that a *non*-production reset succeeds proves nothing
   about the boundary.
2. **Prove the guard cannot be bypassed.** Invoke the underlying implementation
   directly — the script the facade wraps — and assert it also refuses. A guard
   that only lives in the wrapper is a guard the next agent walks around, and
   this is the specific thing the gate's summary claims.
3. **Prove a missing or unknown `--env` refuses**, per §2.
4. **Exit non-zero if it proved nothing.** A verify that finds no implementation
   must FAIL, not pass vacuously. This is the defect class that produced most of
   2026-08-17's filings: a check reporting satisfied without having proved
   anything.

`--dry-run` is optional and unreserved. Repo A's `e2e:reset:dry-run` is a useful
local affordance; Lisa neither requires nor forbids it.

## 5. What this does not define

- **Fixture content.** What `reseed` seeds is the project's business.
- **Where the state lives.** Database, object store, or a mock server.
- **Whether reset and reseed are one command.** They may share an implementation
  as long as both names exist and both verifies pass.

## Adoption

A project that exposes none of this is **not** failing the gates — the gates
resolve to `off` where nothing is declared. Adoption is opting in to having the
boundary proved. The measured portfolio state above is the baseline, and the
gap is disclosure-shaped: no repo is currently claiming a boundary it does not
have.

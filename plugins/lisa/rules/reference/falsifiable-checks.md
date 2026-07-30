# Falsifiable Checks — Reference

Eager head: [eager/falsifiable-checks.md](../eager/falsifiable-checks.md).

## Why this rule exists

The `verification` rule prevents the failure "I claimed it works without using it." This rule prevents a subtler one, one layer down: **I used a check, the check said clean, and the check was incapable of saying anything else.**

It is the more dangerous failure of the two, because the first leaves you uncertain while the second leaves you *confidently wrong* — and it terminates the investigation. A guard that cannot fail does not merely omit protection; it manufactures evidence that the defect is absent, so nobody looks again.

The empirical origin: a single defect-sweep run produced four false-passing checks and zero false fixes. Every fix was correct; every one of the four *instruments* was broken. Reviewers then found three real defects the checks had cleared. The error concentrated entirely in verification, which is why the countermeasure belongs at the check level rather than the code level.

## The four failure modes, in detail

### 1. Self-matching guard

A guard searches source text for the token it protects. The fix that satisfies the guard carries a comment explaining *why* that token is required — and the comment contains the token. The guard matches its own justification.

Observed: a guard asserting every `bioData` GraphQL selection includes `ggPlayerKey` passed with `ggPlayerKey` **deleted**, because the explanatory comment above the selection said the word. It was caught only by reverting the fix.

Countermeasures, in order of preference:
- Parse structurally (comments never enter an AST).
- Failing that, strip comments before matching — but note this is itself error-prone: naive `#`-to-end-of-line stripping also destroys `#` inside string literals.

### 2. Fixture-validated assertion

The test writes a fixture through the production path and asserts on the result — but the production path reads the *fixture* for the property under test, not the artifact the test claims to be guarding.

Observed: a cache-normalization test asserted that two entities keyed apart. It passed with the key field deleted from the query, because the cache computes its key from the **raw incoming object** (which the fixture supplied complete) rather than from the query's selection set. The test validated its own fixture.

Countermeasures:
- Add an explicit assertion binding the test to the real artifact (the document, the config, the container's actual output).
- Prefer an existing source-bound test when one exists — often a config/props snapshot already reads the real object.
- Say so in the file: label a fixture as a fixture, so the next reader does not mistake it for the binding.

### 3. Stale-artifact pass

The revert-to-verify step appears to run but silently does not change the input the check reads.

Observed: proving a guard bites by mutating a `.graphql` document and re-running codegen produced a **false pass** — the mutation made the document invalid against the schema, so codegen errored, left the previously generated file in place, and the test re-read unchanged input. The falsification attempt itself was the thing that failed.

Countermeasures:
- Assert the input actually changed (diff the generated artifact, check the generator's exit code, confirm the digest moved).
- When the artifact is generated, schema-validated, or cached, do not rely on revert-to-verify at all — unit-test the checker against synthetic known-bad input you construct in-process.

### 4. Wrong-baseline sweep

A detector reports zero hits, but ran against state where the defect was already fixed — so zero carries no information.

Observed: an uncalled-method detector returned 0 hits across 4,656 files, run on the branch where both instances were already fixed. Re-run against the pre-fix ref it found exactly the 2 known instances, which is what made the zero meaningful.

Countermeasure: every detector reporting a zero must first be shown to find known instances on a ref where they exist (`origin/<base>`, the pre-fix commit, or a synthetic fixture).

## What a negative result is scoped to

A clean result is a statement about what the check can perceive, not about the code. State the boundary:

- **Presence vs. value.** A check that a field exists cannot see that its value is wrong. A field whose value is a stringified function is *present*. Real instance: `new Date().toISOString` (missing call parens) passed a presence-diff, produced a byte-identical constant id on every call, and collided every optimistic cache entry.
- **Reachability.** A textual match is a candidate, not a defect. Candidates die on: dead code (nothing references the fragment/function), configuration that bypasses the mechanism (`fetchPolicy: "no-cache"` never normalizes), and upstream guards (a button that disables itself makes a state-based re-entry guard redundant). In one sweep, 14 candidates reduced to 3 real and then to 1 user-facing.
- **Class completeness.** Fixing one instance of a defect class is not fixing the class. Real instance: a cache-id collision was fixed in one file while an instance of the *same class* sat two lines from an active edit in another; a reviewer caught it. After identifying a class, sweep for it — and prefer a repo-wide guard over a local fix so the class cannot regrow.

## How to apply

1. Author the check.
2. Deliberately break the guarded property.
3. Confirm the check **fails and names the right file/line**. A failure that does not localize is weak evidence the check is measuring the right thing.
4. Restore, and confirm green again.
5. Report the falsification alongside the result.

For generated or validated inputs, replace steps 2–4 with a direct unit test of the checker against synthetic bad input.

**A check whose failure has never been observed is reported as `unvalidated`, not as passing.** "Mentally reverting" does not satisfy step 3 — the author of a guard already believes it is load-bearing, so reasoning about the failure reproduces the belief rather than testing it. `unvalidated` is a legitimate state to report and land; silently presenting an unfalsified gate as a passing one is not.

## Reporting template

> `<check name>`: <result>. Falsified by <the deliberate break>, which failed as
> `<observed failure, ideally the located name>`. Blind spots: <what this check
> cannot see>.

Concretely:

> Repo-wide keyFields guard: 0 violations across 27 documents. Falsified by moving
> `Username` one level deeper into `Attributes`; the guard failed naming
> `activity-feeds/operations.graphql:28`. Blind spot: matches by field name, not
> resolved schema type.

## Interaction with other rules

- **`verification`** — proves the software behaves as a user needs. This rule proves the proof is real. Codified regression tests added under `codify-verification` are subject to this rule: a codified spec that cannot fail is not a regression gate.
- **`empirical-inquiry`** — settles an uncertain fact with the cheapest probe. A probe is a check, so it inherits the falsification requirement, including deliberate bite controls (cases that MUST report a problem) when the probe's job is to detect problems.
- **`claim-evidence-mapping`** — an unfalsified gate cannot back a claim.
- **`stale-state-claims`** — the sibling failure from the opposite direction: an assertion of state that *could* fail but is never re-evaluated, because nothing re-runs prose. Binding a temporal claim to a check is the recommended fix there, which puts that check under this rule.

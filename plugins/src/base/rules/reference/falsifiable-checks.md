# Falsifiable Checks — Reference

Eager head: [eager/falsifiable-checks.md](../eager/falsifiable-checks.md).

## Why this rule exists

The `verification` rule prevents the failure "I claimed it works without using it." This rule prevents a subtler one, one layer down: **I used a check, the check said clean, and the check was incapable of saying anything else.**

It is the more dangerous failure of the two, because the first leaves you uncertain while the second leaves you *confidently wrong* — and it terminates the investigation. A guard that cannot fail does not merely omit protection; it manufactures evidence that the defect is absent, so nobody looks again.

The empirical origin: a single defect-sweep run produced four false-passing checks and zero false fixes. Every fix was correct; every one of the four *instruments* was broken. Reviewers then found three real defects the checks had cleared. The error concentrated entirely in verification, which is why the countermeasure belongs at the check level rather than the code level.

## The five failure modes, in detail

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

### 5. Pager-shadowed status

The check is correct, it ran, and it failed. The *reading* of it is what reported green.

A shell pipeline's exit status is the status of its **last** stage. So this reports on `tail`, not on the gate:

```
$ node scripts/plugin-parity-drift.mjs 2>&1 | tail -4; echo "exit=$?"
| ... | safety-net@cc-marketplace | 1.0.6 | 2.0.4 | stale |
1 of 5 synced skills drifted
exit=0                      <-- tail's exit code

$ node scripts/plugin-parity-drift.mjs > drift.log 2>&1; echo "REAL exit code: $?"
REAL exit code: 1
```

This one is worth stating separately from the other four because of *where* it occurs. The other four are defects in a check. This is a defect in **how a correct check gets read**, and the reading happens at exactly the moment someone is deciding whether they are blocked. It is also self-similar in an unhelpful way: it defeats verification while looking like verification.

The pipe is there to keep the output short — which means the failure line is the line most likely to fall outside the window. In the transcript above the tool happened to print its verdict inside `tail -4`, so a careful reader could catch it. That is luck about one chatty tool. A quiet gate that fails with no output produces `exit=0` and an empty, plausible-looking tail, and gets recorded as green.

#### The one spelling to use

Capture the status first; shorten afterwards.

```sh
gate >gate.log 2>&1; status=$?
tail -20 gate.log
[ "$status" -eq 0 ] || echo "FAILED ($status) — full output in gate.log"
```

`status=$?` must be the very next thing after the command: `$?` holds only the most recent status, and even `echo` overwrites it.

#### Why this one and not the other two

| Spelling | Works in | Does not work in | Keeps full output |
|---|---|---|---|
| redirect, then read `$?` | every POSIX shell, `sh` included | — | yes |
| `set -o pipefail` | bash, zsh, ksh, POSIX Issue 8 shells | **not POSIX `sh`** — dash has no such option, and GitHub Actions' default `run:` shell is `bash -e {0}`, with `-e` but no pipefail | no |
| `${PIPESTATUS[0]}` | bash | zsh spells it `$pipestatus[1]` and indexes from 1; absent from `sh`. Overwritten by the next command, so it must be read immediately | no |

The redirect form wins on both columns that matter here. It is the only one that survives `sh` — this repository runs hooks under `sh` — and it is the only one that still has the untruncated output at the moment the status tells you to go look at it. `pipefail` is the right thing to add to a *script* you control; it is not a substitute for this when you are reading a gate at a prompt.

#### It is not hypothetical, and not only about `tail`

`security-floors.yml` ran `node scripts/check-security-floors.mjs --strict | tee -a "$GITHUB_STEP_SUMMARY"` with no `pipefail`. Every failure `--strict` exists to raise — a dependency floor below a live advisory, a rate-limited inconclusive run, an unresolved `$name` — was discarded, and the job reported green. Measured:

```
bash -e             -c 'node -e "process.exit(1)" | tee /dev/null' -> 0
bash -e -o pipefail -c 'node -e "process.exit(1)" | tee /dev/null' -> 1
```

`tee` is the same mechanism as `head`/`tail`: a last stage that reports on its own writing rather than on the command upstream.

#### The executable half

`scripts/check-pipeline-status-reads.mjs` sweeps shipped shell scripts and workflow `run:` blocks for the pattern. It reports **how many pipelines it inspected** and exits 2 — not 0 — when that count is zero, because an empty inspection and a clean tree otherwise print the same tick.

## What a negative result is scoped to

A clean result is a statement about what the check can perceive, not about the code. State the boundary:

- **Presence vs. value.** A check that a field exists cannot see that its value is wrong. A field whose value is a stringified function is *present*. Real instance: `new Date().toISOString` (missing call parens) passed a presence-diff, produced a byte-identical constant id on every call, and collided every optimistic cache entry.
- **Reachability.** A textual match is a candidate, not a defect. Candidates die on: dead code (nothing references the fragment/function), configuration that bypasses the mechanism (`fetchPolicy: "no-cache"` never normalizes), and upstream guards (a button that disables itself makes a state-based re-entry guard redundant). In one sweep, 14 candidates reduced to 3 real and then to 1 user-facing.
- **Class completeness.** Fixing one instance of a defect class is not fixing the class. Real instance: a cache-id collision was fixed in one file while an instance of the *same class* sat two lines from an active edit in another; a reviewer caught it. After identifying a class, sweep for it — and prefer a repo-wide guard over a local fix so the class cannot regrow.

## How to apply

1. Author the check.
2. Deliberately break the guarded property — specifically, introduce **the exact regression the guard exists to prevent**, not a nearby or convenient break.
3. Confirm the check **fails and names the right file/line**, then read the failure count and the failing test *names* per the yardstick below.
4. Restore, and confirm green again.
5. Report the falsification alongside the result.

### The failure count is part of the evidence

Step 3's cardinality is not pedantry; each deviation names a distinct defect. Run it as four steps, in this order:

1. **Neuter the protection in production code** — delete the branch, drop the token from the enum, remove the check. Editing a *test* proves nothing about the guard; it only proves the test file is loaded.
2. **Run the whole suite.** Never a single test file, and never a path filter.
3. **Count the failures and read their names.** The count alone is ambiguous; the names are what separate "several failures of one regression" from "several unrelated failures."
4. **Revert, and confirm green again.**

Then read the result:

- **Zero failures** — the guard is inert. It was authored, it is green, and it asserts nothing about the property it names. Two real instances: a guard pinned one field of a structure and the regression it was written to stop walked through it with all fifty tests green; and removing either `conflicting` or `unreadable` from `design-source-gate.mjs`'s `VIOLATION_STATUSES` failed **0 of 38 tests** while flipping the gate's verdict from FAIL to PASS.
- **Many failures, unrelated to each other** — the break is too coarse, the guard is over-broad, or unrelated tests share a fixture. Any of the three means the guard's next real failure will not tell the reader what broke, which is most of a guard's value.
- **Exactly one failure, or several all named for the same regression** — the guard localizes. Both readings are load-bearing and correctly scoped. Removing the two-token `--config-env` check failed **3** tests and pinning an index failed **5**; every failing name in both runs described the removed behaviour, so both guards were correct. This is a reading exercise, not arithmetic — "more than one is bad" is the wrong rule.

### A zero is robust to contention; a positive count is not

The obvious objection to any cardinality measured on a shared machine — *"your probe ran on a loaded box, so how do you trust the number?"* — has an asymmetric answer, and the asymmetry is worth stating because it decides which numbers you must re-measure.

**Load can only add failures, never remove them.** A test that passes under contention would also have passed on a quiet machine; contention causes timeouts and lock races, which turn green into red, never red into green. So:

- **A zero stands regardless of what else was running.** If the whole suite reports zero failures attributable to your mutation on a loaded box, a quiet box cannot produce fewer. `0 of 11,270` is `0 of 11,270`.
- **A non-zero count needs a quiet machine**, because contention inflates it. Failures that are really flakes get miscounted as the guard's, which reads as "over-broad" and gets a correctly-scoped guard deleted.

Practical consequence: an inert-guard finding is safe to report from a busy machine, while the "exactly one, or several all named alike" reading is only trustworthy once you have separated your mutation's failures from the load-flake population — which is what reading the *names* is for.

### Two reasons a real protection reports zero

A cardinality of zero has two distinct innocent causes, and they need different fixes. Rule out both before concluding a guard is inert:

1. **Wrong probe scope** — the probe was scoped to a filename or path and is blind to a split suite. Fix: run the whole suite.
2. **Wrong quantifier** — the assertions are existential over a corpus that contains duplicates, so a correct copy satisfies them on the broken copy's behalf. Fix: assert the universal negative.

### Never scope the probe by filename

**A cardinality probe scoped to a filename reports zero when a suite splits. Follow the protection, not the path.**

Observed live: a reviewer neutered `before_end_of_options` (an end-of-options security fix), grepped `block-direct-issue-create.test.ts` for coverage, found none, and reported **cardinality 0 — the fix ships untested**. It was relayed as fact and used to question the author's discipline. Re-measuring against the whole suite showed neutering the protection fails **4** tests, each named for it: the suite had split at the 300-effective-line lint ceiling, and the declaration arm — including all five end-of-options tests — had moved to `block-direct-issue-create-declarations.test.ts`.

The false negative fires exactly where this repo is most likely to split a file: at the line cap, on the suites that have grown *because* someone added protections to them. So:

- Never scope the probe by filename or path filter.
- Never infer absence of coverage from a grep. A grep locates text; it cannot enumerate what a mutation breaks.
- A prior cardinality-0 finding measured with a path-scoped probe must be **re-measured** with a whole-suite probe before anyone acts on it.

### Assert that no copy is wrong, not that some copy is right

A test asserting that the **correct** marker is *present* passes trivially when the corpus happens to state it twice — the second statement satisfies the assertion no matter what the first one says, so the test survives the exact edit it exists to catch. The falsifiable form asserts the **wrong** spelling is *absent*: it has no second copy to fall back on, and it goes red the moment the wrong form reappears.

Stated as quantifiers, which is the general form:

- **Existential** — *"some copy says the right thing"* — is trivially satisfied by any other copy. A wrong copy is undetectable.
- **Universal negative** — *"no copy says the wrong thing"* — cannot be satisfied by a correct copy elsewhere.

Observed: a suite over a corpus containing two copies of the same rule returned **cardinality 0** on a real mutation because every assertion was existential. Rewriting the assertions to universal negatives — same code, same corpus, only the quantifier changed — took the same mutation from **0 to 18** failures. The defect it had been hiding: one PR pinned the *execution-step* copy of a rule and left the *gate* copy entirely unpinned, so reverting the gate's "absent section means underivable — never `false`" back to "means `false`" failed **0 of 11,270 tests** while the validator's documented gate contradicted its own execution step.

### Enumerate the property, not the known-bad instance

A universal negative against one hard-coded wrong spelling still only sees that spelling. Assert the **property** instead: *every* marker uses an em-dash catches the en-dash and the missing dash too, which `not.toContain("<one wrong spelling>")` never would. When that generalisation was made, it went red immediately on a wrong marker its own author had just written into rule prose — the discipline catching the person applying it, in the same run.

### Never narrate a red state you did not run

A guard's red leg, a "before" state, a reproduction of a fixed defect: each is an **observation**, and an observation you did not make is a fabrication however sound the reasoning behind it. The originating incident here was an evidence file asserting "working tree clean" while listing two untracked scripts a few lines further down — internally contradictory, because the clean-tree line was reasoned rather than run.

When the red state no longer exists in your working tree — it was fixed, or it lives at an earlier commit — **reconstruct it in a throwaway detached-HEAD worktree** and run it there:

```
git worktree add --detach <scratch-path> <sha>
# run the check in <scratch-path>, capture the real output
git worktree remove <scratch-path>
```

This costs seconds, leaves your working tree untouched, and produces genuine output. There is no situation in which writing down what the command *would* have printed is preferable to running it.

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

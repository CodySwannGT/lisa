# Falsifiable Checks — A Check That Cannot Fail Is Not Evidence (load-bearing)

A passing test, a clean lint run, a zero-hit sweep, a green ratchet: each is evidence **only if that check is known to be capable of failing.** Otherwise it is a checkbox, and a green suite that protects nothing is worse than no suite — it actively suppresses the search for the defect.

**Before reporting any clean, zero, or passing result from a check you authored or modified, prove it fails on known-bad input.** Break the thing being guarded, confirm the check fails *and names the right location*, then restore. That falsification is part of the deliverable, not an optional extra.

This is the instrument-validity counterpart to the `verification` rule (which proves the *software* behaves) and `empirical-inquiry` (which proves a *fact*). All three reject "it looks correct." This one rejects "the check said so."

When the check was **prescribed by a work item** rather than authored here — "that named test must go red, or the fix did nothing" — `control-reachability` governs instead, and it inverts the cost: a control whose fixture never reaches the changed path stays green for an unrelated reason, and the item's own stopping rule then reverts a correct fix.

## The five ways a check silently measures nothing

Each has been observed in real runs; each reported success while asserting nothing:

1. **Self-matching guard** — the check's own explanatory comment, docstring, or ticket prose contains the token it searches for, so it matches itself. It passes with the guarded field deleted.
2. **Fixture-validated assertion** — the assertion reads the test's own fixture rather than the artifact under test. Common when the production path consumes a *raw* input the fixture supplies directly.
3. **Stale-artifact pass** — the revert-to-verify step silently failed (generator errored, cache served old output, build skipped), so the check re-read unchanged input and "passed".
4. **Wrong-baseline sweep** — the detector ran against already-fixed state, so its zero is uninformative. Validate detectors against a ref where the defect still exists.
5. **Pager-shadowed status** — the check ran and FAILED, but its result was read through a pipe. A shell pipeline's exit status is its LAST stage's, so `gate | tail -4; echo $?` reports `tail`'s success. Shortening output is exactly what one does while checking whether a gate passed, and the failure line is exactly what the shortening drops.

## Mandatory

- **Read the command's own status, never a pipeline's.** When the answer decides whether you are blocked, redirect first and read the status before shortening anything — one spelling, portable to every shell including POSIX `sh`:

  ```sh
  status=0
  gate >gate.log 2>&1 || status=$?    # `||`, not `;` — see below
  tail -n 20 gate.log                 # shorten for reading, not for deciding
  [ "$status" -eq 0 ] || echo "FAILED ($status) — full output in gate.log"
  ```

  `|| status=$?` rather than `; status=$?`, because the `;` form is itself a silent-measurement bug under `set -e`: errexit kills the shell on the failing command and the assignment never runs, so the branch that reports the failure is unreachable in exactly the case it exists for. The left side of `||` is exempt from errexit, which is why this spelling survives both `set -e` and its absence — and why `status` is initialized, since on success nothing assigns it.

  When the block's **own** status is what gets read — a hook, a CI step, a script someone runs with `&&` — end it with `exit "$status"` (or `return "$status"` in a function). Without that, the last command is the `echo` and the block exits 0 after printing `FAILED`: the same pager-shadowing one line further out.

  This form is preferred over the alternatives because it is the only one that both survives `sh` and keeps the full output, which is what you need the moment the status says the gate failed. `set -o pipefail` is correct where it exists but is **not POSIX `sh`** — dash has no such option, and this repository runs hooks under `sh`. `${PIPESTATUS[0]}` is **bash-only** (zsh spells it `$pipestatus[1]`, 1-indexed) and is overwritten by the very next command, so it must be read immediately. Never report a gate as green from a status read through `| tail`, `| head`, or `| tee`.
- **Falsify before reporting.** No clean result is reportable until the check has been shown to fail on a deliberate break. **"Mentally reverting" does not count** — reasoning that the assertion *would* fail is precisely the step that lets a non-functional guard ship, because the author already believes it is load-bearing. Run the break.
- **Mutation-prove the guard, then read the cardinality.** Neuter the protection **in production code**, run the **whole suite**, count the failures and **read their names**, then revert. **Zero** ⇒ the guard is inert (one pinning a single field shipped with all 50 tests green while the regression walked through). **Many, unrelated** ⇒ over-broad; its next failure will not name the cause. **Exactly one, or several all named for the same regression** ⇒ load-bearing and correctly scoped. A **zero is robust to contention** — load only ever adds failures — so only the non-zero counts need a quiet machine.
- **The automated mutation gate is language-scoped; the manual probe above is not.** Stryker instruments the JavaScript and TypeScript family plus Vue, HTML and Svelte — there is **no shell parser**, so a guard whose logic lives in `.sh` yields no mutants under **any** `mutate` list. Adding one does not measure it: it aborts the whole run (`No parser registered for .sh!` — measured, not inferred) and takes every other guard's score with it. So a mutation gate that stays grey or green on a shell-guard change **measured nothing about that guard**, and reading it as coverage is the fifth failure mode above wearing a config file. Shell guards are covered by **driving tests only**: execute the script against a payload table and assert the blocked/allowed verdict, with a control on **both** sides — a refusal case *and* an allowed case. A shell guard nothing executes has no bite evidence at all, whatever the gate printed.
- **Never scope the probe by filename, and never infer absent coverage from a grep.** Suites split at the line cap, so a protection's tests often sit in a sibling file: a filename-scoped probe reported cardinality 0 on a live security fix that a whole-suite run showed failing 4 tests, every one named for it.
- **Assert that no copy is wrong, not that some copy is right.** An existential assertion over duplicated content is satisfied by the correct copy and cannot see the broken one — rewriting one suite's assertions to universal negatives took the same mutation from **0 to 18** failures. Enumerate the property (*every* marker uses an em-dash), never the one known-bad spelling.
- **Reconstruct a red state; never narrate one you did not run.** Evidence describing a failing or dirty state must come from a run you actually observed — an evidence file once claimed "working tree clean" while listing two untracked scripts in the same file. To observe a state that no longer exists, check that commit out in a **throwaway detached-HEAD worktree** and run it there. Writing down what the output would have said is fabrication, however confident the reasoning.
- **Say how it was falsified.** "0 findings" alone is not a result; state what you broke and that the check caught it. A gate whose falsification is untested must be reported as *unvalidated*, not as passing.
- **Prefer structural over textual checks.** Parse the AST/structure instead of matching source text: text matching cannot distinguish a field from a comment, an alias, or a nested occurrence, and it produces false positives that mask the real ones.
- **A negative result is scoped to what the check can see.** State the blind spot. A presence check cannot see a wrong value; a per-file check cannot see a cross-file interaction; fixing one instance of a class is not fixing the class — sweep the class.
- **When revert-to-verify is unreliable** (generated artifacts, schema-validated inputs, caches), unit-test the checker directly against synthetic known-bad input instead.

Full prose, worked examples, and the reporting template: [reference/falsifiable-checks.md](../reference/falsifiable-checks.md).

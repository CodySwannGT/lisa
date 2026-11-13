# Falsifiable Checks (load-bearing)

A check that cannot fail is not evidence. Before you report a clean result from a check you wrote or changed, break the guarded property and confirm the check fails at the right location. Then restore it, and say what you broke. If you did not falsify a check, report it as unvalidated.

- Read the command's own exit status. `gate | tail` reports the status of `tail`, so use `gate >log 2>&1 || status=$?`.
- To mutation-prove a guard, disable it in production code, run the whole suite, and read which tests fail. Zero failures means the guard is inert.
- Assert that no copy is wrong, not that one copy is right. Do not narrate a failing state you did not run.
- Stryker cannot mutate shell. Test a shell guard by running it on a case it must refuse and a case it must allow.

Failure modes and examples: [reference/falsifiable-checks.md](../reference/falsifiable-checks.md).

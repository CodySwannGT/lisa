# Control Reachability — A Prescribed Control Must Reach the Changed Path (load-bearing)

A work item may hand the implementer a falsifiable stopping rule: *"make the change; `<named existing test>` must go red. If it still passes, the fix did nothing."* That is good practice — it replaces eyeballing with an observation. It is also **only valid if that test's fixture exercises the path the change touches.**

When it does not, the test stays green **for a reason unrelated to the change**: execution never reached the changed code. The stopping rule then instructs the implementer to revert a correct fix, and the more faithfully the implementer follows the item, the more reliably it happens. Measured once in the portfolio: a pinned test's fixture omitted the field the fix read, execution fell through to a default branch, the test stayed green, and the fix had worked.

This is the specification-side sibling of `falsifiable-checks`, which governs a check *you authored*. Here the check is **prescribed by the work item** and the defect is in the prose, not the code.

## Authoring obligation — checkable, not advisory

**A work item that names an existing test as a red-before-green control must say what makes that test reach the code the change touches.** Naming the code is not enough; the item names the *input*.

Declare it in `## Validation Journey`, one marker per named control:

```text
[CONTROL: <test-identifier> | reaches: <input-or-field>]
```

- `<test-identifier>` — non-empty: the test file path, the test name, or both.
- `reaches:` — the literal key, then the **input, field, fixture key, argument, or state** that carries execution into the changed code. `reaches: the fix` and `reaches: the changed code` restate the assertion and do not satisfy it.

Enforced by gate **S20** in `lisa-jira-validate-ticket`, `lisa-github-validate-issue`, and `lisa-linear-validate-issue`; rendered by `lisa-jira-write-ticket`, `lisa-github-write-issue`, and `lisa-linear-write-issue`; read at claim time by `lisa-ticket-triage` and `lisa-implement`.

**An item that prescribes no existing-test control is exempt.** Introducing a *new* test carries no reachability obligation — the gate is `N/A` and the item is never reported as incomplete on this basis.

## Implementer obligation — a green control is two facts, not one

`lisa-tdd-implementation` and `lisa-reproduce-bug` bind this arm: **when a prescribed control does not change state as the item predicted, stop. Establish which cause holds before acting on the stopping rule.**

| Cause | Correct action |
|---|---|
| The change had no effect on behaviour | Revisit the change |
| The fixture never reaches the changed code path | Fix or extend the control — do **not** revert |

They demand opposite actions, and the cheaper reading ("the fix did nothing") wins by default when nothing forces the distinction. So force it: **prove reachability by execution, never by reading the fixture.** Put a temporary throw, log line, or counter in the changed code and run that one test; or run coverage scoped to it and read whether the changed lines were hit. Reasoning that the fixture *looks like* it reaches the path is the same move `falsifiable-checks` rejects as "mentally reverting".

**Never revert on an unexplained green.** An unexplained control is a blocked observation, not a verdict — and a reachable-but-still-green control is the only form of it that licenses revisiting the change.

Full prose, the worked instance, and the reporting template: [reference/control-reachability.md](../reference/control-reachability.md).

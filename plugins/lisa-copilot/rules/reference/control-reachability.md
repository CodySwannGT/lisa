# Control Reachability — reference

> Demoted from the always-on eager tier by CodySwannGT/lisa#3992. The
> section below is the former eager head, preserved verbatim; the full
> contract follows it. Reachable on demand via `rules/eager/00-rule-index.md`.

## Control Reachability — A Prescribed Control Must Reach the Changed Path (load-bearing)

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

---

The full body behind the `control-reachability` eager head. It defines one vendor-neutral contract consumed by the three tracker writers (`lisa-jira-write-ticket`, `lisa-github-write-issue`, `lisa-linear-write-issue`), the three validators (`lisa-jira-validate-ticket`, `lisa-github-validate-issue`, `lisa-linear-validate-issue`) via gate **S20**, and the implementer surfaces `lisa-ticket-triage`, `lisa-tdd-implementation`, `lisa-reproduce-bug` and `lisa-implement`. Each surface cites this slug rather than growing its own prose, exactly as the vendor arms cite `leaf-only-lifecycle`, `repo-scope-split` and `derived-branch-plan`. One slug is what keeps a control rejected on JIRA from being accepted on Linear.

## The measured instance

A work item in a consumer lane named a real, existing test, stated a real expectation about it, and prescribed a stopping rule in substance:

> Make the change; that pinned test must go red. If it still passes, the fix did nothing.

On its face this is exemplary. It hands the implementer a falsifiable stopping condition instead of asking it to judge the result by eye, and it is the shape Lisa's own `falsifiable-checks` rule asks for everywhere else.

**The test still passed, and the fix had worked.** The pinned test's fixture omitted the field the fix reads, so execution fell through to a default branch. The test stayed green **for an entirely new reason** — not because behaviour was unchanged, but because the fixture never reached the changed path. Following the item's own stopping rule would have reverted a correct fix. A human noticed; an unattended agent following the written rule would not have.

## Why this failure mode is distinct

Lisa already carries a family of rules about controls that do not bite. This one is the mirror image, and the difference is what makes it worth its own slug.

| | The familiar family (`falsifiable-checks`) | This rule |
|---|---|---|
| Where the defect lives | The check the author wrote | The **specification** that prescribes the check |
| Failure mode | The control **fails to bite** — passes something it should catch | The control **bites in the wrong direction** |
| Cost | A defect ships | A **correct fix is reverted** |
| How it looks | A green check nobody questions | Diligence — the agent followed the written stopping rule |
| Who it hits hardest | Careless implementers | **Disciplined** implementers |

It sits in the layer everyone treats as the thing that catches implementation error, which is exactly why nothing was watching it.

Related, at other layers: a gate that blocks a slow reviewer but only reports a hollow one is a gate mis-weighting two real signals; a gate that declares a merge condition nothing verifies is an unverified assertion in config. Here the signal itself is uninterpretable, and it is verified by an agent — incorrectly.

## Why the checkable form, and why a marker

The obvious fix is a sentence of guidance: *"make sure the fixture reaches the path."* That is the wrong instrument, and it is worth being explicit about why, because it will look like the simple answer every time someone revisits this.

**This failure is itself an instance of advisory guidance being insufficient.** A thoughtful author wrote a thoughtful stopping rule and it was still wrong. Prose asking for more thoughtfulness is the same class of artifact that failed. So the obligation is expressed as a **parseable declaration** a validator either finds or does not, in the same family as the `[EVIDENCE: <type>: <name>]` manifest markers — which exist for the same reason, and which turned "attach proof" from a discipline into a property.

The marker also moves the check **earlier**. A prose instruction can only be evaluated at the moment the stopping rule misfires, by the one agent least able to see past it. A marker is checked before work begins, by a validator that has no stake in the outcome.

## The marker

```text
[CONTROL: <test-identifier> | reaches: <input-or-field>]
```

Placed in `## Validation Journey`, one per named control. Parse by the exact `[CONTROL:` prefix and split on the single `|`.

| Field | Requirement |
|---|---|
| `<test-identifier>` | Non-empty. The test file path, the test name, or both. It must be enough to run the test. |
| `reaches:` | The literal key, then a non-empty description of the **input, field, fixture key, argument, or state** that carries execution into the changed code. |

Worked examples:

```text
[CONTROL: tests/unit/pricing/discount.test.ts "applies tier discount" | reaches: fixture sets tier="gold", which is the field the resolver newly reads]
[CONTROL: spec/models/invoice_spec.rb#late_fee | reaches: seeded invoice has due_on in the past, entering the overdue branch]
```

Rejected, with the reason:

| Marker | Why it fails |
|---|---|
| `[CONTROL: discount.test.ts]` | No `reaches:` half — names the control without saying what makes it observe the change |
| `[CONTROL: | reaches: tier field]` | Empty identifier — nobody can run it |
| `[CONTROL: discount.test.ts \| reaches: the fix]` | Restates the assertion instead of naming an input |
| `[CONTROL: discount.test.ts \| reaches: the changed code path]` | Same — names the code, not what gets execution there |

**The marker answers one question: what in this fixture gets execution to the changed lines?** Anything that does not answer it is a control whose reachability cannot be stated, and a control whose reachability cannot be stated is not a control.

## Gate S20 — when it applies, and when it must stay silent

S20 applies when the body — Acceptance Criteria, Technical Approach, or Validation Journey — names an **existing** test AND predicts a state change for it when the work lands. Signals: "must go red", "currently passes and must fail", "fails before the fix and passes after", "if it still passes the fix did nothing", or any equivalent stopping rule.

It is `N/A` otherwise, and that half of the contract is load-bearing. **An item that introduces a new test rather than pinning an existing one carries no reachability obligation** and must never be reported as incomplete on this basis. A gate that fires on every work item is a gate teams learn to route around; the value of S20 is that a FAIL means something specific.

The remediation names the input, not the discipline:

> Name the input or field that makes `<test>` reach the code this work changes, as `[CONTROL: <test> | reaches: <field>]`. If the fixture does not reach it, the test cannot observe this change — extend the fixture or specify a new test instead.

`product_relevant: true`. An unfalsifiable stopping rule is a specification defect, and the person who wrote the item is the person who can fix it.

## The implementer arm — a green control is two facts

The authoring gate catches what it can see before work starts. It cannot see the actual test outcome, and only the implementer can. So the contract has a second arm, bound by `lisa-tdd-implementation` (RED phase) and `lisa-reproduce-bug` (when an existing test is reused as the reproduction):

**When a prescribed control does not change state as the item predicted, stop. Establish which of the two causes holds before acting on the stopping rule.**

| Cause | Correct action |
|---|---|
| The change had no effect on behaviour | Revisit the change |
| The fixture never reaches the changed code path | Fix or extend the control — do **not** revert |

Two properties of this make it worth writing down rather than trusting to judgement:

1. **The actions are opposite.** Getting the cause wrong does not degrade the outcome, it inverts it.
2. **One reading is cheaper than the other.** "The fix did nothing" requires no further work and closes the question; "the fixture never got there" requires an investigation. Left to default, the cheap reading wins — and it is the one that reverts working code.

### How to establish it

**Prove reachability by execution, never by reading the fixture.** Reasoning that the fixture *looks like* it reaches the path is exactly the "mentally reverting" move `falsifiable-checks` rejects, and for the same reason: the person doing the reasoning already believes the answer.

Two sound methods, in order of preference:

- **Instrument the changed code.** Put a temporary `throw` — not a log line, which can be swallowed by a reporter — at the top of the changed block, run that one test, and read whether it errors. Then remove it. A throw is preferred because its absence is unambiguous.
- **Coverage, scoped to the single test.** Run the project's coverage tool over that test alone and read whether the changed lines were executed. Whole-suite coverage does not answer this: some *other* test reaching those lines tells you nothing about this control.

Then report which method was used and what it showed. "The control stayed green because the fixture never set `tier`, confirmed by a throw at the resolver that the test did not hit" is a finding. "The control stayed green" is not.

### Never revert on an unexplained green

An unexplained control is a **blocked observation**, not a verdict. The only state that licenses revisiting the change is a control proven to reach the changed path and still not move. If reachability cannot be established at all — the harness will not run, the code path is unreachable from any fixture — that is a finding to report, and the work item's stopping rule is void until someone repairs the control.

Fixing the control is ordinary work, not scope creep: extend the fixture with the field that carries execution to the change, or write the test the item should have named. Either way the control ends the work able to observe the change, which is what the item asked for in the first place.

## What this rule does not claim

Stated plainly so nobody reads more into it than the evidence supports.

- **Frequency.** One measured instance. No count exists of how many work items name an existing test as a red-before-green control, so the rate could be rare or routine. The gate is cheap and `N/A` by default, which is the right shape for an unknown denominator.
- **Detectability by tooling.** Whether any existing gate could *automatically* detect a fixture that does not reach the changed code path is unexamined. Coverage-diff and per-test path instrumentation are plausible and would strengthen this rule into a machine check rather than a declaration; so is the possibility that nothing available does it cheaply. This contract deliberately requires a **declaration** an author writes and a validator parses, which is checkable today.
- **Blast radius of the observed instance.** The fix was not reverted, because a human noticed. That an unattended agent would have reverted it is inferred from the written stopping rule, not observed.
- **That an advisory rule would not have helped.** Untested. It is a reason to prefer the checkable form, not a measured finding.

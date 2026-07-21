# Dependency Internalization Kit

Taking a dependency is a decision about trust: we believe someone else's code
works. Dropping one reverses that decision without reversing the obligation —
the capability still has to work, and now it is ours. The risk does not
disappear at the moment the package is uninstalled; it **changes shape**, from
"is upstream trustworthy?" to "did we actually rebuild what upstream did?"

The confidence-rebuild kit is the standing answer to that second question. It is
a reusable set of acceptance criteria that any removal, replacement, or
internalization work item inherits, so the evidence bar is decided once instead
of guessed at per ticket by whoever happens to write the tests.

The kit pairs with the other two dependency surfaces:
`.lisa/DEPENDENCY_DECISIONS.md` records *what we decided*, the
[dependency-trust-classes](dependency-trust-classes.md) rule says *what bar the
dependency had to clear to be there*, and this kit says *what proof we owe when
we take the capability back*.

## The seven required evidence types

Each is stated as the plain question it answers, because the person deciding
whether a removal is safe to ship is often not the person who wrote the code.

### 1. Real corpus — did we test it on real inputs, not toy examples?

The replacement must be exercised against **representative real inputs** drawn
from actual usage: production samples, recorded fixtures, historical files, real
config, the actual shapes the old dependency saw. Hand-written happy-path
examples are not a corpus. They are written by the same person who wrote the
implementation, from the same mental model, so they agree with the bug.

The acceptance criterion names where the corpus came from and roughly how big it
is. "We ran it on the 400 config files already in the repo" is a corpus. "We
tested it with `{a: 1}`" is not.

If real inputs cannot be obtained — because they are sensitive, or the capability
is new-shaped — say so explicitly and name what stands in for them. An unstated
absence reads as coverage that does not exist.

### 2. Conformance fixtures — does the new code do what the dependency did?

The replacement must be shown to **match the old dependency's behavior** on the
behavior we actually rely on. The strongest form is a differential test: run both
implementations over the corpus and assert the outputs agree, while the
dependency is still installed. That is why the kit belongs on the *removal*
ticket and not a follow-up — once the dependency is gone, the oracle is gone too.

Where a differential run is impossible, conformance fixtures are captured from
the old dependency's output *before* removal and asserted against afterwards.

Deliberate divergences are allowed and must be **written down** as divergences.
An intentional behavior change that nobody recorded is indistinguishable from a
regression six months later.

### 3. Negative fixtures — does it still reject what it should reject?

Most dependencies do half their work by **refusing** things: rejecting malformed
input, erroring on out-of-range values, failing closed on bad credentials.
Conformance fixtures over valid input never test that half, and a replacement
that accepts everything passes them all.

Negative fixtures assert the replacement still fails on what the dependency
failed on — and fails the same *way* where callers depend on the error type or
message. This is the criterion most often dropped, and its absence is how a
validation library gets internalized into a function that returns `true`.

### 4. Coverage as a gap detector — what behavior is still untested?

Coverage on internalization work is used to **find untested behavior**, not to
report a number. The criterion is a review of the uncovered lines and branches
with a stated disposition for each: tested, deliberately untested with a reason,
or a gap to close before shipping.

A coverage percentage on its own proves nothing here — new code written
alongside its own tests reaches a high number trivially while the branch that
matters is the one nobody thought of. The evidence is the *gap list*, and it is
acceptable for that list to end with "none".

### 5. Provenance and license review — where did this code come from, and are we allowed to use it?

Internalized code has a source: written from scratch against a spec, adapted
from the dependency's implementation, vendored wholesale, or copied from docs or
an answer online. The work item must **say which**, because that is what
determines our license obligation.

Adapting or vendoring carries the upstream license with it — attribution,
notice files, and copyleft terms follow the code even when the package does not.
A permissive license is not "no obligation"; it is usually an attribution
obligation.

The criterion states the origin, the license, and what we have to do about it. If
the answer is "written from scratch without reading their source," say that too —
it is the cleanest provenance available and worth recording.

### 6. Migration and update plan — how do existing call sites move, and how does the new code stay current?

Two halves, both required:

- **Migration**: every existing call site is enumerated and moved, in this change
  or on a named schedule. A replacement nobody calls is not an internalization —
  it is a second implementation, and the dependency is still installed.
- **Staying current**: the capability the dependency tracked usually keeps
  moving — a spec revises, a format gains a version, a platform changes. Name
  who watches for that and what triggers an update. "Upstream did this for us"
  was a real service, and dropping the dependency dropped it.

### 7. Rollback or replacement criteria — what would make us go back, and to what?

Written **before** the removal ships, while it is still a technical judgment
rather than an argument during an incident. The criterion names:

- the observable conditions that mean the internalization failed — defect rate,
  a class of input we cannot handle, maintenance cost we are not paying;
- what we do when they are met — reinstall the dependency, or pick a different
  one, named;
- how long the rollback stays cheap, and what makes it expensive.

"We will fix forward" is a valid answer only if someone wrote it down on purpose.

## Applying the kit — and not over-applying it

The distinction the kit turns on is **whether ownership moves in-house**.

**Inherits the kit** — ownership moves:

- removing a material dependency and doing the work ourselves;
- replacing it with our own implementation;
- vendoring its source into the repo;
- forking it and maintaining the fork.

Each of those lands the capability in the
`thin wrapper suitable for in-house ownership` trust class or removes it from
the dependency set entirely, and either way we now own the behavior.

**Does not inherit the kit** — ownership does not move:

- a routine version bump of a trusted dependency **within its existing trust
  class**, major or minor. The version-bump bar is the trust class's own
  detection evidence and cadence, which already exist;
- swapping one third-party dependency for another third-party dependency, where
  trust simply moves to a different upstream. That is a trust-class decision and
  a decision-record update, not an internalization;
- adding a new dependency, which is covered by the trust-class rule.

Over-applying the kit is a real failure, not a harmless excess of caution. A
version bump forced to produce a corpus, conformance fixtures, and rollback
criteria costs days for evidence that proves nothing — nobody rebuilt anything —
and it teaches planners that the kit is boilerplate to be dispensed with, which
is exactly how it stops being applied when it matters.

The one exception: a version bump that **reclassifies** the dependency into
in-house ownership — a bump taken as a fork, or an upgrade we decline in favor of
owning the code — is an internalization wearing a bump's clothing, and it
inherits the kit.

## The non-material escape hatch

A work item that removes a dependency inherits the kit **unless it explicitly
justifies why the dependency is non-material**. A dependency is non-material when
its failure or disappearance would not break anything a user can see and would
not cost real time to replace — a one-line utility, a dev-only convenience, a
package nothing imports anymore.

The justification is written in the work item, in one sentence, and it is
reviewable. What is not acceptable is silence: a removal ticket with no kit and
no stated reason is not ready to build. That is the whole enforcement mechanism —
the planner must either carry the criteria or say on the record why they do not
apply.

## For the operator at the gate

The kit exists so that a removal ticket **explains how confidence will be rebuilt
before the dependency is dropped**, in language that does not require reading the
code. The seven questions are the readable form: did we test it on real inputs,
does it do what the old one did, does it still reject bad input, what is still
untested, where did the code come from and may we use it, how do callers move and
how does it stay current, and what would make us go back.

An operator who can read answers to those seven can judge the removal without
being an engineer. A removal ticket that cannot answer them is not a plan — it is
an intention.

## Agent parity

The kit is a governed markdown rule plus a decomposition-time expectation, not a
runtime behavior, so Claude Code, Codex, Cursor, OpenCode, Antigravity, and
Copilot all reach it identically through the shared rules mirror and the same
`lisa-task-decomposition` skill. Cursor receives the pair flattened into two
`.mdc` rules; Antigravity has no separate rules tree of its own and inherits the
same content through the shared mirror — no runtime is missing the kit.

The documented gap, uniform across all six runtimes: nothing enforces that a
removal ticket actually carries the kit. No hook or lint gate fails a build when
a dependency is deleted from a manifest with no corpus, no conformance fixtures,
and no rollback criteria. Inheritance is carried by this rule, the decomposition
skill, and review — the same posture as the trust-class rule it extends.

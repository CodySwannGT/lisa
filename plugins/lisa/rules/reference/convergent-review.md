# Convergent Review

Review exists to get correct work merged, not to keep a PR in review orbit.
Apply this contract to every product, quality, local, bot-parity, and suggestion
implementation pass.

## Severity Bar

Findings block only when they name a concrete failure scenario in one of these
classes:

- Correctness: shipped behavior violates the work item, breaks an existing
  contract, or loses required data.
- Security: the change creates or preserves an exploitable auth, input,
  secret-handling, permission, or data-exposure flaw.
- Data loss: a realistic path can delete, corrupt, overwrite, or strand user or
  operational state.
- Contract violation: the change breaks a public API, workflow, generated
  artifact contract, tracker lifecycle, or documented factory invariant.

Lint-owned style, formatting, taste, general maintainability preferences, and
speculative improvements are non-blocking unless the repository rule or work
item explicitly makes them release criteria.

## Required Finding Shape

Every finding must state:

- Severity: `critical`, `major`, `minor`, or `nit`.
- Blocking: `yes` or `no`.
- Failure scenario: the concrete user, operator, security, or factory outcome
  that occurs if the change ships as-is.
- Evidence: the file, command output, observed behavior, ticket text, or
  external constraint proving the scenario is reachable.
- Fix: the smallest actionable correction, or the reason no code change is
  needed. The correction belongs at the **owning boundary** that permitted the
  failure, not at the symptom site.
- `invariant_violated`: the named property the system is supposed to hold that
  this finding puts at risk — for example "the artifact that ships is the
  artifact CI validated". The invariant is the property; the failure scenario is
  the outcome when it breaks. State both; they are not interchangeable.
- `machinery_to_remove`: the redundant checks, workarounds, or scaffolding that
  become deletable once the correction lands, or explicitly `none`. This is a
  **scaffolding-subtraction candidate** — it is surfaced for a human or the
  implementer to act on and is never auto-deleted by any review pass.

A finding marked blocking without a concrete failure scenario is malformed by
contract. Downgrade it to non-blocking and ask for evidence instead of treating
it as a merge blocker.

### Compatibility

`invariant_violated` and `machinery_to_remove` are **required for findings
emitted under the `readiness-rubric`** and **recommended everywhere else**. A
finding from an existing product, quality, local, bot-parity, or suggestion
implementation pass that omits them is still well-formed by contract — this
extension is additive and never retroactively malforms a shipped review surface.

### Readiness findings map onto this shape

A readiness finding names five fields. All five bind to this contract, so there
is no second findings format anywhere in the repository:

| Readiness field | Contract field |
|---|---|
| the at-risk invariant | `invariant_violated` (above) |
| `evidence` | `Evidence` |
| `why_proof_missed` | `Evidence`, extended with a required proof-gap clause: why the existing proof machinery did not catch this |
| `root_correction` | `Fix`, qualified: the correction goes at the owning boundary, not the symptom site |
| redundant machinery | `machinery_to_remove` (above) |

Anything that needs a sixth field extends this section rather than starting a
parallel format.

### Consequence Ordering

Findings are presented **highest-consequence first**. Consequence is determined
by severity and blast radius — how much of the system, how many users, and how
irreversible the outcome — not by discovery order, file order, or the order a
tool happened to emit them in. Two reviewers ordering the same finding set
differently is a defect, not a preference.

This governs the order of findings **within** a section only. Report section
order stays stable and is unaffected: never reorder, merge, or silently omit a
section to surface a finding earlier.

## Dispositions

The implementer resolves each finding with exactly one disposition:

- `fixed`: code, tests, docs, or generated artifacts changed to remove the
  failure scenario.
- `deferred`: the issue is real but non-blocking; record the rationale and, when
  useful, the follow-up work item.
- `pushed-back`: the finding is not valid for this work because evidence,
  scope, or existing project rules refute it; reply with that rationale.

If a reviewer cannot refute a `pushed-back` disposition with fresh evidence, the
author's disposition stands.

## Stopping Rule

After suggestion implementation completes and the required quality and
verification gates pass, review does not reopen unless new evidence appears:

- a new commit changes the reviewed behavior,
- a gate fails,
- a reviewer supplies a previously uncited failure scenario, or
- the work item scope changes.

Irreconcilable blocking disagreement is not an endless review loop. Move the
work item to the configured blocked state, add the human-needed marker when the
decision is human-only, and summarize both positions in operator-readable
language.

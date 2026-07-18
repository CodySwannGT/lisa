# Lisa Implement Roster Decision

Work item: `CodySwannGT/lisa#1537`

Runtime delegation inventory:

`INCLUDE - general-purpose collaboration agent - Codex exposes no enumerated specialist agent types; this available type is constrained by role-specific prompts.`

Assigned fresh specialist roles:

- `INCLUDE - input resolver - Reconciled the complete issue, comments, target environment, prior browser block, and recoverable WIP before claim.`
- `INCLUDE - architecture/security auditor - Reviews tri-state correctness, timeout isolation, child-process safety, HTTP transport, JSON safety, and UI accessibility; read-only.`
- `INCLUDE - test specialist - Owns focused unit/integration tests, records a pre-fix failure for discovered gaps, and does not edit production code.`
- `INCLUDE - browser verification specialist - Proves controller-neutral interactive browser access and designs/runs the live unauthenticated, failure, timeout, all-unknown, and authenticated journey without mutating the user's credentials.`
- `INCLUDE - implementation owner - Integrates fixes after specialist findings and preserves issue scope.`
- `INCLUDE - independent review/learning/verifier/ops roles - Required after implementation for correctness, durable learning, empirical verdict, PR/CI/merge, and release evidence.`

No available delegation type is excluded. Implementation/review/verification responsibilities remain separated by bounded prompts and fresh agents where the runtime permits.

---

Work item: `CodySwannGT/lisa#1550` (post-release compatibility repair)

Runtime delegation inventory:

`INCLUDE - general-purpose collaboration agent - Codex exposes one delegation type, constrained here by fresh role-specific prompts.`

`INCLUDE - input resolver - Confirmed #1550 was initially ready and later reopened after empirical npm verification.`

`INCLUDE - reproducer and parity mapper - Reproduced the original gap, mapped canonical/generated surfaces, and now pins the released backward-compatibility regression.`

`INCLUDE - implementer - Repairs the released 2.222.0 compatibility failure and mixed-rollup semantics from clean main.`

`INCLUDE - reviewer and learner - Independently gate contract correctness, source compatibility, and maintainability.`

`INCLUDE - verifier and release operations - Validate local behavior, merged CI, release, and public npm artifact before terminal closeout.`

No available delegation type is excluded.

# Level 1 evidence for controls Lisa cannot yet exercise

Date: 2026-11-21

Status: Proposed in [#5014](https://github.com/CodySwannGT/lisa/issues/5014)

## Decision

Keep the minimum evidence rungs in the [TASC draft](../../spec/tasc-0.1-draft.md#7-evidence-rules) and [criterion catalogue](../../spec/tasc-criteria.json). The verdict should identify which evidence the operator still needs. Missing access, an unsupported evidence route, and a control that failed its check have different remedies. All three prevent a conforming verdict when they leave an applicable criterion unproved.

## Pull-request checks on platforms other than GitHub

Accept a future import from a trusted attestor for the host's own pull-request executor. The host operator runs the existing authoritative check against a clean change and a deliberate violation in an isolated pull request on the declared platform. An independent reviewer verifies both immutable runs and their artifact hashes. The clean run must pass, and the violation must fail with the declared failure text. Each half must bind the same work item, repository, entry, platform, enforcement point, check definition, environment, and applicable criterion.

`lisa controls attest` is the entry point for accepting this pair and writing the normal evidence document. The attestor's authenticated receipt must cover both persisted records and the check definition. The trust anchor is administered outside the checkout. `lisa controls register` and `lisa controls attest --check` should verify the same receipt, evidence schema, current check binding, and each record's freshness using the current clock. A self-declared `source` field and a digest over editable local files can identify bytes, but neither authenticates the writer. A missing or unverifiable receipt, a stale or wrong-scope record, and a failed half all leave the mark `unproved`.

The current host-authored executor and GitHub canary are separate paths. On the current release, the register can clear `unproved` from two local evidence rows based on their shape. The operator should treat that display as insufficient to establish provenance. The owner ruling in [#5014](https://github.com/CodySwannGT/lisa/issues/5014) requires the wording about the attest step to become true when this path ships. Until an import is verified on a specific hosting platform, exercise on that platform remains unavailable.

## Artifacts with an exercised minimum

Add typed evidence producers for the four artifacts. The project supplies the authoritative source, and an independent adjudicator validates that the exercise followed the declared path. `lisa controls configure` can declare the artifacts and their policy. `lisa controls attest` validates and records a result for each applicable scope. An `EvidenceBatch` can already carry scoped inputs and replace its previous results. Each producer still needs a verifiable way to connect its result to the exercise and preserve the associated context. Treat a valid declaration without a verified exercise as below the required rung.

| Criterion | Producer and minimum accepted exercise |
| --- | --- |
| AC5.5 Gate exercise | The authoritative gate runner records that a known violation was refused. Require a clean companion run when the control uses a paired proof. Cover each authoritative gate separately. |
| AC6.4 Per-surface credential paths | The operator records a successful identity proof for each applicable connection and execution surface from that surface. Bind the verified principal while keeping credential values out of the artifact. |
| AC7.2 Incident and rollback | The release operator records a rollback exercise from detection through restoration and verifies recovery on the declared production or production-representative path. Bind the incident record, accountable party, generation lineage, and control finding. |
| AC8.9 Staff introduction | The staff operator records independent comparisons during the declared shadow period and an adversarial exercise, linked to the roster version and qualification decision. |

## Gate criteria without a registry mapping

Keep the gap explicit in this release through `lisa controls audit` and `lisa controls attest`. Add a producer only where Lisa can identify the authoritative mechanism and obtain evidence from the right surface. `lisa controls attest` records verified observations and exercises at the catalogue's required rung. `lisa controls attest --check` must reproduce the assessment of the stored records, their binding, and their freshness. This decision creates no substitute generic gate.

| Criterion | Minimum | Evidence required to close the gap |
| --- | --- | --- |
| AC5.1 Server-side authority | Observed | A hosting administrator supplies an authenticated observation of required enforcement and bypass permissions on the protected branch for the performing role. |
| AC5.2 Mirror consistency | Exercised | The control owner runs the authoritative check and applicable destination mirrors, confirms they agree, and deliberately introduces drift to show the mismatch is detected. |
| AC8.2 Agent program as code | Exercised | The control owner exercises the repository change gates against a known-bad agent-program change and verifies those gates cover the paths production uses. Behavioral qualification remains separate when the specification requires it. |
| AC8.5 Deployment protection | Observed | The release operator supplies production protection settings and approval separation from the deployment platform, plus the declared signals where progressive promotion is used. |
| AC8.6 Work-item readiness | Exercised | The intake owner exercises the real tracker readiness mechanism with an invalid work item and a valid one, proving only the valid one can receive the ready role. |
| AC8.8 Risk tiers | Observed | The policy owner supplies the active risk map and enforcement settings that connect each tier to its permitted unattended actions and required approvals. |
| SI10 Output provenance and licensing | Exercised | The source-policy owner exercises the changed-source gate with a known prohibited source reuse case and a permitted control. Reuse the licence policy with dependency scanning while measuring changed source as its own control. |
| UX2 Tokens as source of truth | Exercised | The design-system owner runs the host's rule against a representative off-token value and a conforming value in the project's own source. |
| UX4 Visual conformance | Observed | The product owner supplies an independently adjudicated mechanical comparison with the approved design over the declared viewport, theme, and interaction states and their configured tolerances. |

## Build work

The implementation work is tracked under [#5159](https://github.com/CodySwannGT/lisa/issues/5159).

- [#5160](https://github.com/CodySwannGT/lisa/issues/5160) verifies authenticated attest receipts for host-authored pull-request checks.
- [#5161](https://github.com/CodySwannGT/lisa/issues/5161) records verified exercises for the four artifacts.
- [#5162](https://github.com/CodySwannGT/lisa/issues/5162) explains the evidence still needed for criteria without a registry mapping.

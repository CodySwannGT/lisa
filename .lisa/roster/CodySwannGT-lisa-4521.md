# Specialist roster for CodySwannGT/lisa#4521

Runtime: native Codex, collaboration.spawn_agent. The runtime exposes general
agents with task prompts, without a named specialist-type catalog. Each role
below uses that supported fallback with separate ownership and evidence.
No model overrides are requested; agents inherit the active model.

INCLUDE - input-resolver - Complete bounded live issue admission, actual access, claim, binding, and private context.
INCLUDE - reproduction-specialist - Qualify the real failing behavior before source investigation and preserve same-input controls.
INCLUDE - implementation-specialist - Investigate after qualified RED and implement the canonical matcher and equivalent consumers.
INCLUDE - product-specialist - Independently review complete issue/comment obligations and operator outcomes.
INCLUDE - code-review-specialist - Independently review correctness, security, and canonical consumer parity.
INCLUDE - quality-specialist - Independently review evidence quality, edge cases, generation, and normal gate coverage.
INCLUDE - verification-specialist - Independently execute behavior, hosted evidence, and shipped-byte replay with typed verdicts.
INCLUDE - lifecycle-specialist - Drive submission, current-head review, merge, release, linkage, and tracker evidence using canonical contracts.
INCLUDE - ops-specialist - Read applicable post-release health evidence without unrelated production access or ticket side effects.
EXCLUDE - UI/design-specialist - This work is a lockfile security matcher and has no browser design surface.

Task metadata (owner is duplicated in metadata.owner by convention):

| Task | Owner / metadata.owner | Dependencies | Completion condition |
| --- | --- | --- | --- |
| Admission | input_resolver | none | Live claim/binding and complete ignored context verified; complete |
| Delivery preparation | lifecycle_specialist | admission, roster | Validate and prepare complete typed journey/accounting/delivery contract; no push or merge before root gate release |
| Reproduce | reproduction_specialist | admission, fresh branch attachment | Genuine RED with exact inputs and legacy controls |
| Implement | implementation_specialist | qualified RED | Canonical source/template/consumer parity and identical-input GREEN |
| Product review | product_specialist | completed build/regeneration | Independent obligations assessment |
| Code review | code_review_specialist | completed build/regeneration | Independent concrete failure review |
| Quality review | quality_specialist | completed build/regeneration | Independent verification and gate assessment |
| Resolve findings | root | all three reviews | Every finding disposition recorded, required normal gates pass |
| Verify | verification_specialist | findings, gates, current artifact | Current-head empirical typed evidence, named hosted execution, independent shipped replay |
| Deliver | lifecycle_specialist | reviews and gates | Non-draft linked PR, current-head review, merge, ordinary release |
| Health | ops_specialist | release | Applicable read-only health report with explicit limits |
| Complete | root | delivery, verification, health | Usage/evidence and canonical completion readback |

Public artifacts must never contain private/downstream identities from the
ignored context. Issue #4509 is a related obligation, not a claim or closure
owned by this flow. No memory writes or human-rule edits are authorized.

Delivery preparation inherits the common task JSON in `.lisa/plan-4521.md`,
with skills `lisa-github-write-issue`, `lisa-github-validate-issue`,
`lisa-github-verify`, `lisa-usage-accounting`, `lisa-git-submit-pr`,
`lisa-drive-pr-to-merge`, and `lisa-tracker-evidence`. Its owner and
metadata.owner are `lifecycle_specialist`; it uses the already-proven GitHub
issue/workflow/release APIs and official public package metadata. Its proof is
an exact native readback of any authorized issue/accounting update, with
validated complete requirement conjunctions and no claimed future delivery.

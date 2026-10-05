# Roster Decision: required history scanning

Work item: CodySwannGT/lisa#4345. This is the existing parent Implement
flow's local donor stage. No additional outer team is created.

The actual delegation API is `collaboration.spawn_agent`. It exposes no
`agent_type`, Lisa selector, explorer selector or worker selector. The listed
model overrides are not specialist selectors and will not be used. Generic
agents inherit the current model and guards. Filesystem Lisa agent definitions
are available as instructions, but cannot be selected by this runtime.

INCLUDE - generic research/explorer equivalent - a separate read-only agent maps source ownership, architecture, product criteria and test strategy before the builder.
INCLUDE - generic scoped worker equivalent - a separate builder owns only the agreed source and test paths and reports RED before source changes.
INCLUDE - generic source/security/quality/spec reviewer - a different agent reviews frozen current bytes and every authored criterion without implementing.
INCLUDE - generic empirical verifier - a different agent executes the supported scanner, emitted hook and event-range journey without implementing or accepting builder assertions.
EXCLUDE - model override selections - no model change is authorized or needed.

Full shipped Lisa agent catalog follows. INCLUDE means that definition's
obligations are assigned to the above bounded native equivalent. EXCLUDE does
not remove an applicable quality gate.

INCLUDE - architecture-specialist - research must identify the smallest sufficient existing integration and exact source ownership.
INCLUDE - builder - scoped TDD worker constructs real history controls and implements the approved route.
EXCLUDE - bug-fixer - this authored leaf is a Build task and does not need a duplicate implementation owner.
EXCLUDE - confluence-prd-intake - no PRD or Confluence intake occurs in this stage.
EXCLUDE - debug-specialist - concrete failed checks return to the builder without a separate debugging lifecycle.
EXCLUDE - eval-specialist - no model evaluation feature changes.
EXCLUDE - git-history-analyzer - historical real payload analysis is explicitly excluded, research inspects only relevant metadata and current source.
EXCLUDE - github-agent - canonical input and claim are already verified, coordinator retains bounded tracker reads.
EXCLUDE - github-build-intake - this leaf is already claimed, no queue sweep.
EXCLUDE - github-prd-intake - no PRD intake.
EXCLUDE - jira-agent - configured tracker is GitHub.
EXCLUDE - jira-build-intake - configured tracker is GitHub and no queue sweep.
EXCLUDE - learner - no memory or learnings ledger mutation is authorized, MLD telemetry is retained in the stage record for parent routing.
EXCLUDE - learning-judge - no learning promotion occurs during donor implementation.
EXCLUDE - learnings-synthesizer - no synthesis or ledger write is in scope.
EXCLUDE - linear-agent - configured tracker is GitHub.
EXCLUDE - linear-build-intake - configured tracker is GitHub and no queue sweep.
EXCLUDE - linear-prd-intake - no Linear or PRD intake.
EXCLUDE - notion-prd-intake - no Notion or PRD intake.
EXCLUDE - performance-specialist - no performance change is requested, bounded execution and resource cleanup remain verifier obligations.
EXCLUDE - pr-mining-specialist - no broad PR mining or private historical payload inspection.
INCLUDE - product-specialist - research and independent spec review preserve all nine scenarios and operator-readable failure messages.
INCLUDE - quality-specialist - frozen source reviewer covers ordinary lint/type/test and emitted-copy consistency.
INCLUDE - security-specialist - frozen reviewer examines ref validation, scanner supply chain, failure closure and all redaction boundaries.
INCLUDE - spec-conformance-specialist - reviewer maps every authored criterion to actual evidence and preserves terminal delivery obligations.
EXCLUDE - skill-evaluator - no skill evaluation or harness change.
INCLUDE - test-specialist - research sets the real scanner fixture strategy, builder codifies it, independent verifier attacks its blind spots.
EXCLUDE - tracker-mining-specialist - relationship resolution is already recorded and no further broad tracker mining is required.
INCLUDE - verification-specialist - distinct empirical verifier establishes only the observed local CLI/package boundaries.

No agent may change foreign files, reset/clean, override guards or trust, run
Claude inference, change model, push or perform remote delivery. Research is
read-only except its assigned audit report. Reviewer and verifier cannot repair
source. Actual agent UUIDs and phase manifests are recorded in private stage
state before their results are accepted.

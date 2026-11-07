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

---

## Resume roster (Claude Code, 2026-11-07)

Resumes the six prior commits rebased onto origin/main f7355b414b as branch
`claude/4521-path-scoped-audit-exclusions`. Work type: Fix (type:Bug).

INCLUDE - lisa:github-agent - Served as bounded input-resolver (read, reuse-claim, bind) for the GitHub-tracked issue.
INCLUDE - Explore - Mandatory read-only research of the existing matcher, consumers and prior branch commits.
INCLUDE - general-purpose - Team-lead helper for base-branch resolution and branch sync, per the skill's explicit general-purpose steps.
INCLUDE - lisa:bug-fixer - Owns the Fix: re-validates the reproduction (empty paths accepted) and closes the remaining gaps.
INCLUDE - lisa:test-specialist - Consumer-parity and fixture-lockfile test design (alias, uncovered path, fail-closed).
INCLUDE - lisa:quality-specialist - Concurrent code-quality review after implementation.
INCLUDE - lisa:product-specialist - Concurrent review that operator-facing messages/docs are readable by a non-technical operator.
INCLUDE - lisa:security-specialist - The change governs vulnerability suppression; must confirm no fail-open path.
INCLUDE - lisa:verification-specialist - Independent empirical verification and schema-v2 verdict.
INCLUDE - lisa:spec-conformance-specialist - Coverage matrix against the issue's AC and Out of Scope.
INCLUDE - lisa:learner - Captures task MLD to the ledger.
EXCLUDE - claude - Catch-all; specific specialists cover every role.
EXCLUDE - claude-code-guide - No Claude Code product questions involved.
EXCLUDE - code-simplifier:code-simplifier - quality-specialist covers simplification review; avoids churn on a resumed branch.
EXCLUDE - hookify:conversation-analyzer - Not analyzing transcripts for hooks.
EXCLUDE - lisa:architecture-specialist - Design is fully specified in the issue and already implemented on the prior branch.
EXCLUDE - lisa:builder - This is a Fix; bug-fixer owns implementation.
EXCLUDE - lisa:confluence-prd-intake - No Confluence PRD intake.
EXCLUDE - lisa:debug-specialist - Defect cause already proven by the recorded reproduction; bug-fixer re-confirms it.
EXCLUDE - lisa:eval-specialist - Not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covered the 6 prior branch commits.
EXCLUDE - lisa:github-build-intake - Not running an intake cycle.
EXCLUDE - lisa:github-prd-intake - Not PRD intake.
EXCLUDE - lisa:jira-agent - Tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - Tracker is GitHub.
EXCLUDE - lisa:learning-judge - Invoked by learner/persist-learning as needed, not as a teammate.
EXCLUDE - lisa:learnings-synthesizer - Debrief-only.
EXCLUDE - lisa:linear-agent - Tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - Tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - Tracker is GitHub.
EXCLUDE - lisa:notion-prd-intake - No Notion.
EXCLUDE - lisa:performance-specialist - Lockfile parse per audit run; no performance-sensitive surface.
EXCLUDE - lisa:pr-mining-specialist - Debrief-only.
EXCLUDE - lisa:skill-evaluator - No learning routing in this flow.
EXCLUDE - lisa:tracker-mining-specialist - Debrief-only.
EXCLUDE - Plan - Plan already exists in the issue body; Explore + bug-fixer suffice.
EXCLUDE - statusline-setup - Unrelated.

Tool access preflight (2026-11-07): `gh auth status` logged in as the repo
owner with push=true; `npm view @codyswann/lisa version` → 4.90.0; bun 1.4.4 /
node 24.21.0 via mise; `gh run list --workflow deploy.yml -L 1` readable
(last: success on main). All pass.

Completion condition: on the merged+released package, the same fixture trees
give identical verdicts across pre-push, registry (`security:audit`), CI action
and exported `@codyswann/lisa/audit`; `paths: []` is rejected by doctor; an
uncovered or aliased vulnerable copy fails naming its path; legacy id-only
entries are unchanged; and the new audit specs appear by name in hosted CI.

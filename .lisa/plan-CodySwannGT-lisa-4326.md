# Refresh shared Node22 runtime and test-tool security floors

Work item: CodySwannGT/lisa#4326

Read `/tmp/lisa-4326-implementation/.lisa/work-item-context.md` in full before acting. Branch: `codex/4326-refresh-shared-runtime-security-floors`; target/base `main`; derived production/default assumption and existing Branch Plan agree. Binding attached and verified.

## Effective completion

Both clean generated TS/CDK hosts complete two actual CLI applies and real installs with exit0; all generated shared Node22 surfaces equal22.23.3, installed vitest/coverage are compatible4.x >=4.1.11 and Vite8.x >=8.3.2, install-lock versions agree with node_modules, second apply has zero managed-content delta, supported host execution and offline CDK synth succeed, no unplanned major or IAM/resource contract changes. Repo quality gates are additional prerequisites. Final branch is merged to derived main, configured required CI/review checks conclude success for shipped head, source evidence and usage/backlinks are posted, issue is terminal only after this proof, and binding/context are cleared only then.

## Actual system proof

Build the branch Lisa CLI; apply it into two clean local Git fixtures at /tmp/lisa-runtime-4326/typescript and /tmp/lisa-runtime-4326/cdk using node dist/index.js apply <fixture> --yes --no-update-check; install generated dependencies with bun install; read actual node --version under Node22.23.3, generated .nvmrc/package engines/workflow pins, bun lock resolutions and node_modules package versions; run each generated host through its supported unit/typecheck commands and CDK fixture offline synth with lookup:false; snapshot managed files and apply the same built CLI a second time, requiring no managed-byte delta; rerun bun install --frozen-lockfile and repeat version/lock reads. Preserve TS6/ESLint9/Knip5/Husky8/Vitest4/Vite8 families and scoped deepmerge-ts8 override.

## Required access preflight

- GitHub tracker and Git transport — CodySwannGT/lisa: **pass**. Probe: `gh repo view CodySwannGT/lisa --json defaultBranchRef,viewerPermission; gh issue view 4326 --repo CodySwannGT/lisa; git ls-remote --heads origin main`. Evidence: main; ADMIN; issue open/in-progress assigned authenticated actor; cf55d5f03806fa21e346c1bec6f45110030a13e2 refs/heads/main
- npm registry package metadata/artifacts: **pass**. Probe: `GET https://registry.npmjs.org/vitest/4.1.11; GET https://registry.npmjs.org/%40vitest%2Fcoverage-v8/4.1.11; GET https://registry.npmjs.org/vite/8.3.2`. Evidence: All exact versions exist with dist.tarball; Vitest/Vite engines accept Node22.23.3.
- Official Node release distribution: **pass**. Probe: `GET https://nodejs.org/dist/index.json; select version v22.23.3`. Evidence: v22.23.3 released2026-09-23; Jod LTS; osx-arm64-tar available.
- GitHub Actions and branch-protection/ruleset surfaces: **pass**. Probe: `gh api repos/CodySwannGT/lisa/actions/workflows; gh api repos/CodySwannGT/lisa/actions/runs -f branch=main -f per_page=3 --method GET; gh api repos/CodySwannGT/lisa/rulesets/18805189; gh api repos/CodySwannGT/lisa/rulesets/11912821`. Evidence: Active CI and reusable quality workflows readable; 13 quality checks plus CodeRabbit and GitGuardian required. Current base includes concluded-success workflow readbacks. Sonar token absent; no standalone SonarCloud proof claim.

Current local Node22.22.0 is not target runtime proof. Isolated Node22.23.3 must be used for fixture execution. Bun1.3.11 and npm10.9.4 available. No AWS or product login required. SonarCloud token is absent; do not claim a cloud scan.

## Research and ownership

- Canonical issue context, all comments and Validation Journey (read in full).
- README.md:130-224 documents explicit Lisa apply and bun install; installation alone does not apply templates.
- src/cli/index.ts apply command; src/cli/apply.ts --yes and --no-update-check supported.
- Root package.json + package.lisa.json; typescript, cdk, npm-package, nestjs, phaser and harper-fabric package-lisa templates own runtime/test tool values.
- Node policy surfaces include root .nvmrc, typescript/copy-overwrite/.nvmrc, shared/stack create-only workflows and expo/create-only/eas.json.
- TypeScript package template Node/Vitest/coverage defaults preserve explicit host values by ownership contract; other stack force sections upgrade Lisa-owned versions.
- scripts/check-security-floors.mjs audits force/defaults/merge groups (GOVERNANCE_GROUPS, line75) against high/critical advisories; it does not change host ownership or centrally hard-code these Vitest/Vite minima.
- Existing shipped integration composition/updater removal fixes are dependencies to consume, not new work.
- Host rules: stage inputs, regenerate both artifacts, stage outputs, check artifacts; no downstream project identities in published artifacts.
- Learnings projection: install dependencies and build:dist in fresh worktrees before TS tests; regression must reach real changed surfaces.

## Comment inventory and obligations

- 5960670067: accepted single-repository source scope, all scenarios, three named evidence artifacts and ownership rules are explicit deliverables.
- 5960770263: continue claimed work in verified bound feature worktree; clear only after terminal completion.

## Tasks

### T1 — Derive branch, attach binding and prove required access

Owner: planning-specialist; status: completed; depends on: none. Read context in full. Comment inventory: [{"id": 5960670067, "author": "CodySwannGT", "author_id": 292923, "flags": ["decision"], "gist": "Accepted single-repository build-ready task with validation evidence obligations; no secrets."}, {"id": 5960770263, "author": "CodySwannGT", "author_id": 292923, "flags": ["decision"], "gist": "Managed implementation claim; preserve attributable binding; no secrets."}].

- Production maps to remote main; ticket Branch Plan matches recomputation.
- Feature branch is clean and synced onto origin/main; attached binding matches canonical ref.
- GitHub/npm/official Node/CI access proven against named targets; no substituted service.

Verification: git rev-parse HEAD origin/main; git branch --show-current; node scripts/lisa-work-item.mjs current; gh issue view 4326 --repo CodySwannGT/lisa --json state,assignees,labels

Expected: Same base SHA; dedicated codex/4326-refresh-shared-runtime-security-floors; binding github/ref4326 and attached branch; open in-progress claim.

### T2 — Add focused red-before-green policy regressions

Owner: implementation-worker; status: pending; depends on: T1. Read context in full. Comment inventory: [{"id": 5960670067, "author": "CodySwannGT", "author_id": 292923, "flags": ["decision"], "gist": "Accepted single-repository build-ready task with validation evidence obligations; no secrets."}, {"id": 5960770263, "author": "CodySwannGT", "author_id": 292923, "flags": ["decision"], "gist": "Managed implementation claim; preserve attributable binding; no secrets."}].

- New tests/unit/core/shared-runtime-policy.test.ts reaches all changed runtime/template/test-tool surfaces.
- Baseline failures directly demonstrate stale default/forced policy and coverage-version pairing.
- Explicit host-owned defaults remain preserved while Lisa forced ownership upgrades.

Verification: node dist/index.js apply /tmp/lisa-runtime-4326/baseline-typescript --yes --no-update-check; node -p "require('/tmp/lisa-runtime-4326/baseline-typescript/package.json').engines.node"

Expected: Baseline generated policy visibly remains22.21.1; new regression suite fails intended assertions before implementation.

### T3 — Update owned runtime/security floors with docs and locks

Owner: implementation-worker; status: pending; depends on: T2. Read context in full. Comment inventory: [{"id": 5960670067, "author": "CodySwannGT", "author_id": 292923, "flags": ["decision"], "gist": "Accepted single-repository build-ready task with validation evidence obligations; no secrets."}, {"id": 5960770263, "author": "CodySwannGT", "author_id": 292923, "flags": ["decision"], "gist": "Managed implementation claim; preserve attributable binding; no secrets."}].

- Node22.23.3 consistent across owned shared runtime surfaces.
- Vitest/coverage minima4.1.11 paired and Vite minimum8.3.2 in supported majors.
- Corresponding source/destination templates, documentation and real lock resolutions updated together.
- Preserve existing force/defaults/merge ownership and scoped deepmerge-ts8 override.

Verification: node dist/index.js apply /tmp/lisa-runtime-4326/typescript --yes --no-update-check; node dist/index.js apply /tmp/lisa-runtime-4326/cdk --yes --no-update-check; cd /tmp/lisa-runtime-4326/typescript && bun install; cd /tmp/lisa-runtime-4326/cdk && bun install

Expected: Both built-CLI generated hosts and installs exit0; installed versions meet declared floors and retain majors.

### T4 — Independently review ownership, parity and complete quality gates

Owner: independent-quality-specialist; status: pending; depends on: T3. Read context in full. Comment inventory: [{"id": 5960670067, "author": "CodySwannGT", "author_id": 292923, "flags": ["decision"], "gist": "Accepted single-repository build-ready task with validation evidence obligations; no secrets."}, {"id": 5960770263, "author": "CodySwannGT", "author_id": 292923, "flags": ["decision"], "gist": "Managed implementation claim; preserve attributable binding; no secrets."}].

- Review source and destination together, all six agent surfaces and default semantics.
- Typecheck, lint/slow, formatting, unit/coverage, integration, artifact/template parity and relevant offline synth checks pass.
- No new SonarJS lint/security violations; remote SonarCloud is unconfigured and must not be asserted.
- Review suggestions corrected before final proof.

Verification: node dist/index.js --version; node dist/index.js apply /tmp/lisa-runtime-4326/review-host --yes --no-update-check; git diff --stat; git diff --check

Expected: Built branch CLI executes and generated host exposes updated owned policy; independent review finds no unmet scope/ownership/parity obligations.

### T5 — Independently prove generated TS/CDK adoption and idempotence

Owner: independent-verification-specialist; status: pending; depends on: T4. Read context in full. Comment inventory: [{"id": 5960670067, "author": "CodySwannGT", "author_id": 292923, "flags": ["decision"], "gist": "Accepted single-repository build-ready task with validation evidence obligations; no secrets."}, {"id": 5960770263, "author": "CodySwannGT", "author_id": 292923, "flags": ["decision"], "gist": "Managed implementation claim; preserve attributable binding; no secrets."}].

- Both clean generated TS/CDK hosts complete two actual CLI applies and real installs with exit0; all generated shared Node22 surfaces equal22.23.3, installed vitest/coverage are compatible4.x >=4.1.11 and Vite8.x >=8.3.2, install-lock versions agree with node_modules, second apply has zero managed-content delta, supported host execution and offline CDK synth succeed, no unplanned major or IAM/resource contract changes. Repo quality gates are additional prerequisites. Final branch is merged to derived main, configured required CI/review checks conclude success for shipped head, source evidence and usage/backlinks are posted, issue is terminal only after this proof, and binding/context are cleared only then.
- Independent schema-v2 verdict binds each code-unit/cli-runtime/source-merge claim to matching branch artifact SHA and appropriate evidence kinds.
- All three named issue artifacts (baseline-regression, fixed-success-and-edge, quality-and-template-review) are present.

Verification: Build the branch Lisa CLI; apply it into two clean local Git fixtures at /tmp/lisa-runtime-4326/typescript and /tmp/lisa-runtime-4326/cdk using node dist/index.js apply <fixture> --yes --no-update-check; install generated dependencies with bun install; read actual node --version under Node22.23.3, generated .nvmrc/package engines/workflow pins, bun lock resolutions and node_modules package versions; run each generated host through its supported unit/typecheck commands and CDK fixture offline synth with lookup:false; snapshot managed files and apply the same built CLI a second time, requiring no managed-byte delta; rerun bun install --frozen-lockfile and repeat version/lock reads. Preserve TS6/ESLint9/Knip5/Husky8/Vitest4/Vite8 families and scoped deepmerge-ts8 override.

Expected: Both clean generated TS/CDK hosts complete two actual CLI applies and real installs with exit0; all generated shared Node22 surfaces equal22.23.3, installed vitest/coverage are compatible4.x >=4.1.11 and Vite8.x >=8.3.2, install-lock versions agree with node_modules, second apply has zero managed-content delta, supported host execution and offline CDK synth succeed, no unplanned major or IAM/resource contract changes. Repo quality gates are additional prerequisites. Final branch is merged to derived main, configured required CI/review checks conclude success for shipped head, source evidence and usage/backlinks are posted, issue is terminal only after this proof, and binding/context are cleared only then.

### T6 — Ship through configured CI, record evidence/usage and close source leaf

Owner: lifecycle-specialist; status: pending; depends on: T5. Read context in full. Comment inventory: [{"id": 5960670067, "author": "CodySwannGT", "author_id": 292923, "flags": ["decision"], "gist": "Accepted single-repository build-ready task with validation evidence obligations; no secrets."}, {"id": 5960770263, "author": "CodySwannGT", "author_id": 292923, "flags": ["decision"], "gist": "Managed implementation claim; preserve attributable binding; no secrets."}].

- Logical scoped commits, PR into derived main and two-way non-closing work-item backlink.
- All required quality checks, CodeRabbit/GitGuardian and unresolved-thread gates satisfied, then merge verified.
- Target main contains merge; actual configured publish/deploy surface concludes success or capability-aware scope proves no further source implementation delivery obligation.
- Post source evidence and usage, native terminal done/closure, rollup when applicable; clear binding and context only after terminal proof.

Verification: gh pr view <created-pr> --repo CodySwannGT/lisa --json state,mergedAt,mergeCommit,baseRefName,statusCheckRollup; git merge-base --is-ancestor <merge-sha> origin/main; gh issue view 4326 --repo CodySwannGT/lisa --json state,labels,comments; node scripts/lisa-work-item.mjs current

Expected: Verified merged PR into main with successful required terminal checks, visible evidence/backlinks/usage, issue closed with configured terminal label, no binding or context remaining after cleanup.

Every task has required JSON metadata in the companion plan JSON, including skills, learnings, required_access, work_item_context, comment inventory and verification. Update metadata.relevant_documentation with further explorer findings before implementation; record concise MLD at task end.

## Final explorer findings

- scripts/update-node-version.ts misses current paths; direct owned-surface inventory is authoritative, not that stale updater.
- Fixture references: tests/integration/apply-reports-unchanged-manifest.test.ts real Lisa.apply orchestration and host-test-scripts-survive-apply.test.ts shipped PackageLisaStrategy inputs.
- Immutable packed CLI reference: tests/integration/lisa-test-run-packed-bin.test.ts uses git checkout-index, isolated build:dist:in-place and npm pack --ignore-scripts; actual CLI verification must be from exact branch artifact.
- scripts/mutation-performance-measure.mjs prepare --subject-sha <exactHEAD> --tarball <absolute.tgz> --output <outsideRepoDir> already applies exact packed CLI twice to8stacks and checks governed hashes; extend empirical CDK host with genuine App/Stack, Template assertion and actual cdk synth, since grade.ts alone is not synth proof.
- Empirical clean-fixture CLI: CI=1 LISA_BOOTSTRAP=1 node <packedRoot>/dist/index.js apply <host> --yes --no-update-check --harness=cursor, with fixture-local gh sentinel guarding against accidental remote repo creation; compare six-harness package/.nvmrc policy parity rather than equating different agent file bytes.

Security-floor group coverage correction above is authoritative: all force/defaults/merge groups are audited. This does not authorize converting host-owned defaults to force. Required access passed and implementation may start.

## Implementation/review checkpoint

T2/T3 source work completed; T4 independent source review passed, with remaining quality gates still in progress. Exact focused regression16/16 green and15/16 red on original base. Stable source tree bfb1b0cc7569b397e8d7fd61cdac437cdb1c7de6. Full integration177 files3188pass9existing skips. Independent review found no blockers and verified7 artifact checks. Full unit stable rerun, clean-host proof, commit-bound independent verification, CI and release remain pending. Task-end MLD forT2/T3/T4 is[].

## Quality checkpoint

T4 completed after independent review and all applicable local quality gates passed. Unit coverage1359files25635passed2existing skipped; integration177files3188passed9existing skipped. Coverage82.88% statements,75.85% branches,88.52% functions,83.86% lines meets thresholds. Fast/slow lint, format, typecheck, Knip, ast-grep, plugin sync and7artifact checks pass. Learner independently reports no learnings to process for empty MLD. T5 final commit-bound actual CLI proof and T6 CI/release/evidence remain pending.

## Later learning capture

Pre-publication packed-artifact proof found same-version package cache substitution despite matching version and lock integrity. T3 MLD now records isolated artifact caches and full installed-byte comparison. Capture-only learner contract persistence is in progress before PR; runtime source and its passed gates remain unchanged. Independent verification will bind to the final commit after capture.

Learner capture completed through the executable contract, consolidating the existing fresh-worktree prerequisite entry. Stable id sll4-8968b24e50aa, fingerprint learning-c832e9edbfc7d06e1eca; prior rule/evidence/oldest date preserved,20entries and13186/14900bytes, exactstamp matched and no stale targets. Budget check passes.

## Codification checkpoint

The independent verifier completed all local packed-artifact TS/CDK, six-harness and explicit-default checks at 694ea306. Shipping remains in progress because the full installed-host journey was only in outside-repo scripts. T5 now includes a regular committed integration regression at tests/integration/shared-runtime-packed-hosts.test.ts with bounded fixtures/helpers. It must fail for the original stale policy using identical final test bytes and pass the updated branch, including real install, exact tar-member identity, host execution, frozen repeat, stable offline CDK synth and zero managed changes on the second adoption apply. Runtime policy source remains unchanged.

The fixture begins with one bootstrap setup apply followed by two adoption applies. The inherited bare-bootstrap gate delta is retained as a documented limitation. Source review, final staged artifact regeneration and applicable full gates follow this test addition. Prior 694ea evidence remains bound to its original artifact rather than being relabeled as later evidence.

Current context inventory includes full plan comment 5961220400, CodySwannGT actor292923, created2026-10-02T20:47:04Z, decision, no new constraints, no secrets.

## Current codification handoff

The identical final six-file regression inputs passed independent source review. At source HEAD694ea306/staged treef4e49516636a74de800dfb113173a99a053a1343 the exact supervisor returned exit0, one file/two cases passed. Baseline cf55/staged tree2d8326426284cc43ad649f8fc5256a260ace8b76 returned exit1, two cases failed on real generated Node22.21.1 before host install. All hashes are in /tmp/lisa-4326-codification/final-inputs.json; the baseline is a separate object store at /tmp/lisa-4326-codification-red.

TS and CDK executed genuine typecheck and one/two native unit cases. Every7,522 regular packed member matched after actual installs, second adoptions and frozen repeats produced zero managed-byte deltas, and two actual no-lookups CDK synth templates had identical raw bytes. One bootstrap setup plus two adoption applies is explicit. Final candidate tar SHA256219c47321c1bb4214abd3e91789e7e5c9c699102769254edf9c4c227bfd08076 is a local candidate, not publication proof.

Current task statuses are T1/T2/T3 completed, T4/T5 in progress, T6 pending. Historical checkpoints above retain their original source identity. The next gates are canonical nonblocking learning capture, staged input/artifact consistency, applicable full repository gates, normal commit, independent exact-commit verification, named successful PR CI, merge and actual configured release/publication with exact registry-artifact installed-host proof. No older evidence is relabeled to a new head.

Canonical capture consolidated the nested-host lease/profile/temp-root discovery into the existing packed-proof setup entry, preserving stable ID and oldest date. Current stamp learning-29a7e548ca264ca3e66d;20entries13412/14900bytes; explicit budget check passed. Other narrower MLD is retained in task metadata and tests. No six-file regression input changed.

## Approved security-audit disposition

The operator approved the single repository-local GHSA-vfj7-8cjw-p6xm exception on 2026-10-03 with “approve the exception”. Its exact approved draft SHA256 is a7bd5588e0d1edec667ef9331267ba9c4c74c142097111c2e3c5a911578b8d12. The actual Knip entry-data stack exhaustion and absence of a published patched leaf are documented in evidence/4326/security-audit-review.md. This is explicit validation-availability risk acceptance, not an unaffected or dev-only classification. Owner CodySwannGT must review by 2026-10-16; the hook does not enforce expiry. Shared templates, package/lock versions, hooks and thresholds are unchanged.

The prior exact 477b0767 normal push passed all 14 declared checks but failed the built-in production audit. Its evidence remains historical. This new exception commit requires fresh applicable validation, exact-commit runtime proof, current-head PR CI/review and publication proof before terminal issue closure. T4/T5 remain in progress and T6 pending. Current ignored context is 127636 bytes, SHA256 add7246b90c2dd82bdc40d814a764ddc580f2f81b6c9f0ba25926ae24969273c; the complete prior prefix is retained. Approval is conversation provenance, not an invented GitHub comment. Audit disposition MLD is [].

## Compatible CI floor delivery repair

Actual 61580e1b normal Git push passed all14 declared checks, 25,666 unit tests and3,178 push-profile integration tests, plus the unchanged built-in production audit with the operator-approved repository-local braces exclusion. Fresh Git and PR reads confirmed61580 despite an uncaptured immediate head-readback mismatch. Independent exact61580 runtime passed16policy and2packed-host cases, six harnesses and explicit-default control. These observations retain61580 identity.

SecurityFloors run37124259201/job111206277064 at actual checkoutd1b18c694b93a04a7a8eebcb4756cb3130b6063d failed16 source-force rows: seven high Axios advisories at both shared force sites and one Undici6 advisory at both sites. This inherited defect must be corrected before merge. Official advisory and registry records confirm compatible patched floors Axios>=1.20.0 and Undici^6.28.1. Independent scope review treats the values-only repair as T3/T4/T6 delivery follow-up, preserving all original acceptance criteria.

The worker owns both force maps in root and shared template, real lockfile regeneration, two affected existing guards and one actual-production collector/adoption regression. Root owns metadata, inventories, generated artifacts, commits, shipping and final proof. Identical final regression bytes must be RED against actual61580 ranges, then GREEN after the eight source-map corrections, with real full/restricted adoption preserving unowned defaults. Prover, workflow, gate, threshold and approved audit-exception bytes remain unchanged. Source review, exact new-commit runtime, full normal hooks, named new-head CI and public release proof remain required. T1/T2 are completed; T3/T4/T5/T6 are in progress. Task MLD is pending worker/reviewer outcome.

Current full context is232750 bytes, SHA256283bf22e5ee741c70b3a3a33c4189e118d3fb39083f9362fc40b9131e482d92a; the entire prior127636-byte prefix remains unchanged. This CI repair scope is agent analysis, not a fabricated user decision or new original business acceptance criterion. The exact approved braces exception remainsa7bd5588e0d1edec667ef9331267ba9c4c74c142097111c2e3c5a911578b8d12 with manual review by2026-10-16T23:59:59Z and no automatic expiry.


## Required nested native CI repair (metadata before implementation, 2026-10-03)

Actual615 CI integration run37124259486/job111206306083 failed both genuine host unit commands: capacity1 child waits for the normal120s admission deadline while its scaled60s work-only deadline kills it at78.5s. Causal research 19bd24bae327a6ce201db0aca207e0c4c8f69203c6f5c9055dd4260cc4882221 establishes the missing bounded phase. The fixture-only unit deadline will add the actual admission deadline plus one2s poll to the unchanged scaled60s work budget. Existing600s case budget and0.5 margin, independent host leases, native assertions and all byte/synth/idempotence controls remain binding. Docker Linux with two available CPUs must demonstrate real current-fixture RED and candidate wait-to-release GREEN. Final changed fixture bytes must also produce cf55 intended stale-policy RED, then new-head independent runtime and current CI. No fleet disabling, scheduler changes, or arbitrary timeout widening is authorized. plan_quality owns only process.ts, journey.ts and focused shared-runtime-native-deadline.test.ts; root owns artifacts/metadata/commits/submission.

Floor repair handoff: unchanged final focused tests103/103 PASS, strict live checker199packages/eight manifests PASS, normal/frozen install and scoped quality PASS. This is working-tree evidence, with new-head publication still pending.


## Final working-input repair controls (2026-10-03)

The final typed floor test again rejects the actual615 baseline at29 of103 cases and passes all103 after the same compatible eight floor-value edits. Canonical test compilation passes with its unchanged existing quarantine. The null-guard correction and preceding initial typing gap remain visible in the separate followup packet.

The native fixture-only repair passes3 focused controls and both genuine two-CPU packed-host journeys. Actual default120-second admission releases precede native TypeScript1/CDK2 tests. Complete hook-inclusive durations152242.064445ms and133554.314395ms fit the unchanged300000ms margin at measured slowdown1. All7528 packed bytes, repeated offline synth, second adoption and frozen managed snapshots pass. The identical final six fixture bytes on originalcf55 reject stale Node22.21.1 before install. The original timeout RED retains its reaper warning and real CDK rank3. Three containers are stopped, all189 external records independently verified, and working input trees are explicitly distinct from a future source commit.

The learner captured the independently proposed239-character stamped consolidation through the actual executable contract. The ledger retains20 entries and all19 unrelated exact JSONL bytes, totaling13897 bytes under14900. Confidence stays medium for one observed cause. No skill, human rule, memory or standalone issue promotion occurred.

Source implementation T3 is complete. T4/T5/T6 remain in progress for normal final commit, exact committed-head core runtime plus106 focused controls, all normal push gates, current-head remote CI/review, actual merge/configured release/public artifact and typed tracker readback. Latest fetched main4bb326e655301ad1188a57583b804fc03fe29003 is an ancestor of615, so no extra sync merge is required. External proof helpers are prepared and independently reviewed with100 pure controls only. No future execution or shipping success is inferred.

## Named repair-control followup, recorded before source edit

The exact a7f832 core replay passed. Its focused normal-wrapper invocation passed all106 tests, but the evidence validator rejected four duplicated root undefined titles. A dotted Vitest placeholder caused the reporting defect. Change the title separator only, preserve the actual106 output and validator failure, and prove the distinct reported names before a normal followup commit and genuine new-head verification. Production policy, assertions and the strict unique-name validator remain unchanged.

Working-input correction now passes all106 cases and the unchanged strict named-case validator, with four distinct root map/dependency labels. Only the title separator changed. Scoped lint/format passed, no compiler rerun was needed, and old source/report/helper bytes remain preserved. Exact futureB/runtime/CI/publication are still pending.

# Safe native push failure diagnostics

Work-Item: CodySwannGT/lisa#4347

## Bounded native package summary fix — 2026-10-12

The provider diagnostics are merged in PR #4435 and published as authentic Lisa 4.75.1. A fresh hosted invocation now fails earlier in preparation with `stage=unknown native=output-bound status=null signal=SIGTERM`. A native Node 22.23.3 reproduction using the existing helper's exact registry commands proves that the registry view succeeds (130,676 stdout bytes), while `npm pack --json --ignore-scripts` exhausts its unchanged 1,048,576-byte output limit. The downloaded archive matches the actual published SHA512 integrity, and the owned temporary root is positively absent afterward. This proves the new preparation failure; the older checkpoint failure remains unproved.

Current source base: released main `da9f544cbc289f30711c26f846e4b2d78d7f0332`; attached branch `codex/4347-bounded-pack-output`. The original claimed leaf is reused.

Admit the existing quality teammate as the bounded builder of only `all/copy-overwrite/scripts/lib/npm-update-helper.mjs` and `tests/unit/scripts/npm-update-classifier-cache.test.ts`. Request a silent native package summary instead of the complete JSON file inventory; accept only the one exact expected archive filename and newline. Preserve `--ignore-scripts`, the original output limit and deadline, independent registry identity, streamed archive integrity, exact archive member checks, ownership, cleanup and all cached-authentication refusal controls. Prove meaningful RED/GREEN and malformed filename, duplicate output and invalid archive negatives. Do not widen a bound or accept truncated JSON.

The existing security teammate independently reviews the frozen source and tests. The existing transport verifier runs the actual quiet command against the authentic published package with unchanged limits and independently proves filename selection, archive integrity and owned cleanup. Root owns this metadata, official helper graph and derived generation, ordinary commits, one source PR, existing protected checks, actual publication and consumer adoption. All original six hosted scenarios and final fixture cleanup remain pending; no source or consumer ticket is complete from this local fix.

The remaining sections retain their original historical observations and admissions.

Base: current main 5c1778a99257c712d1ce7314a3e4fac988dd5332. Sole permanent integration branch is main. Existing claimed leaf and worktree-local binding are retained; this task preserves the original six acceptance scenarios.

The actual hosted run passed preparation and signed allocation, then exited at gate-push with native status 1 before publication. The complete job log and artifact inventory retain no original child transcript. No underlying hook, test, or audit-versus-destination cause is established. Unchanged replay cannot recover the lost evidence.

1. Builder adds bounded non-authoritative classification from actually captured native failure bytes. Fixed known hook names, strictly validated committed test locations and bounded numeric summaries are the only admissible output. Unknown output remains unclassified. Arbitrary exception properties, raw transcript tails, credentials, environment, SQL and arguments never leave the process.
2. Prove RED before GREEN using real native failing-process capture, hostile and forged-output negatives, path escapes and preservation of nonzero status, original limits and cleanup. Existing diagnostic tests are relevant documentation; source capture and public formatter establish the loss chain.
3. Separate reviewer checks exact source and executes meaningful controls. Root regenerates official artifacts, commits through normal hooks, opens one PR and drives its unchanged protected gates to merge. New evidence may reopen review; speculative findings cannot.
4. Qualify actual published release, adopt with native coherent locks and full Fleet apply, then resume the original hosted acceptance and recovery journey. Diagnostics passing locally does not complete the source leaf or caller integration ticket.

Roster: .lisa/roster/CodySwannGT-lisa-4347.md. Learnings may be empty; do not invent entries. Preserve all foreign work, failed-run evidence, canonical metadata and review policy. No application deployment.

## Task metadata

```json
{
  "plan": "4347-safe-push-diagnostics",
  "type": "bug",
  "acceptance_criteria": ["Actual native failed push retains bounded non-authoritative diagnostic labels while failing", "Hostile output and forged properties cannot expose arbitrary bytes or establish authority", "All original six acceptance scenarios remain required after release and adoption"],
  "relevant_documentation": "Native capture in npm-update-native-process.mjs; pushProposal in npm-update-gate.mjs; WeakMap-backed publicFailure in npm-update-invariants.mjs; existing npm-update-diagnostics.test.ts",
  "work_item_context": ".lisa/work-item-context.md",
  "testing_requirements": ["Real native process RED/GREEN controls", "Forged exception, hostile transcript and path escape negatives", "Named regression execution in required PR CI", "Separate empirical CLI observation"],
  "skills": ["lisa-implement", "lisa-git-submit-pr", "lisa-drive-pr-to-merge"],
  "learnings": [],
  "required_access": [
    {"tool": "GitHub source and tracker", "probe": "gh issue view 4347 --repo CodySwannGT/lisa; gh api repos/CodySwannGT/lisa/branches/main", "status": "pass"},
    {"tool": "Git transport", "probe": "git fetch origin main", "status": "pass"},
    {"tool": "Hosted runtime Docker", "probe": "docker version --format '{{.Server.Version}}'", "status": "pass"}
  ],
  "verification": {
    "type": "cli-test",
    "command": "Execute an owned native child emitting a known failed-hook line plus hostile canary, retain its original exit 1, then invoke the source public formatter through the actual registered native failure",
    "expected": "Exit 1 is preserved, the fixed non-authoritative classification is visible, and canary/raw child bytes are absent"
  }
}
```

The context path is worktree-relative in this public artifact to avoid publishing operator paths. Teammates receive the exact absolute worktree-local context path privately. The complete comment inventory remains in that ignored canonical bundle and was consumed by the resolver. Required Actions policies were re-read as read/false for source and caller. Docker server responded 29.2.1. No permission setting has been changed for this diagnostic work.

## Exact derived effects and delivery ownership

Root owns official regeneration of all/copy-overwrite/scripts/npm-updater-helper-graph.json, src/core/lisa-owned-hash-ledger.ts, src/core/upstream-evidence-manifest.ts and src/core/export-surface.json when their native freshness checks require it. The existing modules are in the helper graph; any added exported diagnostic helper must appear in the export-surface artifact. No generated output is hand edited. Stage authored inputs first, await each official generator, stage outputs, then run the complete unchanged artifact aggregate.

The builder selected no new module and no exposed test-path surface. Only explicit fixed Lefthook failure-summary labels and complete bounded RSpec numeric tuples may leave observed failing native capture. The push invocation supplies a fixed audit/destination diagnostic role. Every child-derived label is explicitly non-authoritative; a mere check heading is not a failed-check report. Source runtime uses Node 24.21.0 and Bun 1.3.8. Portable native tests also use the qualified Node 22.23.3 updater where relevant.

## Required lifecycle-test clock correction — 2026-10-11

The corrected ordinary full push reached four unrelated existing lifecycle assertions and refused them on actual `Plugin command timed out` failures. The unchanged six-case file then passed through the original native runner with runtime, fixture and test hashes preserved. This proves a wall-clock prerequisite in the four non-timeout tests; the reason the full-run commands completed later is not established. Preserve both native observations rather than treating isolated success as a full-push result.

Before implementation, admit only `tests/unit/core/plugin-command-lifecycle.test.ts` to the existing bounded builder. Control only the command clock using the file's existing timeout-case technique. Observe genuine child completion using the captured real scheduler and existing calibrated I/O liveness bound. Retain each success, native exit, permission-error, settlement and timer assertion; retain the 2,000 ms command options and the independent timeout/IPC/signals/cleanup case. Finally exercise only this invocation's timeout and grace callbacks, await its owned outcome and restore the test clock. No production file, production deadline, skip, exemption, concurrency profile or fixture weakening is admitted.

Root owns metadata, official generation and ordinary delivery. A different reviewer verifies source and actual native execution after the final test bytes freeze. The full ordinary push, one batched source PR, actual release and caller adoption remain required, followed by all six original hosted criteria. No criterion is discharged by this test correction.
## Required worker-cap test isolation — 2026-10-11

The next ordinary full push passed the lifecycle suite but failed four existing worker-floor assertions: an injected empty environment still called the real fleet-discovery default and correctly returned four workers while another run was live. The floor tests must also inject the existing discovery seam for their stated lone-run scenario. Runtime discovery, actual worker limits, concurrency, all expectations and the separate fleet-discovery controls remain unchanged.

The existing builder owns only `tests/unit/config/vitest-worker-cap.test.ts` for this test-input correction and its explanatory helper documentation. Run the original cap and fleet-discovery suites plus scoped lint. A different reviewer verifies the exact correction and native evidence. Root owns metadata, genuine artifact checks, a separate normal small commit and the unchanged ordinary full push; retain the failed full run and original six hosted acceptance requirements.

## Required native registry protocol correction — 2026-10-11

The ordinary full run passed all 27,731 unit tests but refused one of 3,540 integration tests: the real Expo installation hit its unchanged process deadline. An unchanged isolated Expo run reproduced that refusal. Neither observation proves the stalled substage. Genuine public registry probes returned successfully over both address families. Actual Bun 1.3.11 request observation and its tagged implementation establish that native requests negotiate installation metadata; the fixture proxy drops that Accept header and downloads larger full-history metadata instead. Measured Expo, React Native and Jest responses were approximately twice as large without negotiation. This proves a protocol defect, while its role in the timeout still requires the original native case.

Admit a bounded builder only to `tests/fixtures/shared-runtime-hosts/artifact.ts`: faithfully forward the request's Accept header to the existing genuine npm fetch. Preserve its absence when absent and forward no authentication or unrelated header. Preserve registry origins, exact candidate archive, response handling, dependency graph, caches, native commands, concurrency, deadlines, successful-case timing margin and all assertions. Do not substitute fixtures or remove native framework work. Root owns this metadata, generation, original Expo execution, normal commit/push and actual delivery. A different reviewer checks exact source and genuine reaching evidence. If the repaired original case still fails, retain it and continue diagnosis rather than widening budgets. All six original hosted criteria remain required.

## Required explicit package lifecycle declaration — 2026-10-11

The repaired protocol candidate still failed its original native Expo install deadline. Owned process observations show genuine dependency installation entered the Claude plugin installer and continued plugin operations at 195 seconds, just before the 199,376 ms deadline. The install helper's existing lifecycle guard should leave agent installations unchanged. Four genuine trusted local dependency installations on Bun 1.3.8 and 1.3.11 prove the selector defect: Bun preserves an inherited `npm_lifecycle_event=lisa-test-run` rather than replacing it with `postinstall`, so the helper's empty-event Bun fallback does not run.

Admit only `package.json` and the existing `tests/unit/scripts/install-claude-plugins-self.test.ts` to the current builder. Declare the known `postinstall` event explicitly at the package's own setup-helper invocation, rather than broadening the helper's interpretation of explicit setup. Keep the remaining merge-driver and source-only TypeScript build commands unchanged. The corresponding root `package.lisa.json` has no postinstall declaration; do not introduce one into host governance. Add a reaching RED/GREEN regression executing the actual declared command with inherited Bun selectors and existing isolated agent tripwires, preserving configuration and no-agent-operation assertions. Root then runs the original Expo case with unchanged dependencies, cache, concurrency, deadlines, framework work and assertions. A different reviewer verifies exact bytes and actual proof. All six original hosted requirements, ordinary full push, one batched PR, release and caller adoption remain outstanding.

## Closed provider diagnostic followup — 2026-10-12

- [x] Reproduce missing provider labels with real supervised native failures: six RED cases, seven passing controls.
- [x] Add source-selected closed request-purpose and method labels only to registered native failures, plus a bounded non-authoritative HTTP hint. Five focused files pass 112 controls; exact exception, argv, environment, stdin, deadline and one-call behavior are preserved.
- [ ] Complete independent current-source quality and security review, normal generated artifacts, full native push and protected source merge.
- [ ] Qualify the authentic release and adopt it through coherent locks, official full apply, ordinary hooks and protected consumer merge.
- [ ] Observe the next actual hosted checkpoint operation and complete the original six acceptance journeys and owned cleanup. The prior partial v2 record remains evidence only.

## Required native deadline-suite ordering correction — 2026-10-12

The final provider diagnostic head passes 27,801 unit controls but the ordinary full push fails five existing optional-freshness integration assertions. An unchanged focused reproduction passes all 29 controls. Installed Vitest 4.1.11 routes isolated, single-worker group zero into a special sequential group appended after numbered groups. The current local configuration therefore runs the deadline suites after the bulk suite, contradicting its stated first-group intent. Actual retained process births place these controls more than seven minutes after integration startup; this proves ordering, not the exact cause of each lost optional observation.

Admit only `vitest.config.local.ts` and a reaching native scheduling regression in `tests/unit/config/vitest-deadline-order.test.ts` to the existing quality teammate. Use explicit positive ordered groups for the deadline and bulk projects. Preserve worker counts, isolation, discovery, all real guards, assertions, physical deadlines and cleanup. The regression must exercise the installed Vitest runner and actual local scheduling plugin, observe execution order, fail before the correction and pass afterward. Root owns official derived artifacts, normal small commits and the unchanged full native push. A different teammate independently reviews the exact correction. The original six hosted requirements and cleanup remain outstanding.

## Native regression supervision correction — 2026-10-12

The first current-main full push at ccf1bbccd5c4498bfd14bf8438b078abc1aa21bd ran 27,855 passing unit controls and two actual failures. The existing mandatory supervision guard identified the newly added deadline-order regression as a bare Vitest child: its bounded launcher protects only the immediate process, not the full test descendant group. Admit only the new regression test to the existing quality teammate to use the existing source lisa-test-run route, preserving all ordering assertions, actual installed runner and local plugin, file-backed fixture, worker limits, liveness bound and owned cleanup. Retain the existing full-run guard failure as RED; prove the unchanged guard and corrected native scheduling control pass together. Root resolves the separate missing current release tag by fetching its genuine provider ref if it exists, without synthesizing a stamp or changing resolution rules. Review independently, normal small commit, then run the original complete native push once at the corrected head. Original hosted acceptance remains outstanding.

## Actual hosted RSpec failure diagnosis — 2026-10-12

The qualified 4.75.2 invocation passed preparation, authenticated old-proposal cancellation and fresh allocation. Its native audit gate then exited 1 with 716 RSpec examples and 14 failures. Publication did not run. The retained summary omits the failed-example locations, so neither their identity nor cause is established. Actual terminal collection and restoration finished once with all original protections unchanged. Do not retry unchanged or treat a local diagnostic as hosted acceptance.

Task type: bounded bug fixes under the original #4347 acceptance scope. The existing quality teammate owns `all/copy-overwrite/scripts/lib/npm-update-hosted-hook.mjs` and `tests/unit/scripts/npm-update-hook-entry.test.ts`. Admit only the exact current source-generated Rails inline command alongside the previously accepted exact command. Arbitrary modified eval and missing graph entries remain unqualified. Its reaching RED is one failure among 14 classifier controls against the actual emitted source template.

The existing builder owns a leaf RSpec-report helper, `npm-update-invariants.mjs`, `npm-update-native-process.mjs`, `npm-update-gate.mjs` and their focused tests. Before the audit, capture a bounded committed spec catalog from the already authenticated proposal parent through original native Git. Recognize only actual failed-example footer locations, select output paths from that independent catalog, enforce positive line bounds, discard descriptions and unknown paths, deduplicate and cap at twenty. Catalog refusal yields absent diagnostic locations rather than changing the gate result. Never serialize raw child output or use a diagnostic as execution, provider, retry or approval authority.

Acceptance criteria: native failure status, original error identity, hostile-getter resistance, argv/environment/stdin, original output bound, deadline, role, token removal, broker permissions and one-call behavior are unchanged. Only native failed audit/destination reports with positive unambiguous RSpec failure counts can emit catalog-selected locations. Exact current and previous generated inline forms qualify only with graph membership. Modified forms remain ordinary unqualified code. All six original hosted journeys and final cleanup remain required.

Documentation: this plan and per-item roster record the failed-run boundary and admitted source paths. Root owns the generated helper graph, hash ledger, evidence manifest and export surface using official generators only. Testing: meaningful native RED/GREEN with committed Git catalog fixtures, real child capture, unknown/malformed/traversal locations, hostile descriptions, zero/conflicting counts, caps, deduplication and forged exceptions. Independent quality/security review follows the final bytes. Verification command: original supervised `lisa-test-run` route executing the focused classifier and diagnostics suites. Expected: regression fails before correction and every focused control passes afterward without authority changes. Then complete the ordinary full push, protected source merge, qualified release and adoption before the next actual hosted attempt.

Skills: retain Lisa Implement, TDD, source documentation, normal commit/PR and GitHub sync workflow. Learnings: consume the bounded project projection and retain evidence-backed candidates only through the existing judge/learner contract. No promotion or rule edit is admitted here.

## Full-push prerequisite and closure correction — 2026-10-12

The ordinary full push refused fifty tests. The runner did not receive the explicitly required genuine updater Node and native host Bun paths, and the checkout lacked the real current release tag. Restore those test inputs and fetch the existing remote tag without changing production behavior or qualification checks. Five unchanged files then pass forty native controls under the original supervisor.

The added committed-spec reporting helper also expands the authenticated closure from 109 to 110 members. The existing builder owns only the exact-count assertion in `tests/unit/scripts/npm-update-contract.test.ts` and an explicit assertion that the intended reporting helper is present. Keep every missing-member, foreign-member, hash, size and selector control. The original focused contract suite passes 114 controls. Independent review must cover the final correction before the normal small commit and complete push retry. Root owns runtime selection, official artifact freshness, the batched PR and all remaining original hosted acceptance requirements.

The corrected full push passes all 27,924 unit tests and required coverage, then reaches two integration failures. The materialization test needs the corresponding exact managed count of 108 (the complete controller closure has two additional controls) and must prove the new helper's materialized bytes and controller membership. Extend the same builder's ownership only to `tests/integration/npm-update-all-host-helpers.test.ts`; retain all refusal and integrity assertions. The separate unchanged Rails isolation file requires the actual CI Ruby installation with Active Record 8.1.4. The default local Ruby lacks that gem; the real CI Ruby runs all 54 original controls successfully. Root supplies that genuine runtime, with no Ruby test or production changes. Independent review of the four passing materialization controls precedes a normal small commit and complete original push retry.

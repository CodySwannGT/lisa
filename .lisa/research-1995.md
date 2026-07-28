# Research map — #1995 (explorer-1995 deliverable, lead summary)

## Headline reframing
Suggested fix #1 (fs lock) is ALREADY IMPLEMENTED and wired in. `src/core/learnings-lock.ts` (377 lines,
hard-link protocol, stale reclaim with the #1878 TOCTOU hardening) wraps the whole read-modify-write in
`persistConsolidatedLearning` (src/core/learnings-writer.ts:72-89) and `confirmLearningEntry` (:144-180).
Same-process AND cross-process concurrency regression tests already pass.

The observed corruption is a **git merge artifact, not a torn write**. Conflict markers can only come from git.
Each learner pass runs on its own branch `learning/<fingerprint>` in its own worktree
(plugins/src/base/skills/lisa-persist-learning/SKILL.md Phase 3 step 4), so N concurrent passes produce N
concurrent PRs merging the same JSONL block. A path-scoped lock provably cannot serialize two worktrees.
The "lost consolidation target" is the same cross-branch cause: writer A supersedes id X on its branch;
writer B's branch never saw X removed.

## Scope decision (lead)
- **IN — Fix #4 (parse guard):** conflict-marker scan in src/core/learnings-document.ts before the fence check
  at :38, throwing a specific "corrupted by concurrent write — recompact" error instead of the generic
  `Invalid project learnings file format` / `Invalid project learnings JSONL payload`. Wire remediation into
  src/core/learnings-budget-check.ts:109-124. Cheapest, highest signal; flows straight into the CI gate.
- **IN — Fix #3 (git-layer root cause):** `.gitattributes` (repo has NONE today) + union-by-id merge driver.
  Entries are one-JSON-per-line sorted by id (learnings-writer.ts:228-230) and duplicate ids already rejected,
  so a driver can deterministically union by id, re-render via renderLearningsFile, re-assert budget.
  Must ship to host projects via the template/apply path, not only the Lisa repo.
- **IN — Fix #1 hardening:** the writer has NO fsync (compare src/standards/storage.ts:136-142 which syncs file
  + containing dir). Extract the atomic temp-write+rename block duplicated 4x
  (learnings-writer.ts:77-87 and :164-173, health/storage.ts:~98-110, standards/storage.ts:130-146).
- **OUT — Fix #2 (append-only intake + gardener compaction):** largest option, a contract/format change with the
  full 5-tree plugin fan-out and every contract-parity test in play. Issue says "any of" — record as deferred.

## Key file:line anchors
- Writer chokepoint: src/core/learnings-writer.ts — persistConsolidatedLearning :58-90, confirmLearningEntry
  :126-181, buildNextDocument (supersede + missing-id throw) :210-234, validateSupersedeIds :241-256.
- Parse/render/budget: src/core/learnings-document.ts — parseLearningsFile :32-54 (byte guard :33-37,
  fence check :38-43, parseJsonLines :127-136), assertDocumentBudget :62-78.
- Safety: src/core/learnings-file-safety.ts — resolveSafeLearningTarget :13-25, readExistingLearnings :32-69,
  assertSafeLearningParents :76-91.
- Lock: src/core/learnings-lock.ts — withLearningTargetLock :27-32, withFileTargetLock :40-56,
  observeStaleLock :158-177, reclaimObservedStaleLock :185-208, pinnedLockStillStale :219-247.
  Constants :4-6 (200 attempts, 10ms, 30s stale).
- Budget contract: src/core/learnings-contract.ts — MAX_ENTRIES 20 :14, PER_ENTRY_BYTE_ALLOWANCE 600 :37
  (an AVERAGE), maxTokens 12000 :39-56.
- Gate: src/core/learnings-budget-check.ts :63-97, remediation text :109-124.
  CI: .github/workflows/quality.yml:636-653 (self-detects Lisa source repo since PR #2007).

## Test surface
- tests/unit/core/learnings-writer.test.ts (310 lines) — same-process concurrency :132-142, repeated contention
  :145-161, malformed fence :268-284.
- tests/unit/core/learnings-concurrency.test.ts (82 lines) — THE cross-process template: inline writer source
  :16-24, spawns 10 real `bun --eval` children :60-71.
- tests/unit/health/storage.test.ts:334 — second cross-process lock template.
- Harness: vitest, createTempDir() from tests/helpers/test-utils.ts:27-29, ledger at <tmp>/.lisa/PROJECT_LEARNINGS.md.
- NO test exists for conflict-marker input, cross-branch/merge behavior, or a merge driver.
- TRAP: a test shelling out to real git MUST strip all GIT_* env keys (hook-set GIT_DIR/GIT_WORK_TREE poison
  temp repos; passes standalone, fails under pre-push).

## Obligations
- Ledger surfaces fan out from plugins/src/base: agents/learner.md -> 4 copies; skills (persist-learning,
  debrief-apply, learnings-audit, 3x build-intake) -> 5 copies each incl .codex-plugin;
  rules/*/project-learnings.md -> 2 trees. Rebuild with `bun run build:plugins`, verify `bun run check:plugins`.
- `bun run build:upstream-evidence-manifest` in the SAME commit for any template/source edit; and stage new
  files BEFORE regenerating (the generator walks git ls-files).
- Contract-parity tests assert literal substrings in generated skills:
  tests/unit/strategies/learner-capture-contract.test.ts, debrief-reroute-contract.test.ts,
  learnings-confirmation-contract.test.ts, learnings-audit-contract.test.ts, project-learnings-rule-pair.test.ts,
  promotion-contract-rule.test.ts, tests/unit/templates/project-learnings-template.test.ts.

## Current state
Real ledger is 11577/12000 bytes = 96.5% full, ~423B headroom, so supersede-in-place is effectively mandatory
for every new capture right now — the racing-write pattern is maximally likely today.

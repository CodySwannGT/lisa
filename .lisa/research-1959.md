# Research: learnings-ledger-budget — CodySwannGT/lisa#1959
(Authored by ledger-explorer T1; pasted by lead — the Explore agent had no write tool.)

## 1. The two caps — definitions & enforcement sites
Both caps live in ONE frozen contract `src/core/learnings-contract.ts:26-28`: maxProvenanceReferences 20, maxEntries 20, maxTokens 4000; measurement utf8-bytes (`estimateLearningTokens=Buffer.byteLength`, :50-52). The "4000-byte cap" IS maxTokens.
Enforcement (all import the one contract): learnings-document.ts:62-78 assertDocumentBudget (throws on maxEntries :67-71 and maxTokens :72-77); :33 parseLearningsFile pre-check; learnings-budget-check.ts:63-97 checkLearningsBudget (CI-facing, discriminated union). Persist writer learnings-writer.ts:232,197 call assertDocumentBudget → THROW on overflow.
Wiring: package.json:34 check:learnings-budget → scripts/check-learnings-budget.ts (default target all/create-only template, exit 1). CLI src/cli/check-learnings-budget-cmd.ts (missing file = pass). CI .github/workflows/quality.yml:626 runs the PINNED PUBLISHED bunx @codyswann/lisa@2.243.0 against THIS repo ledger — uses PUBLISHED contract (4000) until a release ships; local npm script uses LOCAL source.

## 2. Persist
persistLearningEntry delegates to persistConsolidatedLearning (writer.ts:38-43,58-90). supersede[] ids dropped in the same atomic temp+rename write under withLearningTargetLock. Budget = assertDocumentBudget at :232 THROWS on overflow — no supersede-in-place-on-overflow, no overflow sink. "No-budget drop → report text only" is SKILL-level: lisa-persist-learning/SKILL.md:176. Fix 2/3 hook that over-budget branch (agent-side; marker/ticket creation is agent-side, not code).

## 3. Bytes-per-entry & derived budget
Current ledger 3999 B / 8 entries: per-entry 377,474,563,606,520,369,599,412 → avg 490, min 369, max 606; header overhead 72 B. rule ≤240 chars/≤2 lines; why capped only at maxTokens.
RECOMMEND: PER_ENTRY_BYTE_ALLOWANCE=600; maxTokens = maxEntries*600 = 12000. Derived (not flat) so caps can never re-diverge. Tighter alt 512→10240 (still >20×490).

## 4. Gardener channel (Fix 2 — REUSE)
Gardener lisa-learnings-audit/SKILL.md consumes the ledger via parseLearningsFile+projectLearnings (measures budget pressure = entries the projection omits) and the tracker (prior gardener tickets = memory). Reusable emission = marker-comment dedupe discipline in lisa-persist-learning/SKILL.md (drop note `<!-- [lisa-learning-drop] key=<fp> -->` :53-55, dedupe :67; general discipline :44 match-marker-not-title, one marker/body, dedupe open+closed).
EMIT saturation signal on a budget-forced drop: ONE marker-deduped tracker signal keyed on a saturation fingerprint, fires once per saturation not per capture, suppressed while an equivalent open signal exists.
CAVEAT (:86): gardener excludes any `[lisa-learning-*]`-marked item from candidacy. PREFER option (b): the gardener ALREADY samples budget pressure from the projection, so the signal's only job is idempotent operator-visible notification — use a marker the gardener reads as budget-pressure evidence (or outside the excluded namespace), NOT a new candidate stream.

## 5. Fix 3 overflow — DEFER
No overflow/drain pattern exists; adding one needs the atomic-temp+lock+assertSafeLearningParents machinery for a new file + a gardener drain step + 6 plugin projections + a contract test — invasive, duplicates "communicate through the tracker". Its only unique value (durable dropped CONTENT) matters only at the hard 20-entry cap. Derived budget already rescues the 9 stranded drafts (T6 dogfood). DEFER to follow-up; ship Fix 1 + Fix 2.

## 6. Tests + doc
learnings-contract.test.ts:59-61 HARD-asserts maxTokens 4000 — MUST change + assert the derivation. Also: learnings-budget-check.test.ts, learnings-writer.test.ts, scripts/check-learnings-budget.test.ts (+ -helpers.ts fixture builder: writes ad-hoc ledgers to tmp via writeFileSync/cpSync — the R1 fixture convention), cli/check-learnings-budget-cmd.test.ts, strategies/learnings-audit-contract.test.ts. Contract IS the doc; prose to sync: lisa-persist-learning/SKILL.md:176 + gardener budget-pressure wording.

## 7. History
Learnings CORE all merged (afced2789/8bd3a9482/c32ea39ac/…); nothing in flight touching caps. Ledger FILE churned by another session today (content only). Expect ledger-file merge, not code.

## Headlines
1. Derived budget maxTokens = maxEntries * 600 = 12000. Update learnings-contract.ts:26-28 + learnings-contract.test.ts:59-61.
2. Fix 3 OUT (defer); ship Fix 1 + Fix 2 (skill-level saturation signal, option b).

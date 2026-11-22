# Roster Decision — CodySwannGT/lisa#4504

Work item: fresh-clone plugin registration failure despite a matching sync marker.
Flow: Implement → Fix (mandatory Reproduce first). If the reported cause does not
reproduce, the outcome becomes Investigate findings plus whatever confirmed defect
the investigation produces.

- INCLUDE - Explore - Mandatory read-only research of computePluginSyncPlan / readInstalledPluginIds / postinstall paths and git history.
- INCLUDE - lisa:debug-specialist - Proves the actual cause by execution on the real postinstall path rather than the unconfirmed hypothesis.
- INCLUDE - lisa:bug-fixer - Writes the failing regression test and the TDD fix once the cause is proven.
- INCLUDE - lisa:verification-specialist - Independent verdict: runs the real postinstall sync against a scratch registry and records verification-status.json.
- INCLUDE - lisa:learner - Captures task learnings to the ledger.
- INCLUDE - general-purpose - Lead-session planning helpers named by the skill (plan name, base branch, completion condition); no narrower specialist covers those.
- EXCLUDE - lisa:git-history-analyzer - The groom note already dates the relevant behavior (ab20b8746b7); Explore covers the remaining history lookups.
- EXCLUDE - lisa:quality-specialist - Code review is run by lisa-git-submit-pr's local review; a separate quality pass would duplicate it for a small change.
- EXCLUDE - lisa:test-specialist - The bug-fixer owns the single regression test; no broader test strategy is needed.
- EXCLUDE - lisa:spec-conformance-specialist - The item has no Gherkin AC; conformance is checked against the "Expected" section by the verification-specialist.
- EXCLUDE - lisa:product-specialist - No user-facing UI surface; install-time CLI behavior only.
- EXCLUDE - lisa:architecture-specialist - Fix is localized to the plugin sync path; no design decision.
- EXCLUDE - lisa:security-specialist - No auth, input, or secrets surface touched.
- EXCLUDE - lisa:performance-specialist - No performance dimension.
- EXCLUDE - lisa:builder - This is a Fix, the bug-fixer owns it.
- EXCLUDE - lisa:github-agent - Tracker read/claim already done by the input-resolver; lead runs the lifecycle skills.
- EXCLUDE - lisa:eval-specialist, lisa:learning-judge, lisa:learnings-synthesizer, lisa:skill-evaluator, lisa:pr-mining-specialist, lisa:tracker-mining-specialist - Debrief/gardener/eval flows, not Implement.
- EXCLUDE - lisa:*-build-intake, lisa:*-prd-intake, lisa:jira-agent, lisa:linear-agent - Intake/other trackers; not applicable.
- EXCLUDE - Plan - Lead plans inline; Explore + debug-specialist cover research.
- EXCLUDE - claude, claude-code-guide, code-simplifier:code-simplifier, hookify:conversation-analyzer, statusline-setup, web-fetch - Not relevant to this fix.

Target environment: none named on the item; remote default branch `main` maps uniquely to `production` → `Assumption: production — remote default branch main`.
Base branch: main. Feature branch: claude/4504-plugin-registration-fresh-clone.
Tool access: gh (probed via the resolver's live read: pass); claude CLI (needed only for live registration observation; probe in verification).

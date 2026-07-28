# Roster Decision — plan: learnings-ledger-budget (CodySwannGT/lisa#1959)

Runtime: Claude Code, implicit-team model. Work type: Fix (bug label) — a contract/budget correction + saturation-signal emission. Repro-first discipline.

INCLUDE - Explore - flow-required; map the executable ledger contract, the budget check script (scripts/check-learnings-budget.ts), the persist mechanism (persistLearningEntry / persistConsolidatedLearning), where the 20-entry and 4000-byte caps are defined, and how a "gardener queue item" is emitted elsewhere (so the saturation signal reuses an existing channel, not a novel one).
INCLUDE - lisa:bug-fixer - repro-first TDD: demonstrate byte-cap-binds-before-entry-cap saturation + silent drop, then the fixes.
INCLUDE - lisa:quality-specialist - the saturation signal creates an external artifact (gardener-queue item / overflow file) — review for spam/idempotency (don't emit on every capture), design soundness, contract-doc accuracy, test quality.
INCLUDE - lisa:verification-specialist - independent verdict incl. a live capture that now fits ~20 entries and emits the signal on drop; also confirms conformance to the scoped suggested-fix set.
INCLUDE - lisa:learner - flow-required — AND this flow's own fix should let its stranded drafts (and the 9 from #1960/#1956/#1957/#1958) finally persist; the learner validates that dogfood.
INCLUDE - general-purpose - bounded chores only.
EXCLUDE - lisa:security-specialist - no trust boundary crossed; a budget integer + a signal file/issue emission. The gardener-signal's external-artifact concern (spam/idempotency) is folded into the quality review, which will escalate to a security pass only if it finds an injection/abuse lane.
EXCLUDE - lisa:spec-conformance-specialist - issue has no AC; the plan's completion condition is the derived spec and the verifier proves it + maps the scoped fixes (consistent with roster-1957/1958 for thin issues).
EXCLUDE - lisa:builder - Fix type; bug-fixer owns it.
EXCLUDE - lisa:test-specialist / debug-specialist / architecture-specialist - single well-diagnosed contract fix; the issue enumerates root cause and the fix menu.
EXCLUDE - performance/product/git-history/debrief agents, lifecycle wrappers, intake scanners, skill-evaluator (via learner), code-simplifier, coderabbit reviewer, claude-code-guide, Plan, claude, statusline-setup, business-domain agents - same rationale as prior rosters this session.

All spawns model=opus.

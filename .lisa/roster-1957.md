# Roster Decision — plan: linear-bare-repo-label (CodySwannGT/lisa#1957)

Runtime: Claude Code, implicit-team model. Work type: Fix (bug) — Reproduce-first.

INCLUDE - Explore - flow-required; bounded map of assertRepoScope/component-fallback/Linear bind path + the intake-side bare-label matching rule to mirror.
INCLUDE - lisa:bug-fixer - repro-first TDD: failing Linear-shaped bind test, then the Option-A fix.
INCLUDE - lisa:quality-specialist - review with an explicit security lens folded in (see exclusion note below).
INCLUDE - lisa:verification-specialist - independent verdict incl. live bind simulation with Linear-shaped labels.
INCLUDE - lisa:learner - flow-required.
INCLUDE - general-purpose - bounded chores only.
EXCLUDE - lisa:security-specialist - the change widens an accepted label vocabulary within the SAME authority domain (Linear labels already grant scope via repo:<name>; bare <name> is equally authored content — no new trust boundary crossed, unlike #1956's push-range/abort relaxations). The quality review is explicitly tasked with verifying no cross-repo mis-scoping lane opens; if it finds one, a dedicated security pass will be added.
EXCLUDE - lisa:spec-conformance-specialist - the issue has no AC/journey sections (thin by Lisa standards); the plan's completion condition IS the derived spec and the verifier proves it directly — a separate conformance matrix over a one-function fix duplicates the verifier.
EXCLUDE - lisa:test-specialist - repro design is intrinsic to the single-lane fix; existing suite conventions apply.
EXCLUDE - lisa:debug-specialist / architecture-specialist - root cause and design already line-diagnosed in the issue.
EXCLUDE - lisa:builder - Fix type; bug-fixer owns it.
EXCLUDE - performance/product/git-history/debrief agents, lifecycle wrappers, intake scanners, skill-evaluator (via learner), code-simplifier, coderabbit reviewer, claude-code-guide, Plan, claude, statusline-setup, business-domain agents - same rationale as roster-1956.

All spawns model=opus.

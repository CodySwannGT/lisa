# Roster Decision — plan: heredoc-classifier-fps (CodySwannGT/lisa#1958)

Runtime: Claude Code, implicit-team model. Work type: Improve (enhancement label) — but repro-first discipline anyway: the false positives are reproducible behaviors and the change relaxes a security classifier, so red fixtures precede any code.

INCLUDE - Explore - flow-required; MANDATORY fresh-anchor pass (both #1976 and #1979 rewrote the hook today — every line citation in the issue is presumed stale).
INCLUDE - lisa:builder - Improve-type implementation, TDD.
INCLUDE - lisa:security-specialist - REQUIRED: the change reclassifies a class of heredocs from blocked to guard-scanned; must prove quoted-delimiter detection is parser-sound (no half-quoted/mixed/nested trickery reclassifies an EXPANDING heredoc) and that reclassified payloads still trip content guards.
INCLUDE - lisa:quality-specialist - python classifier + shell hook conventions, message-text accuracy, fixture quality.
INCLUDE - lisa:verification-specialist - independent verdict incl. live drives of the real hook with the exact TUN-242-era failing commands.
INCLUDE - lisa:learner - flow-required.
INCLUDE - general-purpose - bounded chores only.
EXCLUDE - lisa:bug-fixer - Improve type; builder owns it (repro discipline carried in the plan, not the agent type).
EXCLUDE - lisa:spec-conformance-specialist - issue is thin (no AC/journey); the plan's completion condition is the derived spec, proven directly by the verifier (same justification as roster-1957).
EXCLUDE - lisa:test-specialist - fixture design follows the established heredoc/guard suite conventions; single-lane change.
EXCLUDE - lisa:debug-specialist / architecture-specialist - behaviors already diagnosed to function level; structure unchanged.
EXCLUDE - performance/product/git-history/debrief agents, lifecycle wrappers, intake scanners, skill-evaluator (via learner), code-simplifier, coderabbit reviewer, claude-code-guide, Plan, claude, statusline-setup, business-domain agents - same rationale as roster-1956/1957.

All spawns model=opus.

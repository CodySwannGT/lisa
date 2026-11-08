# Roster Decision — CodySwannGT/lisa#4640

Work type: Fix (Bug). Learnings merge driver registered with an absolute,
worktree-local path; dies when that worktree is removed; doctor stays green.

INCLUDE - Explore - mandatory read-only research of the driver install, migration, doctor, and sibling generated-artifact driver.
INCLUDE - lisa:bug-fixer - reproduce as a failing git-level test, then implement the portable registration, migration, and doctor checks via TDD.
INCLUDE - lisa:verification-specialist - independent empirical proof in a scratch clone (apply from linked worktree, remove it, merge, run doctor) and the v2 verdict.
INCLUDE - lisa:quality-specialist - review correctness, coverage, and coding-philosophy compliance of the change.
INCLUDE - lisa:learner - capture task MLD to the learnings ledger.
INCLUDE - lisa:github-agent - used as the bounded input-resolver (already ran).
INCLUDE - general-purpose - lead-session planning helpers named by the skill (plan name, base branch, completion condition); no narrower type fits those.
EXCLUDE - lisa:debug-specialist - root cause is already proven in the issue with file:line evidence; reproduction is owned by bug-fixer.
EXCLUDE - lisa:builder - this is a Fix, bug-fixer covers TDD implementation.
EXCLUDE - lisa:test-specialist - bug-fixer writes the tests; quality-specialist reviews them.
EXCLUDE - lisa:architecture-specialist - the issue prescribes the approach (follow the sibling driver's portable command).
EXCLUDE - lisa:security-specialist - no auth, secrets, or untrusted-input surface beyond a git config command string.
EXCLUDE - lisa:performance-specialist - no performance surface.
EXCLUDE - lisa:product-specialist - CLI-internal behavior; acceptance criteria already Gherkin.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the four Gherkin scenarios directly.
EXCLUDE - lisa:git-history-analyzer - Explore covers relevant history.
EXCLUDE - lisa:jira-agent / lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:*-intake, lisa:*-prd-intake - not an intake flow.
EXCLUDE - lisa:learning-judge, lisa:skill-evaluator, lisa:learnings-synthesizer, lisa:tracker-mining-specialist, lisa:pr-mining-specialist, lisa:eval-specialist - debrief/gardener roles, not implementation.
EXCLUDE - Plan - approach is prescribed; no separate design plan needed.
EXCLUDE - claude, claude-code-guide, statusline-setup, hookify:conversation-analyzer - not relevant.
EXCLUDE - code-simplifier:code-simplifier - quality-specialist covers it.

Plan name: 4640-learnings-driver-worktree-portable
Base branch: main (Target Backend Environment `Assumption: production — remote default branch main`; deploy.branches production=main; Branch Plan match).
Tool access: gh (tracker/PR) — probed OK via `gh issue view 4640`; git, bun, node local. No external systems needed.

Completion condition: in a scratch repo, register the driver via Lisa's installer from a linked worktree, `git worktree remove` it, then merge two branches that each add a learnings entry from the primary checkout — `git merge` exits 0 and the file contains BOTH entries; `lisa doctor` merge-driver check reports fail on a dangling command (naming the path and `lisa install-merge-driver`) and warn on a resolvable absolute one. Constraint: the generated-artifact driver and union merge logic are unchanged.

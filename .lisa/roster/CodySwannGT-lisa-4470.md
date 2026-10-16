# Roster Decision — CodySwannGT/lisa#4470

Flow: Implement / Fix. Plan: parity-safety-net-closed-compound-flow.

INCLUDE - Explore - mandatory read-only research of the walker, sibling copies, and git history.
INCLUDE - lisa:bug-fixer - owns reproduce-as-failing-test then the TDD fix in parity-safety-net.sh.
INCLUDE - lisa:verification-specialist - independent empirical proof: runs the issue's probe table and writes the verdict.
INCLUDE - lisa:quality-specialist - reviews the structural fix and test meaningfulness.
INCLUDE - lisa:security-specialist - the change loosens a safety guard; must confirm no destructive-command bypass is opened.
INCLUDE - lisa:learner - captures task MLD to the ledger.
INCLUDE - general-purpose - lead-side bookkeeping (branch plan, usage accounting) where no specialist fits.
EXCLUDE - lisa:test-specialist - bug-fixer writes the red tests; quality-specialist reviews them; a third test author would duplicate.
INCLUDE - lisa:debug-specialist - (updated mid-flow) the PR's "npm updater Rails runtime qualification" CI job fails deterministically with a hashed error; needs proven attribution to this change or not.
EXCLUDE - lisa:builder - Fix flow, not Build.
EXCLUDE - lisa:architecture-specialist - single-function walker fix following an existing brace_flows pattern.
EXCLUDE - lisa:product-specialist - no user-facing UI/flow; acceptance criteria are already concrete probes.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the six ACs directly; small scope.
EXCLUDE - lisa:performance-specialist - no performance surface.
EXCLUDE - coderabbit:code-reviewer - CodeRabbit reviews the PR natively in drive-pr-to-merge.
EXCLUDE - code-simplifier:code-simplifier - small diff; quality-specialist covers it.
EXCLUDE - Plan - plan is small enough to author in the lead.
EXCLUDE - claude, claude-code-guide, statusline-setup - not relevant to this task.
EXCLUDE - lisa:git-history-analyzer - Explore covers the history read for this one file.
EXCLUDE - lisa:eval-specialist, lisa:learning-judge, lisa:skill-evaluator, lisa:learnings-synthesizer, lisa:pr-mining-specialist, lisa:tracker-mining-specialist - debrief/gardener roles, not Implement.
EXCLUDE - lisa:github-agent, lisa:jira-agent, lisa:linear-agent, lisa:*-build-intake, lisa:*-prd-intake - intake/lifecycle dispatchers; this flow is already dispatched.
EXCLUDE - lisa-expo:ops-specialist - no deployed service; Lisa ships via npm release, not a runtime deploy.

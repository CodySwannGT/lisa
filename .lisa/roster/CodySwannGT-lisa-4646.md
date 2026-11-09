# Roster Decision — CodySwannGT/lisa#4646

Plan: codepipeline-delivery-proof. Work type: Implement / Fix (Bug). Runtime: Claude Code.

INCLUDE - lisa:github-agent - bounded input-resolver (read, claim reuse, bind) for a GitHub-tracked leaf.
INCLUDE - Explore - mandatory read-only research of the validator, completion reference, doctor, CDK seed and tests before implementation.
INCLUDE - lisa:bug-fixer - the item is a Bug; reproduce as failing tests then fix via TDD.
INCLUDE - lisa:verification-specialist - independent empirical verification and the v2 verdict; must not be the implementer.
INCLUDE - lisa:quality-specialist - independent review of correctness, coding philosophy and test quality.
INCLUDE - lisa:learner - capture task MLD to the learnings ledger.
INCLUDE - general-purpose - lead-session bookkeeping steps the skill assigns to it (plan name, base branch, completion condition, preflight).
EXCLUDE - claude - catch-all; the specific specialists above cover every task.
EXCLUDE - claude-code-guide - no question about Claude Code itself.
EXCLUDE - code-simplifier:code-simplifier - quality-specialist covers simplification for a change this size.
EXCLUDE - hookify:conversation-analyzer - not analyzing transcripts.
EXCLUDE - lisa:architecture-specialist - the ticket prescribes the design (new delivery mechanism in an existing validator); Explore covers file mapping.
EXCLUDE - lisa:builder - Fix flow uses bug-fixer.
EXCLUDE - lisa:confluence-prd-intake - no PRD intake.
EXCLUDE - lisa:debug-specialist - root cause is already cited in the ticket with file:line.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the small history read needed.
EXCLUDE - lisa:github-build-intake - not an intake cycle.
EXCLUDE - lisa:github-prd-intake - not PRD intake.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - invoked inside persist-learning only if a candidate arises.
EXCLUDE - lisa:learnings-synthesizer - Debrief-only.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - not PRD intake.
EXCLUDE - lisa:notion-prd-intake - not PRD intake.
EXCLUDE - lisa:performance-specialist - a single read-only AWS call per completion; no performance surface.
EXCLUDE - lisa:pr-mining-specialist - Debrief-only.
EXCLUDE - lisa:product-specialist - no user flow/UI; ticket already carries Gherkin AC.
EXCLUDE - lisa:security-specialist - read-only AWS CLI invocation with no new credentials; quality review covers argument-injection concerns.
EXCLUDE - lisa:skill-evaluator - no learning routing.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the four Gherkin scenarios directly.
EXCLUDE - lisa:test-specialist - bug-fixer writes the red tests; quality-specialist reviews them.
EXCLUDE - lisa:tracker-mining-specialist - Debrief-only.
EXCLUDE - Plan - Explore plus the prescribed approach suffice.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - no public page needed.

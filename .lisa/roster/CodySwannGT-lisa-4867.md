# Roster Decision — CodySwannGT/lisa#4867

Plan: `cull-markdown-wording-assertions` · Work type: Improve (test-suite refactor, no runtime behavior change: test-only)
Base branch: `main` (Target environment production → `deploy.branches.production=main`)

INCLUDE - Explore - mandatory read-only research: locate phrase manifest consumers, classifier, Markdown-reading tests.
INCLUDE - lisa:test-specialist - owns the classification (STRUCTURAL / MACHINE-TOKEN / WORDING) and the test culling itself.
INCLUDE - lisa:verification-specialist - independent verifier that runs the Validation Journey (reword passes, structural/token breakage fails) and writes the verdict.
INCLUDE - lisa:quality-specialist - reviews that culling did not remove structural or machine-token protection.
INCLUDE - lisa:learner - captures task MLD into the learnings ledger.
INCLUDE - general-purpose - lead-session helper steps the skill names (plan name, completion condition, access preflight) are done inline by the lead; no separate spawn needed beyond this record.
EXCLUDE - lisa:builder - no feature is being built; test-specialist owns the edit.
EXCLUDE - lisa:bug-fixer - not a bug.
EXCLUDE - lisa:architecture-specialist - no design change; classification criteria are fixed by the ticket.
EXCLUDE - lisa:debug-specialist - no defect to prove.
EXCLUDE - lisa:product-specialist - no user flow; acceptance criteria already Gherkin.
EXCLUDE - lisa:security-specialist - test-only change, no security surface.
EXCLUDE - lisa:performance-specialist - wall time is recorded by the verifier; no optimisation work.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist covers the four AC scenarios directly.
EXCLUDE - lisa:git-history-analyzer - Explore covers the #4609 history needed.
EXCLUDE - lisa:eval-specialist, lisa:learning-judge, lisa:learnings-synthesizer, lisa:skill-evaluator - factory/learning meta-flows not in scope.
EXCLUDE - lisa:pr-mining-specialist, lisa:tracker-mining-specialist - debrief-only.
EXCLUDE - lisa:github-agent, lisa:jira-agent, lisa:linear-agent - lifecycle handled by this lead; github-agent used only as the input resolver.
EXCLUDE - lisa:*-build-intake, lisa:*-prd-intake - intake flows, not implement.
EXCLUDE - Plan - planning folded into test-specialist's classification pass.
EXCLUDE - claude-code-guide, statusline-setup, web-fetch, claude - not relevant.
EXCLUDE - code-simplifier:code-simplifier, hookify:conversation-analyzer - not relevant.

Input resolver: lisa:github-agent (bound, claim reused, route implement).

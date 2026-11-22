# Roster Decision — CodySwannGT/lisa#4768

Runtime: Claude Code. This flow runs nested (spawned as a subagent of the session lead), so per
lisa-implement's nested-team rule named teammates cannot be added from here; specialist roles are
discharged by the nested lead plus bounded anonymous subagents where used.

INCLUDE - Explore - read-only search for every copy and reader of the profile names.
INCLUDE - lisa:bug-fixer - reproduce (failing tests) then fix via TDD; performed by the nested lead.
INCLUDE - lisa:test-specialist - test matrix (a)-(d) from the work item; performed by the nested lead.
INCLUDE - lisa:verification-specialist - independent CLI proof against a temp HOME (anonymous subagent).
INCLUDE - lisa:security-specialist - cross-tenant credential isolation is the defect class; reviewed inline.
INCLUDE - lisa:quality-specialist - review of the diff before PR (via lisa-git-submit-pr local review).
INCLUDE - lisa:learner - capture MLD learnings at the end.
EXCLUDE - lisa:builder - this is a Fix; bug-fixer covers it.
EXCLUDE - lisa:architecture-specialist - naming scheme decided by the owner; design recorded in the issue.
EXCLUDE - lisa:debug-specialist - root cause already proven from source.
EXCLUDE - lisa:performance-specialist - no performance surface.
EXCLUDE - lisa:product-specialist - no UI/product flow.
EXCLUDE - lisa:spec-conformance-specialist - AC conformance checked by the verification subagent.
EXCLUDE - lisa:git-history-analyzer - history already read (#3440, #3464).
EXCLUDE - lisa:eval-specialist, lisa:learning-judge, lisa:skill-evaluator, lisa:learnings-synthesizer, lisa:pr-mining-specialist, lisa:tracker-mining-specialist - debrief/learning-routing roles, not this flow.
EXCLUDE - lisa:github-agent, lisa:jira-agent, lisa:linear-agent and all lisa:*-intake agents - tracker lifecycle/intake dispatchers; this flow was invoked directly.
EXCLUDE - general-purpose, claude, Plan, code-simplifier:code-simplifier, claude-code-guide, web-fetch, statusline-setup - more specific roles above cover the work.

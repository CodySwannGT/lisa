# Roster Decision — CodySwannGT/lisa#4658

Flow: Implement / Fix. Nested: this session is a teammate of the requesting team lead. Claude teams are flat, so named teammates cannot be spawned from here; bounded work goes to anonymous subagents and the remaining lifecycle work runs in this session, per the nested-flow rule.

INCLUDE - general-purpose - bounded input-resolver (lisa-track resolve/claim/bind).
INCLUDE - Explore - read-only search across plugins/src for every human_gate / "product call" surface.
INCLUDE - lisa:verification-specialist - independent verdict on the script-level behaviour (sweep lifts invalid holds, keeps valid ones; writer refusal).
INCLUDE - lisa:quality-specialist - diff review before PR (via lisa-git-submit-pr local review).
EXCLUDE - lisa:bug-fixer - implementation runs in this session; a second implementer would collide in the same worktree.
EXCLUDE - lisa:builder - not a feature build.
EXCLUDE - lisa:test-specialist - tests are written with the implementation (TDD) and reviewed by quality-specialist.
EXCLUDE - lisa:architecture-specialist - the issue names the surfaces; no new architecture.
EXCLUDE - lisa:debug-specialist - root cause (contract wording) is stated in the issue.
EXCLUDE - lisa:security-specialist - no auth or secret surface changes.
EXCLUDE - lisa:performance-specialist - no performance surface.
EXCLUDE - lisa:product-specialist - acceptance criteria are already Gherkin on the issue.
EXCLUDE - lisa:spec-conformance-specialist - covered by verification-specialist against the issue AC.
EXCLUDE - lisa:learner - a learning is persisted through lisa-persist-learning only if a durable one emerges.
EXCLUDE - lisa:learning-judge, lisa:skill-evaluator, lisa:eval-specialist, lisa:learnings-synthesizer, lisa:pr-mining-specialist, lisa:tracker-mining-specialist, lisa:git-history-analyzer - learning/debrief pipeline agents, not part of this fix.
EXCLUDE - lisa:jira-agent, lisa:github-agent, lisa:linear-agent, lisa:*-build-intake, lisa:*-prd-intake, lisa:confluence-prd-intake, lisa:notion-prd-intake - intake/lifecycle dispatchers; the item is already claimed.
EXCLUDE - coderabbit:code-reviewer, code-simplifier:code-simplifier - CodeRabbit runs on the PR itself.
EXCLUDE - Plan, claude-code-guide, statusline-setup, casey, chief, felix, lex, mark, parker, sally, claude - unrelated to a Lisa plugin fix.

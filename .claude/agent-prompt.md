Create an agent team to understand the issue below and create a plan to fix it.

Issue: https://geminisportsanalytics.atlassian.net/browse/SE-3777

Team structure:
- Spawn all teammates in plan mode so I can review their findings before implementation
- One teammate to research the JIRA ticket and reproduce the bug
- One teammate to explore the codebase for relevant code, existing patterns, and reusable scripts
- One teammate to review from a devil's advocate perspective (anti-patterns, N+1 queries, missing edge cases)
- Synthesize teammate findings into a single plan for my review

Requirements:
- Use the JIRA/Atlassian CLI or MCP to access the ticket
- Plan and tasks must live in `<project-root>/plans/` so they are included in git
- Use existing scripts for replication and verification when possible; if none exist, create them and expose in package.json
- Reuse existing code when possible
- Read lint and format rules to understand project standards
- Include all skills, MCPs, and plugins from Claude settings needed for the plan
- Keep all documentation in sync
- Write new documentation to the appropriate location (JSDoc, `.claude/rules/PROJECT_RULES.md`, `.claude/skills/`, etc.)
- Review the plan from multiple perspectives and revise as needed
- Linting, formatting, and type-checking are handled by PostToolUse hooks and lint-staged pre-commit hooks -- do not include separate tasks for these

Bug replication:
- The bug must be empirically replicated (Playwright, browser, direct API call, etc.) -- not guessed at
- If the team cannot reproduce the bug, STOP. Update the JIRA ticket with findings and what additional information is needed, then end the session
- Do not attempt to fix a bug you cannot prove exists

Fix verification:
- The plan must specify how the fix will be empirically verified using locally available resources (Playwright, API calls, browser, etc.) -- no CI/CD
- Every fix task must include a proof command and expected output
- The fix must be confirmed working locally and/or directly deployed without CI/CD
- Include a product review task using `product-reviewer` to verify the fix works from a non-technical perspective

Anti-patterns:
- Do not assume anti-patterns are acceptable just because they exist in the codebase. Undocumented anti-patterns should be flagged, not used as reference
- Never include solutions with obvious anti-patterns (e.g., N+1 queries). If unavoidable due to API limitations, STOP and update the JIRA ticket with what is needed

JIRA updates:
- Associate the branch and PR with the JIRA ticket
- Post the approved plan as a comment on the JIRA ticket
- If blocked (cannot reproduce, unavoidable anti-pattern, missing information, etc.), update the JIRA ticket before stopping

Plan output:
- Written to `<project-root>/plans/`
- Must include instructions to spawn a second Agent Team to implement, test, verify, review, and learn from the implementation
- Recommend specialized agents: `implementer` for implementation, `tech-reviewer` for technical review, `product-reviewer` for product/UX review, `learner` for post-implementation learning, `test-coverage-agent` for tests
- Include a technical review task using `tech-reviewer` to validate correctness, security, and coding-philosophy compliance
- Include a learn phase task using `learner` to collect and process learnings from completed tasks
- All decisions must include a recommendation
- If a decision is left unresolved, use the recommended option
- The human should easily be able to approve, reject, or request modifications

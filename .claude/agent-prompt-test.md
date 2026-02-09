Create an agent team to understand the task below and create a plan to implement it.

Task: Write a bash function that prints Fibonacci numbers

Team structure:
- Spawn all teammates in plan mode so I can review their findings before implementation
- One teammate to research best practices for Fibonacci implementations in bash
- One teammate to explore the codebase for relevant code, existing patterns, and reusable scripts
- One teammate to review from a devil's advocate perspective (anti-patterns, edge cases, performance concerns)
- Synthesize teammate findings into a single plan for my review

Requirements:
- Plan and tasks must live in `<project-root>/plans/` so they are included in git
- Use existing scripts for replication and verification when possible; if none exist, create them and expose in package.json
- Reuse existing code when possible
- Read lint and format rules to understand project standards
- Include all skills, MCPs, and plugins from Claude settings needed for the plan
- Keep all documentation in sync
- Write new documentation to the appropriate location (JSDoc, `.claude/rules/PROJECT_RULES.md`, `.claude/skills/`, etc.)
- Review the plan from multiple perspectives and revise as needed
- Linting, formatting, and type-checking are handled by PostToolUse hooks and lint-staged pre-commit hooks -- do not include separate tasks for these

Verification:
- The implementation must be empirically verified by running the function and confirming correct output
- Every task must include a proof command and expected output
- The function must be confirmed working using locally available resources

Anti-patterns:
- Do not assume anti-patterns are acceptable just because they exist in the codebase. Undocumented anti-patterns should be flagged, not used as reference

Plan output:
- Written to `<project-root>/plans/`
- Must include instructions to spawn a second Agent Team to implement, test, verify, review, and learn from the implementation
- Recommend specialized agents: `implementer` for implementation, `tech-reviewer` for technical review, `product-reviewer` for product/UX review, `learner` for post-implementation learning, `test-coverage-agent` for tests
- Include a product review task using `product-reviewer` to validate the feature works from a non-technical perspective
- Include a technical review task using `tech-reviewer` to validate correctness, security, and coding-philosophy compliance
- Include a learn phase task using `learner` to collect and process learnings from completed tasks
- All decisions must include a recommendation
- If a decision is left unresolved, use the recommended option
- The human should easily be able to approve, reject, or request modifications

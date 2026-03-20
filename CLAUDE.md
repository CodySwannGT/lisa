Requirement Verification:

Never assume the person providing instructions has given you complete, correct, or technically precise requirements. Treat every request as potentially underspecified. Before starting any work:

1. Verify the request is specific enough to produce a verifiable outcome. If it is not, stop and ask for clarification.
2. Verify you can empirically prove the work is done when complete (e.g. a passing test, a working API call, observable behavior in a browser, a log entry). If you cannot define how to prove it, stop and ask for clarification.
3. If a request contradicts existing code, architecture, or conventions, do not silently comply. Raise the contradiction and confirm intent before proceeding.

DO NOT START WORK if any of the above are unclear. Asking a clarifying question is always cheaper than implementing the wrong thing.

Project Discovery:
- Determine the project's package manager before installing or running anything.
- Read the project manifest (e.g. package.json, pyproject.toml, Cargo.toml, go.mod) to understand available scripts and dependencies.
- Read the project's linting and formatting configuration to understand its standards.
- Regenerate the lockfile after adding, removing, or updating dependencies.
- Ignore build output directories (dist, build, out, target, etc) unless specified otherwise.
- Ignore configuration linter hints/warnings — only fix actual unused exports/dependencies reported as errors.

Code Quality:
- Make atomic commits with clear conventional commit messages.
- Create clear documentation preambles for new code. Update preambles when modifying existing code.
- Document the "why", not the "what". Code explains what it does; documentation explains why it exists.
- Add language specifiers to fenced code blocks in Markdown.
- Use project-relative paths rather than absolute paths in documentation and Markdown.
- Delete old code completely when replacing it. No deprecation unless specifically requested.
- Fix bugs and issues properly. Never cover them up or work around them.
- Test empirically to confirm something worked. Never assume.
- Never assume test expectations before verifying actual implementation behavior. Run tests to learn the behavior, then adjust expectations to match.
- Always provide a solution. Never dismiss something as "not related to our changes" or "not relevant to this task".

Git Discipline:
- Prefix git push with `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=5"`.
- Never commit directly to an environment branch (dev, staging, main).
- Never use --no-verify or attempt to bypass a git hook.
- Never stash changes you cannot commit. Either fix whatever is preventing the commit or fail out and let the human know why.
- Never add "BREAKING CHANGE" to a commit message unless there is actually a breaking change.
- When opening a PR, watch the PR. If any status checks fail, fix them. For all bot code reviews, if the feedback is valid, implement it and push the change to the PR. Then resolve the feedback. If the feedback is not valid, reply to the feedback explaining why it's not valid and then resolve the feedback. Do this in a loop until the PR is able to be merged and then merge it.
- When merging a PR into an environment branch (dev, staging, main), watch the resultant deploy until it fully succeeds. If it fails for any reason, fix the failure and then open a new PR with the fix.
- When referencing a PR in a response, always include the url

Testing Discipline:
- Never skip or disable any tests or quality checks.
- Never add skip directives to a test unless explicitly asked to.
- Never lower thresholds to pass a pre-push hook. Increase test coverage to make it pass.
- Never duplicate test helper functions without appropriate lint suppression when duplication is intentional for test isolation.

JIRA Discipline:
- If working on a JIRA issue, make sure the branch you're working on references and is added to the JIRA issue.
- If working on a JIRA issue, update the issue as you work through it. For example, if working on a Bug Triage, update the issue with your questions/feedback/suggestions.

Agent Behavior:
- Never handle tasks yourself when working in a team of agents. Always delegate to a specialized agent.

NEVER:
- Modify this file directly. To add a memory or learning, use the project's rules file or create a skill.
- Directly modify files inside dependency directories (e.g. node_modules, .venv, vendor, target).
- Delete anything that is not tracked in git.
- Delete anything outside of this project's directory.
- Create placeholder implementations.
- Create TODOs.
- Create versioned copies of files or functions (e.g. V2, Optimized, processNew, handleOld).
- Write migration code unless explicitly requested.
- Write functions or methods unless they are needed.
- Write unhelpful comments like "removed code" or "old implementation".
- Update CHANGELOG.

ASK FIRST:
- Before adding a lint suppression comment (e.g. eslint-disable, noqa, #[allow(...)], @SuppressWarnings). These should be a last resort.
- Before adding a type-checking suppression comment (e.g. ts-ignore, ts-expect-error, ts-nocheck, type: ignore).
- Lint suppression in test files is acceptable without asking only when comprehensive test coverage requires it (e.g. file length limits) or when intentional duplication improves test isolation. Include matching re-enable comments where applicable.

Bug Triage:

1. Verify you have all information needed to reproduce the bug (authentication requirements, environment information, etc). Do not make assumptions. If anything is missing, stop and ask before proceeding.
2. Reproduce the bug. If you cannot reproduce it, stop and report what you tried and what you observed.
3. Once reproduced, verify you are 100% positive on how to fix it. If not, determine what you need to do to be 100% positive (e.g. add logging, trace the code path, inspect state) and do that first.
4. Verify you have access to the tools, environments, and permissions needed to deploy and verify this fix (e.g. CI/CD pipelines, deployment targets, logging/monitoring systems, API access, database access). If any are missing or inaccessible, stop and raise them before starting implementation.
5. Define the tests you will write to confirm the fix and prevent a regression.
6. Define the documentation you will create or update to explain this bug so another developer understands the "how" and "what" behind it.
7. If you can verify your fix before deploying to the target environment (e.g. start the app, invoke the API, open a browser, run the process, check logs), do so before deploying.
8. Define how you will verify the fix beyond a shadow of a doubt (e.g. deploy to the target environment, invoke the API, open a browser, run the process, check logs).

Bug Implementation:

1. Use the output of Bug Triage as your guide. Do not skip triage.

Task Triage:

1. Verify you have all information needed to implement this task (acceptance criteria, design specs, environment information, dependencies, etc). Do not make assumptions. If anything is missing, stop and ask before proceeding.
2. Verify you have a clear understanding of the expected behavior or outcome when the task is complete. If not, stop and clarify before starting.
3. Identify all dependencies (other tasks, services, APIs, data) that must be in place before you can complete this task. If any are unresolved, stop and raise them before starting implementation.
4. Verify you have access to the tools, environments, and permissions needed to deploy and verify this task (e.g. CI/CD pipelines, deployment targets, logging/monitoring systems, API access, database access). If any are missing or inaccessible, stop and raise them before starting implementation.
5. Define the tests you will write to confirm the task is implemented correctly and prevent regressions.
6. Define the documentation you will create or update to explain the "how" and "what" behind this task so another developer understands it.
7. If you can verify your implementation before deploying to the target environment (e.g. start the app, invoke the API, open a browser, run the process, check logs), do so before deploying.
8. Define how you will verify the task is complete beyond a shadow of a doubt (e.g. deploy to the target environment, invoke the API, open a browser, run the process, check logs).

Task Implementation:

1. Use the output of Task Triage as your guide. Do not skip triage.

Epic Triage:

1. Verify you have all information needed to understand the full scope of this epic (goals, acceptance criteria, impacted systems, design specs, dependencies, etc). Do not make assumptions. If anything is missing, stop and ask before proceeding.
2. Verify the epic is broken down into concrete, well-scoped bugs, tasks, and/or stories that are each fully triaged. If ambiguities exist, stop and resolve them before breaking it down.
3. Identify all cross-cutting concerns (auth, performance, security, data migrations, third-party integrations) that need to be addressed across the epic.
4. Identify all dependencies between tasks within the epic, or on external epics, teams, or services. Determine the correct order of execution.
5. Verify you have access to the tools, environments, and permissions needed to deploy and verify all tasks within this epic (e.g. CI/CD pipelines, deployment targets, logging/monitoring systems, API access, database access). If any are missing or inaccessible, stop and raise them before proceeding.
6. Define the overall test strategy for the epic (unit, integration, end-to-end, load testing).
7. Define the documentation that will need to be created or updated to cover the full scope of the epic so another developer understands the architecture, design decisions, and implementation.
8. Define measurable acceptance criteria that confirm the epic is fully complete.
9. Define how you will verify the epic is fully delivered beyond a shadow of a doubt (e.g. deploy to the target environment, walk through all acceptance criteria end-to-end, confirm all child tasks/stories are closed, confirm no regressions).

Epic Implementation:

1. Use the output of Epic Triage as your guide. Do not skip triage.
2. Work through each task and/or story in the order defined during triage, respecting dependencies.
3. Apply the Bug Implementation and Task Implementation processes to each child bug or task, respectively, as you work through them.
4. Continuously update the epic and its child issues in JIRA as progress is made.
5. Do not consider the epic complete until all acceptance criteria are verified in the target environment and all child issues are resolved.

Multi-Repository Awareness:

When working in a microservices architecture, the code you need may span multiple repositories. Watch for these signals that you're missing context:

1. Import paths or package references that don't resolve in the current repository
2. API calls to internal services where you can't find the contract, schema, or handler
3. Shared libraries, SDKs, or proto/OpenAPI definitions referenced but not present
4. Environment variables or config referencing service names you don't have code for
5. Error messages or stack traces pointing to code outside the current repo
6. JIRA issues or documentation referencing components in other repositories

When you detect any of the above:
1. Do NOT guess or make assumptions about what the external code does
2. Identify which repository contains the missing code
3. Add that repository to your current session before proceeding
4. If you cannot determine which repository contains the code, ask — do not proceed without it
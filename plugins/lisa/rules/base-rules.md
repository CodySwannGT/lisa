Requirement Verification:

Never assume the person providing instructions has given you complete, correct, or technically precise requirements. Treat every request as potentially underspecified. Before starting any work:

1. Identify any ambiguities in the request that would prevent you from completing the work. If any exist, stop and ask for clarification.
2. Identify any open questions whose answers would change your approach. If any exist, stop and ask.
3. Define how you will empirically verify the work is complete — not by running tests or linters, but by using the resulting software the way a user would. If you cannot define this, stop and ask for clarification.
4. If a request contradicts existing code, architecture, or conventions, do not silently comply. Raise the contradiction and confirm intent before proceeding.

DO NOT START WORK if any of the above are unclear. Asking a clarifying question is always cheaper than implementing the wrong thing.

Do not begin a task if there are any blockers, ambiguities, access requirements, unanswered questions, or unknowns that would prevent you from completing it. Identify these before starting — not during implementation. If you cannot confirm that you have everything needed to finish the work end-to-end, stop and surface what is missing.

Project Discovery:
- Determine the project's package manager before installing or running anything.
- Read the project manifest (e.g. package.json, pyproject.toml, Cargo.toml, go.mod) to understand available scripts and dependencies.
- Before defining a verification approach, check the `scripts` section of the project manifest for existing commands to start servers, run tests, seed databases, etc. Use existing scripts rather than inventing ad-hoc commands.
- Read the project's linting and formatting configuration to understand its standards.
- Regenerate the lockfile after adding, removing, or updating dependencies.
- Ignore build output directories (dist, build, out, target, etc.) unless specified otherwise.
- Ignore configuration linter hints/warnings — only fix actual unused exports/dependencies reported as errors.

Code Quality:
- Make atomic commits with clear conventional commit messages.
- Create clear documentation preambles for new code. Update preambles when modifying existing code.
- Document the "why", not the "what". Code explains what it does; documentation explains why it exists.
- Always add new imports and their first usage in the same edit. The lint-on-edit hook runs `eslint --fix` after every Edit, which auto-removes unused imports. If you add an import in one edit and plan to use it in a second edit, the hook will strip the import before the second edit runs.
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
- When reading a JIRA issue, always read ALL comments on the ticket — not just the description. Comments contain critical context: stakeholder decisions, scope changes, blockers, triage findings from other repos, and implementation notes. Use the Atlassian MCP (preferred — handles pagination automatically) or the Jira REST comments endpoint with pagination (`GET /rest/api/3/issue/{issueIdOrKey}/comment?startAt=0&maxResults=50`, incrementing `startAt` by `maxResults` until `startAt >= total`) to fetch all comments. Note: `jira issue view <TICKET_ID> --comments 100` is a non-exhaustive CLI shortcut capped at 100 comments and should not be used when completeness is required.
- When requesting clarification on a JIRA issue, post the question as a comment using ADF (Atlassian Document Format) and @mention the Reporter so they receive a notification.
- When creating JIRA tickets, establish issue link relationships (e.g. "is blocked by", "blocks", "relates to", "is duplicated by") between tickets that have dependencies or logical connections. Do not leave related tickets unlinked.
- When checking for associated pull requests on a JIRA issue, check the **Development panel** — not just comments or description text. The Development panel shows PRs, commits, branches, and builds linked via the GitHub-Jira integration. Query it via the dev-status API:
  ```bash
  ISSUE_ID=$(curl -s -u "${JIRA_LOGIN}:${JIRA_API_TOKEN}" \
    "${JIRA_SERVER}/rest/api/2/issue/${TICKET_ID}?fields=id" | jq -r '.id')
  curl -s -u "${JIRA_LOGIN}:${JIRA_API_TOKEN}" \
    "${JIRA_SERVER}/rest/dev-status/1.0/issue/detail?issueId=${ISSUE_ID}&applicationType=GitHub&dataType=pullrequest" \
    | jq '.detail[].pullRequests[] | {title, status, url, source: .source.branch}'
  ```

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
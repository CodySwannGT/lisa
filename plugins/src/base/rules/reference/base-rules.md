How Lisa runs:

Most sessions run unattended: a session manager or scheduler dispatches a work item and nobody watches the chat. Humans act only at exterior gates — promoting drafts, approving protected deployments, and answering items marked as needing a human. Each flow's skill owns its own readiness checks and its own blocked / needs-human exit; an unattended run with missing input returns `recovery-required` instead of guessing. The three reasons a run stops for a human are in the `when-to-stop` rule. Use subagents when a task genuinely splits into independent, sizeable parts; otherwise do the work yourself.

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
- Always add new imports and their first usage in the same edit. The lint-on-edit hook verifies changed files after every Edit, so unused-import diagnostics should be fixed in the same edit that introduced them.
- Add language specifiers to fenced code blocks in Markdown.
- Use project-relative paths rather than absolute paths in documentation and Markdown.
- Delete old code completely when replacing it. No deprecation unless specifically requested.
- Fix bugs and issues properly. Never cover them up or work around them.
- When a tool or build step fails, never assume the failure is pre-existing and work around it. Investigate the root cause first — check git history, find when it broke and why — before deciding how to proceed.
- Test empirically to confirm something worked. Never assume.
- Never assume test expectations before verifying actual implementation behavior. Run tests to learn the behavior, then adjust expectations to match.
- Always provide a solution. Never dismiss something as "not related to our changes" or "not relevant to this task".

Git Discipline:
- Prefix git push with `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=5"`.
- Never commit directly to an environment branch (dev, staging, main).
- Never use --no-verify or attempt to bypass a git hook.
- When a pre-commit, pre-push, CI, or other quality gate fails, fix the root cause first: upgrade the vulnerable dependency, fix the lint/type/test failure, remove the secret, or repair the failing check. If a fix is genuinely impossible, make the risk-acceptance decision yourself, record the reasoning, and add a narrow, documented ignore for the specific failing rule or advisory. Under `humanGate.mode: "strict"`, ask the user to make that decision instead. Never use `--no-verify`, hook environment switches, blanket ignores, or threshold reductions as a substitute for fixing the gate.
- Never bypass branch protection. Never use `--admin`, `--force`, or any other flag to merge a PR that has failing CI checks. If CI fails, fix it. If you cannot fix it, escalate to the human. There are zero exceptions. "Green in CI" is the definition of done — not "green locally." A PR is not complete until CI passes on the actual PR branch.
- **Never use plain `git push --force`.** When a history rewrite is explicitly approved, use `--force-with-lease`; prefer the explicit SHA-bound form `--force-with-lease=<ref>:<sha>`, such as `git push --force-with-lease=refs/heads/<branch>:<approved-sha> origin HEAD:refs/heads/<branch>`, where `<approved-sha>` is the exact remote tip the approval covered.
- **History-rewrite approval is SHA-scoped, not durable.** Record the remote ref and exact SHA the authorization covers. If the remote ref moves or the lease rejects, the approval is void: stop and obtain fresh confirmation for the new remote state. Never re-derive consent from the earlier approval or treat a fresh fetch as renewing authorization for a different SHA; do not retry with an updated implicit lease or plain `--force`.
- Never stash changes you cannot commit. Either fix whatever is preventing the commit or fail out and let the human know why.
- Never add "BREAKING CHANGE" to a commit message unless there is actually a breaking change.
- When opening a PR, watch the PR. If any status checks fail, fix them. For all bot code reviews, if the feedback is valid, implement it and push the change to the PR. Then resolve the feedback. If the feedback is not valid, reply to the feedback explaining why it's not valid and then resolve the feedback. Do this in a loop until the PR is able to be merged and then merge it.
- When merging a PR into an environment branch (dev, staging, main), watch the resultant deploy until it fully succeeds. If it fails for any reason, fix the failure and then open a new PR with the fix.
- When referencing a PR in a response, always include the url
- **Promotion PRs (environment branch → environment branch — e.g., `dev` → `staging`, `staging` → `main`) MUST be merged with a regular merge commit (`gh pr merge --merge`), NEVER squash-merged.** Squashing flattens the constituent `chore(release): X.Y.Z [skip ci]` commits into a single commit titled with the PR title, which (a) strips the `[skip ci]` markers so the release workflow re-runs and double-bumps the version on the destination branch, and (b) breaks the release workflow's promotion-detection regex (which inspects the merge-commit subject for `Merge branch 'X' into Y` or `Merge pull request #N from .../<env-branch>`). The merge commit produced by `--merge` keeps the subject clean and the per-commit `[skip ci]` markers attached where they belong. Feature PRs (anything → `dev`) use a regular merge commit (`gh pr merge --merge`) as well.

Testing Discipline:
- Never skip or disable any tests or quality checks.
- Never add skip directives to a test unless explicitly asked to.
- Never lower thresholds to pass a pre-push hook. Increase test coverage to make it pass.
- Never duplicate test helper functions without appropriate lint suppression when duplication is intentional for test isolation.

JIRA Discipline:
- If working on a JIRA issue, make sure the branch you're working on references and is added to the JIRA issue.
- If working on a JIRA issue, update the issue as you work through it. For example, if working on a Bug Triage, update the issue with your questions/feedback/suggestions.
- When reading a JIRA issue, always read ALL comments on the ticket — not just the description. Comments contain critical context: stakeholder decisions, scope changes, blockers, triage findings from other repos, and implementation notes. Use the Atlassian MCP or first resolve the project root from `$CLAUDE_PROJECT_DIR` or `git rev-parse --show-toplevel`. When `$PROJECT_ROOT/.lisa/jira-cli/.config.yml` exists, run both `jira --config "$PROJECT_ROOT/.lisa/jira-cli/.config.yml" issue view <TICKET_ID>` and `jira --config "$PROJECT_ROOT/.lisa/jira-cli/.config.yml" issue comment list <TICKET_ID>`; the dedicated comment-list command returns the complete comment collection instead of a fixed recent-comment window. If that project config is absent, omit `--config` from both commands to use the machine's own `~/.config/.jira/.config.yml`.
- When requesting clarification on a JIRA issue, post the question as a comment using ADF (Atlassian Document Format) and @mention the Reporter so they receive a notification.
- When creating JIRA tickets, establish issue link relationships (e.g. "is blocked by", "blocks", "relates to", "is duplicated by") between tickets that have dependencies or logical connections. Do not leave related tickets unlinked. Relationship discovery is mandatory on every create and update — search BOTH the local git history (`git log --all --grep=<keyword>`, `git log -- <path>`) AND Jira (JQL by component, keyword, label, epic siblings) before declaring "no related work." Record the searches you ran and their outcomes in the description (or a comment) so a reviewer can see the search was real.
- Ticket scope by type: Bug, Task, and Sub-task tickets MUST be single-repo (one work unit, one repo). Epic, Spike, and Story tickets MAY span multiple repos. If a Bug/Task/Sub-task crosses repos, split it per the `repo-scope-split` rule — at PRD-decomposition time via `task-decomposition` step 1.5 (parent Story + per-repo children); at work-time (an existing ticket an agent is about to implement) via the work-time split procedure (narrow the original to one repo, spin off a sibling per additional repo cloning its metadata, link the producer→consumer dependency, then proceed). A cross-repo work unit is a decomposition error the agent fixes by splitting, not a reason to bounce the ticket to the reporter.
- Ticket descriptions MUST contain everything an implementer needs to start work without asking the reporter. In particular:
  - **Target backend environment** (`dev` / `staging` / `prod`) when the ticket has runtime behavior. QA/product report against a deployed env; the implementer verifies locally first against that backend before CI/CD. Skip only for doc-only, config-only, type-only, test-only, or Epic tickets (the closed no-runtime reason set shared with `NO_RUNTIME_REASONS` in `scripts/lib/completion-proof-shape.mjs`).
  - **Sign-in account / credentials** when the work requires being signed in. Name the account (or the source — 1Password item, env var, seeded fixture) and the role. Omit entirely when sign-in is not required.
  - **Gherkin acceptance criteria** (Given/When/Then) so the implementer can verify behavior without guessing.
  - **Relationship discovery evidence** — either an issue link to a related ticket, or a documented search showing none was found (see Relationship Discovery in jira-verify).
- Ticket metadata MUST include an **epic parent** for non-bug, non-epic tickets so every Story/Task/Sub-task is traceable to a strategic goal.
- Pre-flight gate before starting work on any ticket: if the description is missing target backend environment (when applicable), sign-in credentials (when applicable), Gherkin acceptance criteria, epic parent (non-bug/non-epic), or relationship discovery evidence, first **draft** the authorable missing sections into the ticket as clearly-labeled assumptions (the `pre-flight-autofill` draft-then-block procedure — the agent writes spec, never code, here), then transition the ticket to Blocked, reassign to the **Reporter**, and post a **confirmation** comment asking them to confirm the drafted assumptions (not a bare "go write all this" checklist). Do not start work. This is the one place where auto-transitioning status is allowed.
- When checking for associated pull requests on a JIRA issue, check the **Development panel** — not just comments or description text. The Development panel shows PRs, commits, branches, and builds linked via the GitHub-Jira integration. Query it via the dev-status API:
  ```bash
  ISSUE_ID=$(curl -s -u "${JIRA_LOGIN}:${JIRA_API_TOKEN}" \
    "${JIRA_SERVER}/rest/api/2/issue/${TICKET_ID}?fields=id" | jq -r '.id')
  curl -s -u "${JIRA_LOGIN}:${JIRA_API_TOKEN}" \
    "${JIRA_SERVER}/rest/dev-status/1.0/issue/detail?issueId=${ISSUE_ID}&applicationType=GitHub&dataType=pullrequest" \
    | jq '.detail[].pullRequests[] | {title, status, url, source: .source.branch}'
  ```

Pace:
- Never rush. There is no pressure to finish quickly. Speed is not a measure of quality, and a fast wrong answer is worse than a slow correct one.
- Take the time to read the relevant code in full and verify assumptions empirically.
- Do not skip steps to save time — quality gates, verification, reading existing code — these exist because shortcuts cost more than they save.
- If a task feels like it's taking "too long," that is almost always a sign that the task is harder than it first appeared, not a sign that you should cut corners. Report the difficulty instead of compressing the work.
- Optimize for being correct, thorough, and reversible. Time spent doing the work right is never wasted; time spent recovering from a rushed answer often is.

NEVER:
- Modify this file directly. To add a memory or learning, use the project's rules file or create a skill.
- Directly modify files inside dependency directories (e.g. node_modules, .venv, vendor, target).
- Delete anything that is not tracked in git.
- Delete anything outside of this project's directory.
- Create placeholder implementations.
- Create TODOs.
- Create versioned copies of files or functions (e.g. V2, Optimized, processNew, handleOld).
- Write backwards-compatibility shims for code you are replacing. (Schema and data migrations a framework requires, such as Rails migrations, are ordinary code, not shims.)
- Write functions or methods unless they are needed.
- Write unhelpful comments like "removed code" or "old implementation".
- Update CHANGELOG.

Suppressions:
- A lint, formatter, or type-check suppression (e.g. eslint-disable, biome-ignore, noqa, ts-expect-error, type: ignore) is a last resort. Use one only when the code is correct and the tool is wrong, scope it to the narrowest line or rule, and write the reason on the same line. Include matching re-enable comments where applicable.

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
4. Check the wiki's pointers to related repositories. If you still cannot determine which repository contains the code, that is missing access: stop through the flow's needs-human exit (`when-to-stop`).

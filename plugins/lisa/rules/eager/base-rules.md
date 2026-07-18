# Base Rules (load-bearing)

These are mandatory disciplines that apply to every session. Full prose, JIRA dev-status query, ADF templates, etc. live in [reference/base-rules.md](../reference/base-rules.md).

## Requirement Verification

Treat every request as potentially underspecified. Before starting any work:

1. Identify ambiguities that would prevent completion. If any exist, stop and ask.
2. Identify open questions whose answers would change your approach. If any exist, stop and ask.
3. Define how you will empirically verify the work is complete by USING the resulting software, not just running tests. If you cannot define this, stop and ask.
4. If a request contradicts existing code/architecture/conventions, raise the contradiction and confirm intent before proceeding.

Do not begin work if there are blockers, ambiguities, access requirements, or unanswered questions. Identify these before starting, not during implementation.

## Code Quality

- Atomic commits with conventional commit messages.
- Document the **why**, not the what.
- Add new imports and their first usage in the same edit so lint-on-edit verification stays green.
- Delete old code completely when replacing it. No deprecation comments unless asked.
- Fix bugs at root cause. Never work around them or assume a failure is "pre-existing."
- Test empirically. Never assume test expectations before observing actual behavior.

## Git Discipline

- **Never use `--no-verify`** or bypass any git hook.
- When a hook or quality gate fails, fix the root cause first. If no fix is genuinely possible, ask the user to make the risk-acceptance decision and add a specific documented ignore; never use a blanket bypass.
- **Never bypass branch protection** — no `--admin`, `--force`, no merging a PR with failing CI. "Green in CI" is the definition of done.
- Never commit directly to environment branches (`dev`, `staging`, `main`).
- **Never use plain `git push --force`.** When a history rewrite is explicitly approved, use `--force-with-lease`; prefer the SHA-bound form `--force-with-lease=<ref>:<sha>`, where `<sha>` is the exact remote tip the approval covered.
- **History-rewrite approval is SHA-scoped, not durable.** If the remote ref moves or the lease rejects, the approval is void. Stop and obtain fresh confirmation for the new remote state; never re-derive consent from the earlier approval. Fetching again does not renew consent.
- Prefix `git push` with `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=5"`.
- When opening a PR, watch it. Fix every failing check and every valid bot review comment. Resolve threads. Loop until merged.
- After merging into an environment branch, watch the deploy. If it fails, fix it and open a new PR.
- **Promotion PRs** (env→env) MUST use `gh pr merge --merge` (regular merge commit), NEVER squash. Squashing strips `[skip ci]` markers and breaks promotion detection. Feature PRs also use `--merge`.
- Always include the PR URL when referencing a PR.

## Testing Discipline

- Never skip or disable tests. Never add skip directives without explicit instruction.
- Never lower coverage thresholds to pass a hook — raise coverage instead.

## JIRA Discipline

- Read **all** comments on a ticket, not just the description.
- When clarifying, comment via ADF and @mention the Reporter.
- Establish issue link relationships (`blocks`, `is blocked by`, `relates to`) — search git history AND Jira before declaring "no related work."
- Single-repo invariant: Bug/Task/Sub-task/Improvement (and any childless Story/Spike — a leaf per `leaf-only-lifecycle`) MUST be single-repo. An Epic, or any Story/Spike that still holds child work, MAY span repos. Cross-repo leaves are split per the `repo-scope-split` rule.
- Pre-flight gate: BLOCK + reassign-to-Reporter if a ticket is missing target backend env, sign-in credentials, Gherkin acceptance criteria, epic parent (non-bug/non-epic), or relationship discovery evidence.

## Pace

Never rush. A fast wrong answer is worse than a slow correct one. Surface difficulty to the user instead of compressing the work.

## NEVER

- Modify this file directly.
- Touch files inside `node_modules`, `.venv`, `vendor`, `target`.
- Delete anything untracked, or anything outside this project.
- Create placeholders, TODOs, versioned copies (`V2`, `processNew`, `handleOld`).
- Write migration code unless explicitly requested.
- Update CHANGELOG yourself.

## ASK FIRST

- Before adding a lint/formatter suppression (`eslint-disable`, `biome-ignore`, `noqa`, etc.).
- Before adding a type-check suppression (`ts-ignore`, `ts-expect-error`, `# type: ignore`).
- Lint suppression in test files is OK without asking only when comprehensive coverage genuinely requires it.

## Multi-Repository Awareness

If you see imports that don't resolve, API calls without a contract, shared libs not present, env vars naming foreign services, stack traces pointing out-of-repo, or ticket references to other components — stop guessing. Identify the repo, add it to the session, or ask.

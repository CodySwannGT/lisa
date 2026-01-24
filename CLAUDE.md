Always figure out the Package manager the project uses: !`ls package-lock.json yarn.lock pnpm-lock.yaml bun.lockb 2>/dev/null | head -1`
Always invoke /prompt-complexity-scorer skill first on each user request to evaluate complexity (1-10 scale). For scores 5+, suggest writing to specs/<spec-name>.md before proceeding.
Always invoke /coding-philosophy skill to enforce immutable coding principles, function structure ordering, and YAGNI+SOLID+DRY+KISS patterns
Always invoke /jsdoc-best-practices skill when writing or reviewing JSDoc documentation to ensure "why" over "what" and proper tag usage
Always read @README.md
Always read @package.json without limit or offset to understand what third party packages are used
Always read @package.json without limit or offset to understand what scripts are used
Always read @eslint.config.mjs without limit or offset to understand this project's linting standards
Always read @.prettierrc.json without limit or offset to understand this project's formatting standards
Always make atomic commits with clear conventional messages
Always create clear documentation preambles with JSDoc for new code
Always update preambles when updating or modifying code
Always add language specifiers to fenced code blocks in Markdown.
Always use project-relative paths rather than absolute paths in documentation and Markdown.
Always ignore build folders (dist, build, etc) unless specified otherwise
Always delete and remove old code completely - no deprecation needed
Always read @PROJECT_RULES.md without limit or offset to understand additional rules for this project
Always add `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=5" ` when running `git push`


Never commit changes to an environment branch (dev, staging, main) directly. This is enforced by the pre-commit hook.
Never skip or disable any tests or quality checks.
Never add .skip to a test unless explicitly asked to
Never directly modify a file in node_modules/
Never use --no-verify with git commands.
Never make assumptions about whether something worked. Test it empirically to confirm.
Never cover up bugs or issues. Always fix them properly.
Never write functions or methods unless they are needed.
Never say "not related to our changes" or "not relevant to this task". Always provide a solution.
Never create functions or variables with versioned names (processV2, handleNew, ClientOld)
Never write migration code unless explicitly requested
Never write unhelpful comments like "removed code"
Never commit changes to an environment branch (dev, staging, main) directly. This is enforced by the pre-commit hook.
Never skip or disable any tests or quality checks.
Never use --no-verify or attempt to bypass a git hook
Never create placeholders
Never create TODOs
Never create versions of files (i.e. V2 or Optimized)
Never assume test expectations before verifying actual implementation behavior (run tests to learn the behavior, then adjust expectations to match)
Never duplicate test helper functions without using eslint-disable comments for sonarjs/no-identical-functions when duplication is intentional for test isolation (exception to the general eslint-disable rule below)
Never add eslint-disable for lint warnings (except sonarjs/no-identical-functions in tests as noted above)
Never delete anything that isn't tracked in git
Never delete anything outside of this project's directory
Never add "BREAKING CHANGE" to a commit message unless there is actually a breaking change
Never stash changes you can't commit. Either fix whatever is prevening the commit or fail out and let the human know why.

ONLY use eslint-disable as a last resort and confirm with human before doing so
ONLY use eslint-disable for test file max-lines when comprehensive test coverage requires extensive test cases (must include matching eslint-enable)
ONLY use eslint-disable functional/no-loop-statements in tests when using loops for test consolidation improves readability over dozens of individual tests
ONLY use ts-ignore as a last resort and confirm with human before doing so
ONLY use ts-expect-error as a last resort and confirm with human before doing so
ONLY use ts-nocheck as a last resort and confirm with human before doing so
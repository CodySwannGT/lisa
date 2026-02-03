You take orders from dumb humans who don't know anything about software development. Never assume they know what they're talking about and understand that any action you take for them, you have to be able to prove empirically that you did what they asked. So if the request is not clear enough or you don't know how to empirically prove that you did it, get clarification before starting.

CRITICAL RULES:

Always output "I'm tired boss" before starting any task, request or anything else.
Always figure out the Package manager the project uses: !`ls package-lock.json yarn.lock pnpm-lock.yaml bun.lockb 2>/dev/null | head -1`
Always invoke /jsdoc-best-practices skill when writing or reviewing JSDoc documentation to ensure "why" over "what" and proper tag usage
Always read @package.json without limit or offset to understand what scripts and third party packages are used
Always read @eslint.config.ts without limit or offset to understand this project's linting standards
Always read @.prettierrc.json without limit or offset to understand this project's formatting standards
Always make atomic commits with clear conventional messages
Always create clear documentation preambles with JSDoc for new code
Always update preambles when updating or modifying code
Always add language specifiers to fenced code blocks in Markdown.
Always use project-relative paths rather than absolute paths in documentation and Markdown.
Always ignore build folders (dist, build, etc) unless specified otherwise
Always delete and remove old code completely - no deprecation needed
Always add `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=5" ` when running `git push`
Always err on the side of creating a plan before directly executing a coding task 

Never modify this file (CLAUDE.md) directly. To add a memory or learning, add it to .claude/rules/PROJECT_RULES.md or create a skill with /skill-creator.
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

Never update CHANGELOG

LISA-MANAGED FILES:

The following files are managed by Lisa and will be overwritten on every `lisa` run. Never edit them directly. Where a local override exists, edit that instead.

Files with local overrides (edit the override, not the managed file):

| Managed File (do not edit) | Local Override (edit this instead) |
|---|---|
| `eslint.config.ts` | `eslint.config.local.ts` |
| `jest.config.ts` | `jest.config.local.ts` |
| `tsconfig.json` | `tsconfig.local.json` |
| `eslint.ignore.config.json` | `eslint.config.local.ts` |
| `eslint.thresholds.json` | Edit directly (create-only, Lisa won't overwrite) |
| `jest.thresholds.json` | Edit directly (create-only, Lisa won't overwrite) |
| `.claude/rules/coding-philosophy.md` | `.claude/rules/PROJECT_RULES.md` |
| `.claude/rules/plan.md` | `.claude/rules/PROJECT_RULES.md` |
| `.claude/rules/verfication.md` | `.claude/rules/PROJECT_RULES.md` |

Files and directories with NO local override (do not edit at all):

- `CLAUDE.md`, `HUMAN.md`, `.safety-net.json`
- `.prettierrc.json`, `.prettierignore`, `.lintstagedrc.json`, `.versionrc`, `.nvmrc`
- `.yamllint`, `.gitleaksignore`, `commitlint.config.cjs`, `sgconfig.yml`, `knip.json`
- `eslint.base.ts`, `eslint.typescript.ts`, `eslint.expo.ts`, `eslint.nestjs.ts`, `eslint.cdk.ts`, `eslint.slow.config.ts`
- `jest.base.ts`, `jest.typescript.ts`, `jest.expo.ts`, `jest.nestjs.ts`, `jest.cdk.ts`
- `tsconfig.base.json`, `tsconfig.typescript.json`, `tsconfig.expo.json`, `tsconfig.nestjs.json`, `tsconfig.cdk.json`
- `tsconfig.eslint.json`, `tsconfig.build.json`, `tsconfig.spec.json`
- `eslint-plugin-code-organization/*`, `eslint-plugin-component-structure/*`, `eslint-plugin-ui-standards/*`
- `.claude/settings.json`, `.claude/hooks/*`, `.claude/skills/*`, `.claude/commands/*`, `.claude/agents/*`
- `.claude/README.md`, `.claude/REFERENCE.md`
- `.github/workflows/quality.yml`, `.github/workflows/release.yml`, `.github/workflows/claude.yml`
- `.github/workflows/build.yml`, `.github/workflows/lighthouse.yml` (Expo)
- `.github/workflows/load-test.yml`, `.github/workflows/zap-baseline.yml` (NestJS)
- `.github/dependabot.yml`, `.github/GITHUB_ACTIONS.md`, `.github/k6/*`
- `lighthouserc.js`, `.mcp.json`, `.easignore.extra` (Expo)
- `scripts/zap-baseline.sh`, `.zap/*`
- `ast-grep/*`


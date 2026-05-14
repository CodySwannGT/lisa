# Lisa Monorepo Baseline Source

- Ingested: 2026-05-14T10:56:25.611996+00:00
- Scope: Lisa monorepo working tree, excluding dependency directories, build output, coverage output, and local git internals.
- Current branch: `fix/audit-exclusions-load-set-e`
- HEAD: `610f410cb4955734365acdcd1c94e5a74edcbfc0`
- Remote: `git@github.com:CodySwannGT/lisa.git`

## Git State At Ingestion

```text
## fix/audit-exclusions-load-set-e...origin/fix/audit-exclusions-load-set-e
?? .lisa.workspaces.json
```

## Package Metadata

```json
{
  "name": "@codyswann/lisa",
  "version": "2.16.3",
  "description": "Claude Code governance framework that applies guardrails, guidance, and automated enforcement to projects",
  "type": "module",
  "bin": {
    "lisa": "dist/index.js",
    "setup-deploy-key": "scripts/setup-deploy-key.sh"
  },
  "workspaces": [
    "eslint-plugin-code-organization",
    "eslint-plugin-component-structure",
    "eslint-plugin-ui-standards"
  ],
  "exports": [
    ".",
    "./eslint",
    "./eslint/base",
    "./eslint/typescript",
    "./eslint/nestjs",
    "./eslint/expo",
    "./eslint/cdk",
    "./eslint/slow",
    "./jest",
    "./jest/base",
    "./jest/typescript",
    "./jest/nestjs",
    "./jest/expo",
    "./jest/cdk",
    "./vitest",
    "./vitest/base",
    "./vitest/typescript",
    "./vitest/nestjs",
    "./vitest/cdk",
    "./tsconfig/base",
    "./tsconfig/typescript",
    "./tsconfig/nestjs",
    "./tsconfig/expo",
    "./tsconfig/cdk",
    "./tsconfig/eslint",
    "./tsconfig/build",
    "./tsconfig/spec",
    "./oxlint/base",
    "./oxlint/typescript",
    "./oxlint/nestjs",
    "./oxlint/expo",
    "./oxlint/cdk"
  ],
  "files": [
    "dist",
    "all",
    "typescript",
    "expo",
    "nestjs",
    "cdk",
    "rails",
    "tsconfig",
    "oxlint",
    "scripts",
    "plugins",
    ".claude-plugin",
    "eslint-plugin-code-organization",
    "eslint-plugin-component-structure",
    "eslint-plugin-ui-standards"
  ],
  "scriptNames": [
    "build",
    "build:plugins",
    "cleanup:amplify-branches",
    "cleanup:github-branches",
    "dev",
    "format",
    "format:check",
    "github:status",
    "knip",
    "knip:fix",
    "lint",
    "lint:fix",
    "lint:slow",
    "lisa:commit-and-pr:local",
    "lisa:update:local",
    "postinstall",
    "prepare",
    "prepublishOnly",
    "pretest",
    "setup:deploy-key",
    "sg:scan",
    "start",
    "test",
    "test:cov",
    "test:integration",
    "test:unit",
    "test:watch",
    "typecheck",
    "update-node-version"
  ],
  "engines": {
    "npm": "please-use-bun",
    "yarn": "please-use-bun",
    "pnpm": "please-use-bun",
    "bun": "1.3.8",
    "node": "22.21.1"
  }
}
```

## Workspace Packages

| Path | Name | Version | Description |
| --- | --- | --- | --- |
| eslint-plugin-code-organization | @codyswann/eslint-plugin-code-organization | 1.0.0 | ESLint plugin to enforce code organization standards |
| eslint-plugin-component-structure | @codyswann/eslint-plugin-component-structure | 1.0.0 | ESLint plugin for component structure standards |
| eslint-plugin-ui-standards | @codyswann/eslint-plugin-ui-standards | 1.0.0 | ESLint plugin for UI component standards |

## Top-Level Directories

- `.agents/`
- `.claude/`
- `.claude-plugin/`
- `.entire/`
- `.github/`
- `.husky/`
- `.lisabak/`
- `all/`
- `ast-grep/`
- `cdk/`
- `docs/`
- `eslint-plugin-code-organization/`
- `eslint-plugin-component-structure/`
- `eslint-plugin-ui-standards/`
- `expo/`
- `nestjs/`
- `npm-package/`
- `oxlint/`
- `plans/`
- `plugins/`
- `projects/`
- `rails/`
- `scripts/`
- `specs/`
- `src/`
- `tests/`
- `transcripts/`
- `tsconfig/`
- `typescript/`
- `wiki/`

## Documentation, Specs, And Plans Observed

- `README.md`
- `OVERVIEW.md`
- `CONTRIBUTING.md`
- `docs/lisa-architecture.svg`
- `docs/task-management-system.md`
- `docs/wiki-inbox/.gitkeep`
- `docs/workflows/claude-code-web-notifications.md`
- `docs/workflows/prd-to-ticket-intake.md`
- `specs/.keep`
- `specs/package-lisa-json.md`
- `specs/tagged-merge.md`
- `plans/abstract-conjuring-map.md`
- `plans/breezy-dancing-pancake.md`
- `plans/compiled-riding-whisper.md`
- `plans/completed/add-managed-files-list-to-claude-md/add-managed-files-list-to-claude-md.md`
- `plans/completed/add-managed-files-list-to-claude-md/jaunty-tumbling-hellman.md`
- `plans/completed/add-managed-files-list-to-claude-md/tasks/ab0980c7-8c62-4624-9f5a-9503534e03be/.lock`
- `plans/completed/add-managed-files-list-to-claude-md/tasks/ab0980c7-8c62-4624-9f5a-9503534e03be/1.json`
- `plans/completed/add-managed-files-list-to-claude-md/tasks/ab0980c7-8c62-4624-9f5a-9503534e03be/2.json`
- `plans/completed/add-managed-files-list-to-claude-md/tasks/ab0980c7-8c62-4624-9f5a-9503534e03be/3.json`
- `plans/completed/add-managed-files-list-to-claude-md/tasks/ab0980c7-8c62-4624-9f5a-9503534e03be/4.json`
- `plans/completed/add-task-spec-to-plan-rules/add-task-spec-to-plan-rules.md`
- `plans/completed/agile-hopping-raccoon.md`
- `plans/completed/ai-coding-harness-paper/ai-coding-harness-paper.md`
- `plans/completed/ai-coding-harness-paper/tasks/.lock`
- `plans/completed/ai-coding-harness-paper/tasks/1.json`
- `plans/completed/ai-coding-harness-paper/tasks/2.json`
- `plans/completed/ai-coding-harness-paper/tasks/3.json`
- `plans/completed/ai-coding-harness-paper/tasks/4.json`
- `plans/completed/ai-coding-harness-paper/tasks/5.json`
- `plans/completed/ai-coding-harness-paper/tasks/6.json`
- `plans/completed/ai-coding-harness-paper/tasks/7.json`
- `plans/completed/ai-coding-harness-paper/tasks/8.json`
- `plans/completed/apply-tsconfig-fix-ask-gemini/apply-tsconfig-fix-ask-gemini.md`
- `plans/completed/apply-tsconfig-fix-ask-gemini/tasks/2de6519d-e459-4fcf-9823-072de5b021ca/.highwatermark`
- `plans/completed/apply-tsconfig-fix-ask-gemini/tasks/2de6519d-e459-4fcf-9823-072de5b021ca/.lock`
- `plans/completed/apply-tsconfig-fix-ask-gemini/tasks/2de6519d-e459-4fcf-9823-072de5b021ca/22.json`
- `plans/completed/apply-tsconfig-fix-ask-gemini/tasks/2de6519d-e459-4fcf-9823-072de5b021ca/23.json`
- `plans/completed/apply-tsconfig-fix-ask-gemini/tasks/2de6519d-e459-4fcf-9823-072de5b021ca/24.json`
- `plans/completed/apply-tsconfig-fix-ask-gemini/tasks/2de6519d-e459-4fcf-9823-072de5b021ca/25.json`
- `plans/completed/apply-tsconfig-fix-ask-gemini/tasks/2de6519d-e459-4fcf-9823-072de5b021ca/26.json`
- `plans/completed/binary-riding-parasol.md`
- `plans/completed/calm-squishing-toucan/fix-plan-skill-e2e-bugs.md`
- `plans/completed/claude-driven-readme/claude-driven-readme.md`
- `plans/completed/claude-driven-readme/tasks/cf8d8d28-17b1-41ff-bf90-8af5c1a81d8a/.lock`
- `plans/completed/claude-driven-readme/tasks/cf8d8d28-17b1-41ff-bf90-8af5c1a81d8a/1.json`
- `plans/completed/claude-driven-readme/tasks/cf8d8d28-17b1-41ff-bf90-8af5c1a81d8a/10.json`
- `plans/completed/claude-driven-readme/tasks/cf8d8d28-17b1-41ff-bf90-8af5c1a81d8a/11.json`
- `plans/completed/claude-driven-readme/tasks/cf8d8d28-17b1-41ff-bf90-8af5c1a81d8a/12.json`
- `plans/completed/claude-driven-readme/tasks/cf8d8d28-17b1-41ff-bf90-8af5c1a81d8a/13.json`
- `plans/completed/claude-driven-readme/tasks/cf8d8d28-17b1-41ff-bf90-8af5c1a81d8a/14.json`
- `plans/completed/claude-driven-readme/tasks/cf8d8d28-17b1-41ff-bf90-8af5c1a81d8a/15.json`
- `plans/completed/claude-driven-readme/tasks/cf8d8d28-17b1-41ff-bf90-8af5c1a81d8a/16.json`
- `plans/completed/claude-driven-readme/tasks/cf8d8d28-17b1-41ff-bf90-8af5c1a81d8a/2.json`
- `plans/completed/claude-driven-readme/tasks/cf8d8d28-17b1-41ff-bf90-8af5c1a81d8a/3.json`
- `plans/completed/claude-driven-readme/tasks/cf8d8d28-17b1-41ff-bf90-8af5c1a81d8a/4.json`
- `plans/completed/claude-driven-readme/tasks/cf8d8d28-17b1-41ff-bf90-8af5c1a81d8a/5.json`
- `plans/completed/claude-driven-readme/tasks/cf8d8d28-17b1-41ff-bf90-8af5c1a81d8a/6.json`
- `plans/completed/claude-driven-readme/tasks/cf8d8d28-17b1-41ff-bf90-8af5c1a81d8a/7.json`
- `plans/completed/claude-driven-readme/tasks/cf8d8d28-17b1-41ff-bf90-8af5c1a81d8a/8.json`
- `plans/completed/claude-driven-readme/tasks/cf8d8d28-17b1-41ff-bf90-8af5c1a81d8a/9.json`
- `plans/completed/concurrent-brewing-avalanche.md`
- `plans/completed/consolidate-skills-and-commands/consolidate-skills-and-commands.md`
- `plans/completed/curious-dazzling-cosmos.md`
- `plans/completed/delightful-napping-lemon/rails-stack.md`
- `plans/completed/delightful-napping-lemon/tasks/1.json`
- `plans/completed/delightful-napping-lemon/tasks/10.json`
- `plans/completed/delightful-napping-lemon/tasks/11.json`
- `plans/completed/delightful-napping-lemon/tasks/12.json`
- `plans/completed/delightful-napping-lemon/tasks/13.json`
- `plans/completed/delightful-napping-lemon/tasks/14.json`
- `plans/completed/delightful-napping-lemon/tasks/15.json`
- `plans/completed/delightful-napping-lemon/tasks/16.json`
- `plans/completed/delightful-napping-lemon/tasks/17.json`
- `plans/completed/delightful-napping-lemon/tasks/18.json`
- `plans/completed/delightful-napping-lemon/tasks/19.json`
- `plans/completed/delightful-napping-lemon/tasks/2.json`
- `plans/completed/delightful-napping-lemon/tasks/20.json`
- `plans/completed/delightful-napping-lemon/tasks/21.json`
- `plans/completed/delightful-napping-lemon/tasks/22.json`
- `plans/completed/delightful-napping-lemon/tasks/23.json`
- `plans/completed/delightful-napping-lemon/tasks/3.json`
- `plans/completed/delightful-napping-lemon/tasks/4.json`
- `plans/completed/delightful-napping-lemon/tasks/5.json`
- `plans/completed/delightful-napping-lemon/tasks/6.json`
- `plans/completed/delightful-napping-lemon/tasks/7.json`
- `plans/completed/delightful-napping-lemon/tasks/8.json`
- `plans/completed/delightful-napping-lemon/tasks/9.json`
- `plans/completed/deprecate-project-workflow/deprecate-project-workflow.md`
- `plans/completed/deprecate-project-workflow/tasks/1.json`
- `plans/completed/deprecate-project-workflow/tasks/10.json`
- `plans/completed/deprecate-project-workflow/tasks/11.json`
- `plans/completed/deprecate-project-workflow/tasks/12.json`
- `plans/completed/deprecate-project-workflow/tasks/13.json`
- `plans/completed/deprecate-project-workflow/tasks/14.json`
- `plans/completed/deprecate-project-workflow/tasks/15.json`
- `plans/completed/deprecate-project-workflow/tasks/16.json`
- `plans/completed/deprecate-project-workflow/tasks/17.json`
- `plans/completed/deprecate-project-workflow/tasks/18.json`
- `plans/completed/deprecate-project-workflow/tasks/19.json`
- `plans/completed/deprecate-project-workflow/tasks/2.json`
- `plans/completed/deprecate-project-workflow/tasks/20.json`
- `plans/completed/deprecate-project-workflow/tasks/21.json`
- `plans/completed/deprecate-project-workflow/tasks/3.json`
- `plans/completed/deprecate-project-workflow/tasks/4.json`
- `plans/completed/deprecate-project-workflow/tasks/5.json`
- `plans/completed/deprecate-project-workflow/tasks/6.json`
- `plans/completed/deprecate-project-workflow/tasks/7.json`
- `plans/completed/deprecate-project-workflow/tasks/8.json`
- `plans/completed/deprecate-project-workflow/tasks/9.json`
- `plans/completed/dynamic-knitting-bird.md`
- `plans/completed/enchanted-puzzling-thompson.md`
- `plans/completed/eslint-default-ignores/eslint-default-ignores.md`
- `plans/completed/eslint-default-ignores/tasks/13ef5c1c-a441-4c1e-9a00-3862d4e95bd2/.lock`
- `plans/completed/eslint-default-ignores/tasks/13ef5c1c-a441-4c1e-9a00-3862d4e95bd2/1.json`
- `plans/completed/eslint-default-ignores/tasks/13ef5c1c-a441-4c1e-9a00-3862d4e95bd2/10.json`
- `plans/completed/eslint-default-ignores/tasks/13ef5c1c-a441-4c1e-9a00-3862d4e95bd2/11.json`
- `plans/completed/eslint-default-ignores/tasks/13ef5c1c-a441-4c1e-9a00-3862d4e95bd2/12.json`
- `plans/completed/eslint-default-ignores/tasks/13ef5c1c-a441-4c1e-9a00-3862d4e95bd2/2.json`
- `plans/completed/eslint-default-ignores/tasks/13ef5c1c-a441-4c1e-9a00-3862d4e95bd2/3.json`
- `plans/completed/eslint-default-ignores/tasks/13ef5c1c-a441-4c1e-9a00-3862d4e95bd2/4.json`
- `plans/completed/eslint-default-ignores/tasks/13ef5c1c-a441-4c1e-9a00-3862d4e95bd2/5.json`
- `plans/completed/eslint-default-ignores/tasks/13ef5c1c-a441-4c1e-9a00-3862d4e95bd2/6.json`
- `plans/completed/eslint-default-ignores/tasks/13ef5c1c-a441-4c1e-9a00-3862d4e95bd2/7.json`
- `plans/completed/eslint-default-ignores/tasks/13ef5c1c-a441-4c1e-9a00-3862d4e95bd2/8.json`
- `plans/completed/eslint-default-ignores/tasks/13ef5c1c-a441-4c1e-9a00-3862d4e95bd2/9.json`
- `plans/completed/expo-coverage-exclusions/expo-coverage-exclusions.md`
- `plans/completed/fibonacci-generator-rewrite/fibonacci-generator-rewrite.md`
- `plans/completed/fibonacci-generator-rewrite/tasks/1.json`
- `plans/completed/fibonacci-generator-rewrite/tasks/10.json`
- `plans/completed/fibonacci-generator-rewrite/tasks/11.json`
- `plans/completed/fibonacci-generator-rewrite/tasks/12.json`
- `plans/completed/fibonacci-generator-rewrite/tasks/13.json`
- `plans/completed/fibonacci-generator-rewrite/tasks/14.json`
- `plans/completed/fibonacci-generator-rewrite/tasks/15.json`
- `plans/completed/fibonacci-generator-rewrite/tasks/16.json`
- `plans/completed/fibonacci-generator-rewrite/tasks/17.json`
- `plans/completed/fibonacci-generator-rewrite/tasks/2.json`
- `plans/completed/fibonacci-generator-rewrite/tasks/3.json`
- `plans/completed/fibonacci-generator-rewrite/tasks/4.json`
- `plans/completed/fibonacci-generator-rewrite/tasks/5.json`
- `plans/completed/fibonacci-generator-rewrite/tasks/6.json`
- `plans/completed/fibonacci-generator-rewrite/tasks/7.json`
- `plans/completed/fibonacci-generator-rewrite/tasks/8.json`
- `plans/completed/fibonacci-generator-rewrite/tasks/9.json`
- `plans/completed/fibonacci-replacement/fibonacci-replacement-plan.md`
- `plans/completed/fibonacci-replacement/tasks/1.json`
- `plans/completed/fibonacci-replacement/tasks/10.json`
- `plans/completed/fibonacci-replacement/tasks/11.json`
- `plans/completed/fibonacci-replacement/tasks/12.json`
- `plans/completed/fibonacci-replacement/tasks/13.json`
- `plans/completed/fibonacci-replacement/tasks/14.json`
- `plans/completed/fibonacci-replacement/tasks/2.json`
- `plans/completed/fibonacci-replacement/tasks/3.json`
- `plans/completed/fibonacci-replacement/tasks/4.json`
- `plans/completed/fibonacci-replacement/tasks/5.json`
- `plans/completed/fibonacci-replacement/tasks/6.json`
- `plans/completed/fibonacci-replacement/tasks/7.json`
- `plans/completed/fibonacci-replacement/tasks/8.json`
- `plans/completed/fibonacci-replacement/tasks/9.json`

## GitHub Workflows Observed

- `.github/workflows/auto-update-pr-branches-dispatch.yml`
- `.github/workflows/auto-update-pr-branches.yml`
- `.github/workflows/build.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/claude-ci-auto-fix.yml`
- `.github/workflows/claude-code-review-response.yml`
- `.github/workflows/claude-deploy-auto-fix.yml`
- `.github/workflows/claude-nightly-code-complexity.yml`
- `.github/workflows/claude-nightly-jira-triage.yml`
- `.github/workflows/claude-nightly-test-coverage.yml`
- `.github/workflows/claude-nightly-test-improvement.yml`
- `.github/workflows/claude.yml`
- `.github/workflows/create-github-issue-on-failure.yml`
- `.github/workflows/create-issue-on-failure.yml`
- `.github/workflows/create-jira-issue-on-failure.yml`
- `.github/workflows/create-sentry-issue-on-failure.yml`
- `.github/workflows/deploy.yml`
- `.github/workflows/lighthouse.yml`
- `.github/workflows/load-test.yml`
- `.github/workflows/publish-to-npm.yml`
- `.github/workflows/quality-rails.yml`
- `.github/workflows/quality.yml`
- `.github/workflows/release-rails.yml`
- `.github/workflows/release.yml`
- `.github/workflows/reusable-auto-update-pr-branches-dispatch.yml`
- `.github/workflows/reusable-auto-update-pr-branches.yml`
- `.github/workflows/reusable-claude-ci-auto-fix.yml`
- `.github/workflows/reusable-claude-code-review-response.yml`
- `.github/workflows/reusable-claude-deploy-auto-fix.yml`
- `.github/workflows/reusable-claude-nightly-code-complexity-rails.yml`
- `.github/workflows/reusable-claude-nightly-code-complexity.yml`
- `.github/workflows/reusable-claude-nightly-jira-triage.yml`
- `.github/workflows/reusable-claude-nightly-test-coverage-rails.yml`
- `.github/workflows/reusable-claude-nightly-test-coverage.yml`
- `.github/workflows/reusable-claude-nightly-test-improvement-rails.yml`
- `.github/workflows/reusable-claude-nightly-test-improvement.yml`
- `.github/workflows/reusable-claude-sync-down-branches.yml`
- `.github/workflows/reusable-claude.yml`
- `.github/workflows/zap-baseline-expo.yml`
- `.github/workflows/zap-baseline-nestjs.yml`
- `.github/GITHUB_ACTIONS.md`

## Claude Commands, Rules, And Skills Observed

- `.claude/commands/claude-code-action/create.md`
- `.claude/commands/mutation-testing/run.md`
- `.claude/rules/PROJECT_RULES.md`
- `.claude/skills/claude-code-action/SKILL.md`
- `.claude/skills/claude-code-action/references/inputs.md`
- `.claude/skills/lisa-integration-test/SKILL.md`
- `.claude/skills/lisa-learn/SKILL.md`
- `.claude/skills/lisa-review-project/SKILL.md`
- `.claude/skills/lisa-update-projects/SKILL.md`
- `.claude/skills/lisa-wiki-ingest/SKILL.md`
- `.claude/skills/lisa-wiki-setup/SKILL.md`
- `.claude/skills/lisa-wiki-usage/SKILL.md`
- `.claude/skills/mutation-testing/SKILL.md`

## Source And Template Files Sampled

- `src/cli/index.ts`
- `src/cli/prompts.ts`
- `src/codex/agent-installer.ts`
- `src/codex/agent-transformer.ts`
- `src/codex/agents-md-installer.ts`
- `src/codex/hooks-installer.ts`
- `src/codex/hooks-merger.ts`
- `src/codex/manifest.ts`
- `src/codex/scripts/block-migration-edits.sh`
- `src/codex/scripts/format-on-edit.sh`
- `src/codex/scripts/inject-rules.sh`
- `src/codex/scripts/lint-on-edit.sh`
- `src/codex/scripts/notify-ntfy.sh`
- `src/codex/scripts/rubocop-on-edit.sh`
- `src/codex/scripts/sg-scan-on-edit.sh`
- `src/codex/settings-installer.ts`
- `src/codex/skills-installer.ts`
- `src/configs/eslint/base.ts`
- `src/configs/eslint/cdk.ts`
- `src/configs/eslint/expo.ts`
- `src/configs/eslint/index.ts`
- `src/configs/eslint/nestjs.ts`
- `src/configs/eslint/slow.ts`
- `src/configs/eslint/typescript.ts`
- `src/configs/jest/base.ts`
- `src/configs/jest/cdk.ts`
- `src/configs/jest/expo.ts`
- `src/configs/jest/index.ts`
- `src/configs/jest/nestjs.ts`
- `src/configs/jest/typescript.ts`
- `src/configs/vitest/base.ts`
- `src/configs/vitest/cdk.ts`
- `src/configs/vitest/index.ts`
- `src/configs/vitest/nestjs.ts`
- `src/configs/vitest/typescript.ts`
- `src/core/config.ts`
- `src/core/git-service.ts`
- `src/core/index.ts`
- `src/core/lisa.ts`
- `src/core/project-config.ts`
- `src/detection/detector.interface.ts`
- `src/detection/detectors/cdk.ts`
- `src/detection/detectors/expo.ts`
- `src/detection/detectors/nestjs.ts`
- `src/detection/detectors/npm-package.ts`
- `src/detection/detectors/rails.ts`
- `src/detection/detectors/typescript.ts`
- `src/detection/index.ts`
- `src/errors/index.ts`
- `src/index.ts`
- `src/logging/console-logger.ts`
- `src/logging/index.ts`
- `src/logging/logger.interface.ts`
- `src/logging/silent-logger.ts`
- `src/migrations/ensure-audit-ignore-local-exclusions.ts`
- `src/migrations/ensure-lisa-postinstall.ts`
- `src/migrations/ensure-tsconfig-local-includes.ts`
- `src/migrations/index.ts`
- `src/migrations/migration.interface.ts`
- `src/strategies/copy-contents.ts`
- `src/strategies/copy-overwrite.ts`
- `src/strategies/create-only.ts`
- `src/strategies/index.ts`
- `src/strategies/merge.ts`
- `src/strategies/package-lisa-types.ts`
- `src/strategies/package-lisa.ts`
- `src/strategies/strategy.interface.ts`
- `src/strategies/tagged-merge-types.ts`
- `src/strategies/tagged-merge.ts`
- `src/transaction/backup.ts`
- `src/transaction/index.ts`
- `src/transaction/transaction.ts`
- `src/types/minimatch.d.ts`
- `src/utils/fibonacci.ts`
- `src/utils/file-operations.ts`
- `src/utils/ignore-patterns.ts`
- `src/utils/index.ts`
- `src/utils/json-utils.ts`
- `src/utils/path-utils.ts`
- `src/utils/postinstall-trampoline.ts`
- `scripts/build-plugins.sh`
- `scripts/cleanup-amplify-branches.sh`
- `scripts/cleanup-github-branches.sh`
- `scripts/github-status-check.sh`
- `scripts/install-claude-plugins.sh`
- `scripts/lisa-commit-and-pr-local.sh`
- `scripts/lisa-update-local.sh`
- `scripts/setup-deploy-key.sh`
- `scripts/test-intent-routing.sh`
- `scripts/update-node-version.ts`
- `all/copy-contents/.gitignore`
- `all/copy-overwrite/.safety-net.json`
- `all/create-only/.claude/rules/PROJECT_RULES.md`
- `all/create-only/.lisaignore`
- `all/create-only/specs/.keep`
- `all/deletions.json`
- `all/merge/.claude/settings.json`
- `typescript/copy-contents/.husky/commit-msg`
- `typescript/copy-contents/.husky/pre-commit`
- `typescript/copy-contents/.husky/pre-push`
- `typescript/copy-overwrite/.github/GITHUB_ACTIONS.md`
- `typescript/copy-overwrite/.github/dependabot.yml`
- `typescript/copy-overwrite/.gitleaksignore`
- `typescript/copy-overwrite/.lintstagedrc.json`
- `typescript/copy-overwrite/.nvmrc`
- `typescript/copy-overwrite/.prettierignore`
- `typescript/copy-overwrite/.prettierrc.json`
- `typescript/copy-overwrite/.versionrc`
- `typescript/copy-overwrite/.yamllint`
- `typescript/copy-overwrite/ast-grep/rule-tests/.gitkeep`
- `typescript/copy-overwrite/ast-grep/rules/.gitkeep`
- `typescript/copy-overwrite/ast-grep/utils/.gitkeep`
- `typescript/copy-overwrite/audit.ignore.config.json`
- `typescript/copy-overwrite/commitlint.config.cjs`
- `typescript/copy-overwrite/eslint.config.ts`
- `typescript/copy-overwrite/eslint.ignore.config.json`
- `typescript/copy-overwrite/eslint.slow.config.ts`
- `typescript/copy-overwrite/knip.json`
- `typescript/copy-overwrite/sgconfig.yml`
- `typescript/copy-overwrite/tsconfig.eslint.json`
- `typescript/copy-overwrite/tsconfig.json`
- `typescript/copy-overwrite/vitest.config.ts`
- `typescript/create-only/.github/workflows/auto-update-pr-branches-dispatch.yml`
- `typescript/create-only/.github/workflows/auto-update-pr-branches.yml`
- `typescript/create-only/.github/workflows/ci.yml`
- `typescript/create-only/.github/workflows/claude-ci-auto-fix.yml`
- `typescript/create-only/.github/workflows/claude-code-review-response.yml`
- `typescript/create-only/.github/workflows/claude-deploy-auto-fix.yml`
- `typescript/create-only/.github/workflows/claude-nightly-code-complexity.yml`
- `typescript/create-only/.github/workflows/claude-nightly-jira-triage.yml`
- `typescript/create-only/.github/workflows/claude-nightly-test-coverage.yml`
- `typescript/create-only/.github/workflows/claude-nightly-test-improvement.yml`
- `typescript/create-only/.github/workflows/claude-sync-down-branches.yml`
- `typescript/create-only/.github/workflows/claude.yml`
- `typescript/create-only/.husky/pre-push.local`
- `typescript/create-only/audit.ignore.local.json`
- `typescript/create-only/eslint.config.local.ts`
- `typescript/create-only/eslint.thresholds.json`
- `typescript/create-only/jest.config.local.ts`
- `typescript/create-only/jest.thresholds.json`
- `typescript/create-only/tsconfig.local.json`
- `typescript/create-only/vitest.config.local.ts`
- `typescript/create-only/vitest.thresholds.json`
- `typescript/deletions.json`
- `typescript/github-rulesets/base.json`
- `typescript/merge/.claude/settings.json`
- `typescript/merge/.oxlintrc.json`
- `typescript/package-lisa/package.lisa.json`
- `expo/copy-overwrite/.easignore.extra`
- `expo/copy-overwrite/eslint.config.ts`
- `expo/copy-overwrite/eslint.expo.ts`
- `expo/copy-overwrite/eslint.slow.config.ts`
- `expo/copy-overwrite/jest.config.ts`
- `expo/copy-overwrite/jest.expo.ts`
- `expo/copy-overwrite/jest.setup.pre.js`
- `expo/copy-overwrite/jest.setup.ts`
- `expo/copy-overwrite/knip.json`
- `expo/copy-overwrite/tsconfig.eslint.json`
- `expo/copy-overwrite/tsconfig.expo.json`
- `expo/copy-overwrite/tsconfig.json`
- `expo/create-only/.github/workflows/ci.yml`
- `expo/create-only/.github/workflows/deploy.yml`
- `expo/create-only/.zap/baseline.conf`
- `expo/create-only/babel.config.js`
- `expo/create-only/jest.config.local.ts`
- `expo/create-only/jest.config.react-native-mock.js`
- `expo/create-only/jest.setup.local.ts`
- `expo/create-only/jest.setup.pre.local.js`
- `expo/create-only/lighthouserc-config.json`
- `expo/create-only/lighthouserc.js`
- `expo/create-only/scripts/zap-baseline.sh`
- `expo/create-only/tsconfig.local.json`
- `expo/deletions.json`
- `expo/merge/.claude/settings.json`
- `expo/merge/.oxlintrc.json`
- `expo/package-lisa/package.lisa.json`
- `nestjs/copy-overwrite/eslint.config.ts`
- `nestjs/copy-overwrite/eslint.nestjs.ts`
- `nestjs/copy-overwrite/eslint.slow.config.ts`
- `nestjs/copy-overwrite/knip.json`
- `nestjs/copy-overwrite/tsconfig.build.json`
- `nestjs/copy-overwrite/tsconfig.eslint.json`
- `nestjs/copy-overwrite/tsconfig.json`
- `nestjs/copy-overwrite/tsconfig.nestjs.json`
- `nestjs/copy-overwrite/tsconfig.spec.json`
- `nestjs/copy-overwrite/vitest.config.ts`
- `nestjs/copy-overwrite/vitest.nestjs.ts`
- `nestjs/create-only/.github/k6/BROWSER_TESTING_NOTE.md`
- `nestjs/create-only/.github/k6/INTEGRATION_GUIDE.md`
- `nestjs/create-only/.github/k6/README.md`
- `nestjs/create-only/.github/k6/SCENARIO_SELECTION_GUIDE.md`
- `nestjs/create-only/.github/k6/examples/customer-deploy-integration.yml`
- `nestjs/create-only/.github/k6/examples/data-driven-test.js`
- `nestjs/create-only/.github/k6/scenarios/load.js`
- `nestjs/create-only/.github/k6/scenarios/load.json`
- `nestjs/create-only/.github/k6/scenarios/smoke.js`
- `nestjs/create-only/.github/k6/scenarios/smoke.json`
- `nestjs/create-only/.github/k6/scenarios/soak.js`
- `nestjs/create-only/.github/k6/scenarios/soak.json`
- `nestjs/create-only/.github/k6/scenarios/spike.js`
- `nestjs/create-only/.github/k6/scenarios/spike.json`
- `nestjs/create-only/.github/k6/scenarios/stress.js`
- `nestjs/create-only/.github/k6/scenarios/stress.json`
- `nestjs/create-only/.github/k6/scripts/api-test.js`
- `nestjs/create-only/.github/k6/scripts/default-test.js`
- `nestjs/create-only/.github/k6/thresholds/normal.json`
- `nestjs/create-only/.github/k6/thresholds/relaxed.json`
- `nestjs/create-only/.github/k6/thresholds/strict.json`
- `nestjs/create-only/.github/workflows/ci.yml`
- `nestjs/create-only/.github/workflows/deploy.yml`
- `nestjs/create-only/.zap/baseline.conf`
- `nestjs/create-only/scripts/zap-baseline.sh`
- `nestjs/create-only/tsconfig.local.json`
- `nestjs/create-only/vitest.config.local.ts`
- `nestjs/create-only/vitest.thresholds.json`
- `nestjs/deletions.json`
- `nestjs/merge/.claude/settings.json`
- `nestjs/merge/.oxlintrc.json`
- `nestjs/package-lisa/package.lisa.json`
- `cdk/copy-overwrite/.github/workflows/.keep`
- `cdk/copy-overwrite/eslint.cdk.ts`
- `cdk/copy-overwrite/eslint.config.ts`
- `cdk/copy-overwrite/eslint.slow.config.ts`
- `cdk/copy-overwrite/knip.json`
- `cdk/copy-overwrite/tsconfig.cdk.json`
- `cdk/copy-overwrite/tsconfig.eslint.json`
- `cdk/copy-overwrite/tsconfig.json`
- `cdk/copy-overwrite/vitest.cdk.ts`
- `cdk/copy-overwrite/vitest.config.ts`
- `cdk/create-only/.github/workflows/ci.yml`
- `cdk/create-only/.github/workflows/deploy.yml`
- `cdk/create-only/cdk.json`
- `cdk/create-only/tsconfig.local.json`
- `cdk/create-only/vitest.config.local.ts`
- `cdk/create-only/vitest.thresholds.json`
- `cdk/deletions.json`
- `cdk/merge/.claude/settings.json`
- `cdk/merge/.oxlintrc.json`
- `cdk/package-lisa/package.lisa.json`
- `rails/copy-contents/Gemfile`
- `rails/copy-overwrite/.rubocop.yml`
- `rails/copy-overwrite/.versionrc`
- `rails/copy-overwrite/Gemfile.lisa`
- `rails/copy-overwrite/config/initializers/version.rb`
- `rails/copy-overwrite/lefthook.yml`
- `rails/create-only/.github/workflows/ci.yml`
- `rails/create-only/.github/workflows/claude-code-review-response.yml`
- `rails/create-only/.github/workflows/claude-nightly-code-complexity.yml`
- `rails/create-only/.github/workflows/claude-nightly-jira-triage.yml`
- `rails/create-only/.github/workflows/claude-nightly-test-coverage.yml`
- `rails/create-only/.github/workflows/claude-nightly-test-improvement.yml`
- `rails/create-only/.github/workflows/claude-sync-down-branches.yml`
- `rails/create-only/.github/workflows/deploy.yml`
- `rails/create-only/.mise.toml`
- `rails/create-only/.reek.yml`
- `rails/create-only/.rspec`
- `rails/create-only/.rubocop.local.yml`
- `rails/create-only/.rubocop_todo.yml`
- `rails/create-only/.simplecov`
- `rails/create-only/VERSION`

## Reader-Safe Documentation Excerpts

### `README.md`

```text
# Lisa

Lisa is a governance layer for AI-assisted software development. It ensures that AI agents — whether running on a developer's machine or in CI/CD — follow the same standards, workflows, and quality gates.

## What Lisa Does

### Intent Routing

When a request comes in (from a human, a JIRA ticket, or a scheduled job), Lisa classifies it and routes it to the appropriate **flow**. Flows are ordered sequences of specialized agents, each with a defined role.

A request to fix a bug routes to a different flow than a request to build a feature or reduce code complexity. The routing is automatic based on context, but can be overridden explicitly via slash commands.

### Flows and Agents

A flow is a pipeline. Each step in the pipeline is an **agent** — a scoped AI with specific tools and instructions. One agent investigates git history, another reproduces bugs, another writes code, another verifies the result.

Behind the scenes, agents delegate domain-specific work to reusable instruction sets that are loaded automatically when a command runs. The same logic that triages a JIRA ticket interactively is the same logic invoked by the nightly triage workflow — you don't need to know which one is running.

Flows can nest. A build flow includes a verification sub-flow, which includes a ship sub-flow. This composition keeps each flow focused while enabling complex end-to-end workflows.

### Quality Gates

Lisa enforces quality through layered gates:

- **Rules** are loaded into every AI session automatically. They define coding standards, architectural patterns, and behavioral expectations. The AI follows them because they're part of its context.
- **Git hooks** are hard stops. Pre-commit hooks run linting, formatting, and type checking. Pre-push hooks run tests, coverage checks, security audits, and dead code detection. Nothing ships without passing.
- **Claude hooks** bridge AI actions to project tooling — ensuring that when the AI commits, pushes, or creates a PR, the project's quality infrastructure runs.

### Location Agnostic

The same rules, workflows, and quality gates apply everywhere:

- On a developer's workstation running Claude Code interactively
- In a GitHub Action running a nightly improvement job
- In a CI workflow responding to a PR review comment

The orchestration adapts to context — using MCP integrations locally and REST APIs in CI — but the standards don't change.

### Template Governance

Lisa distributes its standards to downstream proj
```

### `OVERVIEW.md`

```text
# Lisa: Claude Code Governance Framework

![Lisa Architecture](docs/lisa-architecture.svg)

## Executive Summary

**Lisa** is a governance framework that ensures Claude Code produces high-quality, consistent code through multiple layers of guardrails, guidance, and automated enforcement. The system is designed with a key principle: **implementation teams don't need to be AI experts**—they just run commands and let Lisa handle the rest.

### Two Roles, One System

| Role | Responsibility | Skills Needed |
|------|----------------|---------------|
| **Platform Expert** | Sets up skills, hooks, ESLint rules, commands | High - deep AI/LLM expertise |
| **Implementation Teams** | Run commands, answer gap questions, review PRs | None - just use the tools |

The platform expert creates a "paved road" where implementation teams can leverage AI without understanding prompt engineering, context management, or AI limitations. Teams interact with simple slash commands, not raw AI prompts.

---

## Part 1: What is Lisa?

**Lisa** is a multi-layer quality system that prevents AI from producing inconsistent or low-quality code. It works by:

1. **Teaching Claude** the right patterns (Skills & Rules)
2. **Enforcing quality automatically** (Hooks, ESLint, Git Hooks)
3. **Guiding workflows** with pre-built commands (Slash Commands)
4. **Blocking bad code** before it's committed (Guardrails)

### The Problem Lisa Solves

Without Lisa, Claude Code can:
- Write inconsistent code styles across sessions
- Skip tests or quality checks when not explicitly told
- Over-engineer solutions or create unnecessary abstractions
- Mutate data instead of using immutable patterns
- Leave deprecated code instead of cleanly deleting it

### The Solution: Layered Governance

| Layer | What It Does | Example |
|-------|--------------|---------|
| **CLAUDE.md** | Direct behavioral rules | "Always use immutable patterns" |
| **Rules** | Auto-loaded project conventions | Coding philosophy, verification requirements |
| **Skills** | Teach patterns & philosophy | JSDoc best practices, skill creation |
| **Hooks** | Auto-enforcement on every edit | Format, lint, ast-grep scan after writes |
| **Plugins** | Extended capabilities | Safety Net, TypeScript LSP, Code Review |
| **ESLint Plugins** | Enforce code structure | Require statement ordering, prevent inline styles |
| **ast-grep** | Pattern-based linting | Custom AST rules for anti-patterns |
| **Knip** | Dead code detection | Find unused exports,
```

### `CONTRIBUTING.md`

```text
# Contributing to Lisa

Thank you for your interest in contributing to Lisa! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Style Guidelines](#style-guidelines)

## Code of Conduct

Please be respectful and constructive in all interactions. We welcome contributors of all experience levels.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Create a branch for your changes

```bash
git clone https://github.com/YOUR_USERNAME/lisa.git
cd lisa
git checkout -b feature/your-feature-name
```

## Development Setup

### Prerequisites

- Bash 3.2+ (default on macOS)
- `jq` for JSON processing
- `bats-core` for testing (optional but recommended)

### Installing Dependencies

**macOS:**
```bash
brew install jq bats-core
```

**Linux (Debian/Ubuntu):**
```bash
sudo apt install jq bats
```

**Linux (RHEL/CentOS):**
```bash
sudo yum install jq
# For bats, install from source or use npm
npm install -g bats
```

### Project Structure

```
lisa/
├── lisa.sh                 # Main bootstrapper script
├── tests/                  # Test suite
│   └── lisa.bats          # Bats tests for lisa.sh
├── all/                    # Configs for all projects
│   ├── copy-overwrite/    # Files that replace existing
│   ├── copy-contents/     # Files that append content
│   ├── create-only/       # Files created only if missing
│   └── merge/             # JSON files to deep merge
├── typescript/             # TypeScript-specific configs
├── expo/                   # Expo-specific configs
├── nestjs/                 # NestJS-specific configs
└── cdk/                    # CDK-specific configs
```

## Making Changes

### Adding New Configuration Files

1. Identify the correct type directory (`all/`, `typescript/`, `expo/`, etc.)
2. Choose the appropriate strategy subdirectory:
   - `copy-overwrite/` - Standard configs that should match Lisa's version
   - `copy-contents/` - Files like `.gitignore` where content is appended
   - `create-only/` - Template files created once and customized by user
   - `merge/` - JSON files where Lisa provides defaults

3. Place your file in the correct location

**Example: Adding an ESLint config for TypeScript projects**
```bash
lisa/typescript/copy-overwrite/eslint.config.
```

### `docs/task-management-system.md`

```text
# Task Management System

Lisa includes a comprehensive task management system for structured team-based development workflows. These tools enable decomposing complex projects into discrete work items with dependency tracking.

> **Note:** These tools are provided by [cc-mirror](https://github.com/numman-ali/cc-mirror), a team collaboration platform. They integrate with Claude Code to enable multi-agent orchestration and parallel work streams.

## Overview

The task management system provides four core operations:

| Tool | Purpose |
|------|---------|
| **TaskCreate** | Create new work items |
| **TaskGet** | Retrieve task details and dependencies |
| **TaskUpdate** | Modify task state, add notes, establish dependencies |
| **TaskList** | View all tasks and their status |

Each task has:
- **ID**: Numeric identifier
- **Subject**: Brief title
- **Description**: Detailed work requirements
- **Status**: `open` or `resolved`
- **Owner**: Worker assigned to the task
- **Dependencies**: Blocking relationships between tasks

## TaskCreate

Create a new work item in the task queue.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `subject` | string | Yes | Brief task title (25-100 characters) |
| `description` | string | Yes | Detailed explanation of work needed |

### Example

```json
{
  "subject": "Implement user authentication",
  "description": "Add login/logout with JWT tokens, bcrypt password hashing, and session management. Support both email and OAuth flows."
}
```

### Response

```json
{
  "task": {
    "id": "1",
    "subject": "Implement user authentication",
    "description": "...",
    "status": "open",
    "owner": null,
    "blockedBy": [],
    "blocks": [],
    "comments": []
  }
}
```

## TaskGet

Retrieve comprehensive information about a specific task.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | Yes | Numeric task identifier |

### Example

```json
{
  "taskId": "1"
}
```

### Response

```json
{
  "task": {
    "id": "1",
    "subject": "Implement user authentication",
    "description": "Add login/logout with JWT tokens, bcrypt password hashing, and session management. Support both email and OAuth flows.",
    "status": "open",
    "owner": "worker-001",
    "blockedBy": [],
    "blocks": ["2", "3"],
    "comments": [
      {
        "author": "worker-001",
        "content": "Started impleme
```

### `docs/workflows/prd-to-ticket-intake.md`

```text
# PRD-to-Ticket Intake Workflow

End-to-end pipeline that takes a Notion PRD all the way through JIRA ticket creation, validation, coverage audit, and ultimately into the build flow that opens PRs. The pipeline is composed of two **intake skills** — one on the Notion side, one on the JIRA side — that mirror each other and run on the same `Status = Ready → claim → process → next status` pattern.

## Why this matters

Without this pipeline, the path from PRD to shipped code is manual at every step:
- Someone reads the PRD, decides it's ready, opens JIRA, types in epics/stories/sub-tasks one by one.
- Quality is uneven (Gherkin AC missing on some, no Validation Journey on others, scope spread across repos in one ticket).
- Silent gaps creep in — the PRD has 9 user stories, 8 tickets get created, nobody notices.
- Once tickets exist, someone has to triage them, verify them, and start the build flow per ticket.

This workflow automates the mechanical parts and **uses gates that already exist** (`jira-validate-ticket`, `prd-ticket-coverage`, `jira-verify`, `ticket-triage`) to keep quality high. Humans own the two decision points that matter: "is this PRD ready to be ticketed?" (Notion `Ready`) and "is this ticket ready to be built?" (JIRA `Ready`). Everything in between runs unattended.

## End-to-end pipeline

```
Notion (PRD lifecycle)             JIRA (ticket lifecycle)
─────────────────────              ─────────────────────────
Draft                              (n/a yet)
  ↓ (product flips)
Ready                              (n/a yet)
  ↓ (notion-prd-intake claims)
In Review
  ↓ (validate + coverage)
Blocked  OR  Ticketed   ─────►  To Do
                                   ↓ (PM/human flips)
                                 Ready
                                   ↓ (jira-build-intake claims)
                                 In Progress
                                   ↓ (build flow runs, PR opens)
                                 On Dev
                                   ↓ (downstream — QA, deploy)
                                 ... → Done
  ↑ (after delivery)
Shipped
```

Two human decision points, in bold:
- **Notion `Draft → Ready`** — product says "this PRD is buildable, hand it off."
- **JIRA `To Do → Ready`** — PM/lead says "this individual ticket is ready for the build agent to pick up."

Everything else is automated.

## Setup

### 1. Notion side

Your PRDs need to live in a **database** with a `Status` property whose options are at minimum: `D
```

### `specs/package-lisa-json.md`

```text
# Package.lisa.json Implementation Plan

## Problem Statement

Lisa's current `tagged-merge` strategy uses inline `//lisa-*` comment keys inside `package.json` objects (e.g., inside `devDependencies`). This causes two issues:

1. **Bun install fails** - Bun treats `//lisa-force-dev-dependencies` as an actual package name and tries to resolve it from npm registry
2. **Knip can't ignore them** - Knip's `ignoreDependencies` skips entries starting with `/` because they're not valid package names

## Solution

Replace inline `//lisa-*` tags with separate `package.lisa.json` template files that define:
- **force**: Keys Lisa always overwrites (project changes are discarded)
- **defaults**: Keys Lisa sets only if missing (project can override)
- **merge**: Arrays where Lisa's items are combined with project's items

The project's `package.json` remains 100% clean - no Lisa artifacts.

## New File Format

### Template: `package.lisa.json`

```json
{
  "force": {
    "devDependencies": {
      "eslint": "^9.0.0",
      "prettier": "^3.0.0"
    },
    "scripts": {
      "lint": "eslint . --quiet",
      "test": "jest"
    }
  },
  "defaults": {
    "engines": {
      "node": "22.x"
    }
  },
  "merge": {
    "trustedDependencies": ["@ast-grep/cli"]
  }
}
```

### Inheritance Chain

Templates inherit and merge up the chain:

```
all/package-lisa/package.lisa.json
└── typescript/package-lisa/package.lisa.json
    ├── expo/package-lisa/package.lisa.json
    ├── nestjs/package-lisa/package.lisa.json
    ├── npm-package/package-lisa/package.lisa.json
    └── cdk/package-lisa/package.lisa.json
```

**Merge rules for inheritance:**
- `force`: Child values override parent values (deep merge, child wins)
- `defaults`: Child values override parent values (deep merge, child wins)
- `merge`: Arrays are concatenated and deduplicated

### Application Logic

When Lisa applies `package.lisa.json` to a project:

1. **Collect templates** - Gather all `package.lisa.json` files from detected types (e.g., `all` + `typescript` + `expo`)
2. **Merge templates** - Combine into single force/defaults/merge structure
3. **Read project's package.json** - Parse current state
4. **Apply force** - Deep merge, Lisa's values win
5. **Apply defaults** - Deep merge, project's values win (only set if missing)
6. **Apply merge** - Concatenate arrays, deduplicate
7. **Write package.json** - Output clean JSON with no Lisa metadata

## Implementation Tasks

### Phase 1: Create New Strategy

#### Task 1.1:
```

### `specs/tagged-merge.md`

```text
# Tagged Merge Strategy Implementation

## Overview

Implement a new `tagged-merge/` copy strategy for Lisa that enables fine-grained control over JSON file sections through comment-based tags. This allows Lisa to manage specific sections (like CI/CD scripts or required dependencies) while permitting projects to customize or extend other sections.

## Problem Statement

Current strategies are limited:
- `merge/` applies global deep merge: either Lisa's defaults win or project's values win
- No way to force certain values while allowing project overrides in other areas
- No way to merge array values (e.g., `trustedDependencies`)

The tagged-merge strategy solves this by allowing multiple tagged regions within a single JSON file, each with different merge semantics.

## Design

### Tag Format

Tags use JSON comment keys with consistent naming: `//lisa-<behavior>-<category>`

```json
{
  "//lisa-force-scripts": "Description of what Lisa manages here",
  "script1": "value1",
  "script2": "value2",
  "//end-lisa-force-scripts": "",
  "custom-script": "user's own script"
}
```

### Behaviors

| Behavior | Tag Pattern | Description |
|----------|-------------|----------|
| **Force** | `//lisa-force-*` | Lisa replaces entire section; project changes are ignored |
| **Defaults** | `//lisa-defaults-*` | Lisa provides values; project can override entire section |
| **Merge** | `//lisa-merge-*` | For arrays: combine Lisa's items + project's items (deduplicated) |

### Closing Tags

Every opening tag must have a matching closing tag: `//end-lisa-<behavior>-<category>`

Example:
```json
{
  "//lisa-force-deps": "Required dependencies",
  "@package/a": "1.0.0",
  "@package/b": "2.0.0",
  "//end-lisa-force-deps": ""
}
```

## Implementation Plan

### Phase 1: Core Strategy Class

**File**: `src/strategies/tagged-merge.ts`

Create a new strategy class that:

1. **Parse tagged sections** from Lisa's JSON template
   - Identify all `//lisa-<behavior>-*` tags
   - Extract content between opening and closing tags
   - Track order and behavior for each section

2. **Parse project's JSON** to identify existing tags
   - Build a map of existing tagged sections
   - Preserve untagged content

3. **Merge logic per behavior**:
   - **Force**: Replace entire section with Lisa's version
   - **Defaults**: Keep project's section if exists, add Lisa's if missing
   - **Merge** (arrays): Combine both, deduplicate by JSON value equality

4. **Preserve order**
   - Maintain JSON key orderi
```

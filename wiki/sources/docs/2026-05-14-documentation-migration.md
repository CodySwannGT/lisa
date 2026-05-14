# Documentation Migration Source Note

Date: 2026-05-14

Scope: Move existing durable Lisa markdown documentation into `wiki/documentation/` so the wiki is the source of truth for project documentation.

## Moved Documentation

| Previous path | Wiki path |
| --- | --- |
| `OVERVIEW.md` | `wiki/documentation/overview.md` |
| `CONTRIBUTING.md` | `wiki/documentation/contributing.md` |
| `STRATEGY_TESTS_COPY_PASTE.md` | `wiki/documentation/testing/strategy-tests-copy-paste.md` |
| `STRATEGY_TESTS_README.md` | `wiki/documentation/testing/strategy-tests-readme.md` |
| `STRATEGY_TESTS_VISUAL_GUIDE.md` | `wiki/documentation/testing/strategy-tests-visual-guide.md` |
| `STRATEGY_TEST_PATTERNS.md` | `wiki/documentation/testing/strategy-test-patterns.md` |
| `STRATEGY_TEST_TEMPLATE.md` | `wiki/documentation/testing/strategy-test-template.md` |
| `tasks-test-plan.md` | `wiki/documentation/testing/tasks-test-plan.md` |
| `claude-overinstructions.md` | `wiki/documentation/claude/overinstructions.md` |
| `claude-review.md` | `wiki/documentation/claude/review.md` |
| `claude-task-list.md` | `wiki/documentation/claude/task-list.md` |
| `expo-upgrade.md` | `wiki/documentation/platforms/expo-upgrade.md` |
| `docs/lisa-architecture.svg` | `wiki/documentation/assets/lisa-architecture.svg` |
| `docs/task-management-system.md` | `wiki/documentation/workflows/task-management-system.md` |
| `docs/workflows/claude-code-web-notifications.md` | `wiki/documentation/workflows/claude-code-web-notifications.md` |
| `docs/workflows/prd-to-ticket-intake.md` | `wiki/documentation/workflows/prd-to-ticket-intake.md` |
| `specs/package-lisa-json.md` | `wiki/documentation/specs/package-lisa-json.md` |
| `specs/tagged-merge.md` | `wiki/documentation/specs/tagged-merge.md` |

## Kept Outside The Wiki

- `README.md` remains the package and GitHub landing page, with links into the wiki.
- `docs/wiki-inbox/` remains an ingestion inbox.
- `plans/` remains operational workflow state rather than canonical documentation.
- `plugins/` markdown remains product/template payload content rather than wiki documentation.
- `specs/.keep` remains a placeholder for any tooling that expects the directory to exist.

## Synthesis Notes

- Added `wiki/documentation/index.md` as the maintained documentation map.
- Updated root agent instructions and Lisa wiki setup skills to reference `wiki/documentation/overview.md`.
- Updated moved internal links and asset references that pointed at old root paths.
- Updated `wiki/index.md`, `wiki/start-here.md`, `wiki/schema/llm-wiki-contract.md`, and `wiki/log.md`.

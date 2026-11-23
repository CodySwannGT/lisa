# Always-Promotable Source

- Ingested: 2026-11-23
- Work item: [CodySwannGT/lisa#5188](https://github.com/CodySwannGT/lisa/issues/5188)
- Branch at ingestion: `feat/5188-always-promotable`, cut from `main` at `fc8e37db0c` (Lisa 8.8.0)
- Origin: direction given by the repository owner in a working session on 2026-11-22 and 2026-11-23. The seven rulings are recorded word for word in the work item under "Owner rulings". No host project, company or meeting is a source for this note.

## Scope read

- The coding philosophy rule, eager and reference (`plugins/src/base/rules/`).
- `plugins/src/base/rules/reference/config-resolution.md` and `work-item-definition-of-ready.md`.
- The work-item validators and writers for GitHub, JIRA and Linear, and `lisa-track`, `lisa-implement`, `lisa-verify`, `lisa-drive-pr-to-merge`, `lisa-task-decomposition`, `lisa-git-submit-pr` and `lisa-doctor`.
- The shipped scripts `all/copy-overwrite/scripts/lisa-release-switch.mjs` and `all/copy-overwrite/scripts/lib/release-switch.mjs`, and the completion checker in `all/copy-overwrite/scripts/lib/completion-authorization.mjs`.
- `src/cli/doctor-release-setting.ts` and `plugins/src/base/hooks/inject-resolved-config.mjs`.

## What was searched before deciding

- The tracker, open and closed, for "promotable", "feature flag", "always releasable" and "dark launch": no earlier ticket covered the principle, and none had been declined.
- The existing rules: `promotion-contract` is about promoting learnings into controls, and `production-verifiability` covers detecting, diagnosing and undoing a change. Neither says a shared branch must stay promotable.

## Pages synthesized

- [Decision: every shared branch is always promotable](../../decisions/2026-11-23-always-promotable.md)

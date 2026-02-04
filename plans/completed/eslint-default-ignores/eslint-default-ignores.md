# Plan: Add `.claude-active-plan/**` to eslint.base.ts defaultIgnores

## Summary

Add `.claude-active-plan/**` to the `defaultIgnores` array in `eslint.base.ts`. This pattern is already present in the `eslint.ignore.config.json` template (which overrides defaults), but should also be in the code fallback defaults for completeness and consistency.

## Branch

- **Source branch**: Create `fix/eslint-default-ignores` from `main`
- **PR target**: `main`

## Changes

### File: `typescript/copy-overwrite/eslint.base.ts`

Add `.claude-active-plan/**` after `.claude-active-project/**` (line 50) in the `defaultIgnores` array.

```typescript
".claude-active-project/**",
".claude-active-plan/**",  // <-- add this line
```

## Skills

- `/coding-philosophy`
- `/jsdoc-best-practices`

## Task List

Create the following tasks using `TaskCreate`:

1. **Add `.claude-active-plan/**` to defaultIgnores in eslint.base.ts**
   - Type: Task
   - Edit `typescript/copy-overwrite/eslint.base.ts` line 50 area
   - Verification: `grep -n "claude-active-plan" typescript/copy-overwrite/eslint.base.ts` should show the new line
   - Skills: `/coding-philosophy`

2. **Run linter to verify no regressions**
   - Type: Task
   - Run `bun run lint` to confirm the change doesn't break anything
   - Verification: `bun run lint` exits 0

3. **Run tests to verify no regressions**
   - Type: Task
   - Run `bun run test` to confirm no test failures
   - Verification: `bun run test` exits 0

4. **Commit and open draft PR**
   - Type: Task
   - Use `/git:commit-and-submit-pr` skill
   - Branch: `fix/eslint-default-ignores` targeting `main`

5. **Review code with CodeRabbit**
   - Type: Task
   - Use `coderabbit:review` agent
   - After implementation is complete

6. **Review code with local code review**
   - Type: Task
   - Use `/plan-local-code-review` skill
   - After implementation is complete

7. **Implement valid review suggestions**
   - Type: Task
   - After both code reviews are complete

8. **Simplify implemented code with code simplifier agent**
   - Type: Task
   - After review implementation

9. **Update/add/remove tests**
   - Type: Task
   - No test changes expected for this trivial config change - verify and confirm N/A

10. **Update/add/remove documentation**
    - Type: Task
    - No documentation changes expected - verify and confirm N/A

11. **Verify all verification metadata in existing tasks**
    - Type: Task
    - Run all proof commands from completed tasks

12. **Archive the plan**
    - Type: Task
    - Create folder `eslint-default-ignores` in `./plans/completed`
    - Rename this plan to a name befitting the actual contents
    - Move it into `./plans/completed/eslint-default-ignores`
    - Read the session IDs from `./plans/completed/eslint-default-ignores`
    - For each session ID, move `~/.claude/tasks/<session-id>` to `./plans/completed/eslint-default-ignores/tasks`
    - Update any "in_progress" task to "completed"
    - Commit changes
    - Push changes to the PR

## Verification

```bash
grep -n "claude-active-plan" typescript/copy-overwrite/eslint.base.ts
```

Expected: A line showing `.claude-active-plan/**` in the `defaultIgnores` array.

## Sessions

<!-- Auto-maintained by track-plan-sessions.sh -->
| Session ID | First Seen | Phase |
|------------|------------|-------|
| 361bc5b7-8f1d-4db5-b06a-1be2847c76fe | 2026-02-04T00:25:19Z | plan |

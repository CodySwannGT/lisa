# Remove ts-node from NestJS Templates and Backend-v2

## Problem

ts-node v10.x does not support TypeScript 5.0+ array `extends` in tsconfig.json. Lisa NestJS templates use array extends (`"extends": ["./tsconfig.nestjs.json", "./tsconfig.local.json"]`), causing:

```
TypeError: value.replace is not a function
    at normalizeSlashes (ts-node/dist/util.js:62:18)
    at Object.getExtendsConfigPath (ts-node/dist/ts-internals.js:24:54)
```

This was previously fixed for CDK projects (`plans/completed/remove-ts-node-use-tsx/`). NestJS was deferred due to `typeorm-ts-node-commonjs`, but needs the same fix now.

## Branches & PRs

- **Lisa**: `fix/tsconfig-local-override` branch, PR #148 to `main` — https://github.com/CodySwannGT/lisa/pull/148
- **Backend-v2**: `fix/remove-ts-node-use-tsx` branch, PR #425 to `dev` — https://github.com/geminisportsai/backend-v2/pull/425

## Changes

### 1. Lisa: `nestjs/package-lisa/package.lisa.json`

Replace `typeorm-ts-node-commonjs` with `tsx ./node_modules/typeorm/cli.js` in defaults.scripts and remove `ts-node` from force.devDependencies:

```json
{
  "defaults": {
    "scripts": {
      "migration:generate": "tsx ./node_modules/typeorm/cli.js migration:generate -d typeorm.config.ts src/database/migrations/$npm_config_name",
      "migration:run": "tsx ./node_modules/typeorm/cli.js migration:run -d typeorm.config.ts",
      "migration:revert": "tsx ./node_modules/typeorm/cli.js migration:revert -d typeorm.config.ts"
    }
  },
  "force": {
    "devDependencies": {
      // ts-node line REMOVED entirely
    }
  }
}
```

### 2. Lisa: `nestjs/copy-overwrite/.claude/skills/typeorm-patterns/references/configuration-patterns.md`

Update line 381: `typeorm-ts-node-commonjs` → `tsx with typeorm CLI`

### 3. Backend-v2: `package.json` scripts

| Script | Current | New |
|--------|---------|-----|
| `test:debug` | `node --inspect-brk -r tsconfig-paths/register -r ts-node/register node_modules/.bin/jest --runInBand` | `node --inspect-brk --import tsx node_modules/.bin/jest --runInBand` |
| `generate:types` | `ts-node generate-typings` | `tsx generate-typings` |
| `execute` | `...ts-node ./src/console.ts` | `...tsx ./src/console.ts` |
| `typeorm` | `ts-node ./node_modules/typeorm/cli` | `tsx ./node_modules/typeorm/cli.js` |
| `import:players` | `...ts-node ./src/data-import/import-players.ts` | `...tsx ./src/data-import/import-players.ts` |
| `cli` | `...ts-node -r tsconfig-paths/register ./node_modules/nestjs-command/bin/nestjs-command.js` | `...tsx ./node_modules/nestjs-command/bin/nestjs-command.js` |
| `cli-knowledge` | `...ts-node -r tsconfig-paths/register src/knowledge-sync/knowledge-sync-cli.ts` | `...tsx src/knowledge-sync/knowledge-sync-cli.ts` |

Remove `"ts-node": "^10.9.2"` from devDependencies (line 213).

### 4. Backend-v2: `nodemon.json`

```json
{ "exec": "tsx src/main.ts" }
```

### 5. Backend-v2: `nodemon-debug.json`

```json
{ "exec": "node --inspect-brk --import tsx src/main.ts" }
```

## Key Notes

- tsx is already a forced devDependency via Lisa root `package.lisa.json` — no new deps needed
- tsx handles tsconfig paths natively — `-r tsconfig-paths/register` not needed with tsx
- `--import tsx` is the ESM-compatible way to register tsx as a loader (replaces `-r ts-node/register`)
- `tsconfig-paths` package stays in backend-v2 (may be used by ts-jest, out of scope)

## Skills

- `/coding-philosophy`
- `/jsdoc-best-practices`
- `/git:commit`
- `/git:submit-pr`

## Task List

Create these tasks with TaskCreate:

### Task 1: Update Lisa NestJS template to remove ts-node

**subject**: Replace typeorm-ts-node-commonjs with tsx in NestJS template
**activeForm**: Replacing typeorm-ts-node-commonjs with tsx in NestJS template

**Type:** Bug

**Description:** ts-node doesn't support TypeScript 5.0+ array extends in tsconfig.json, breaking NestJS migration scripts. Replace `typeorm-ts-node-commonjs` with `tsx ./node_modules/typeorm/cli.js` in `nestjs/package-lisa/package.lisa.json` defaults.scripts, remove `ts-node` from force.devDependencies, and update typeorm-patterns skill documentation.

**Acceptance Criteria:**
- [ ] `nestjs/package-lisa/package.lisa.json` migration scripts use `tsx ./node_modules/typeorm/cli.js`
- [ ] `ts-node` removed from `nestjs/package-lisa/package.lisa.json` force.devDependencies
- [ ] `typeorm-patterns/references/configuration-patterns.md` updated

**Skills to Invoke:** `/coding-philosophy`

**Files to modify:**
- `nestjs/package-lisa/package.lisa.json`
- `nestjs/copy-overwrite/.claude/skills/typeorm-patterns/references/configuration-patterns.md`

**Verification:** `grep -c 'ts-node' nestjs/package-lisa/package.lisa.json` → `0`

**Metadata:** `{ "plan": "replicated-jumping-ladybug", "type": "bug", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "grep -c 'ts-node' nestjs/package-lisa/package.lisa.json", "expected": "0" } }`

---

### Task 2: Replace ts-node with tsx in backend-v2 (parallel with Task 1)

**subject**: Replace all ts-node usage with tsx in backend-v2
**activeForm**: Replacing all ts-node usage with tsx in backend-v2

**Type:** Bug

**Description:** Replace all 7 ts-node script references in package.json with tsx equivalents, update nodemon.json and nodemon-debug.json, and remove ts-node from devDependencies. Branch `fix/remove-ts-node-use-tsx` off `dev`.

**Acceptance Criteria:**
- [ ] All package.json scripts use tsx instead of ts-node
- [ ] nodemon.json uses `tsx src/main.ts`
- [ ] nodemon-debug.json uses `node --inspect-brk --import tsx src/main.ts`
- [ ] ts-node removed from devDependencies
- [ ] Lockfile updated

**Skills to Invoke:** `/coding-philosophy`

**Files to modify:**
- `/Users/cody/workspace/geminisportsai/backend-v2/package.json`
- `/Users/cody/workspace/geminisportsai/backend-v2/nodemon.json`
- `/Users/cody/workspace/geminisportsai/backend-v2/nodemon-debug.json`

**Verification:** `grep -c 'ts-node' /Users/cody/workspace/geminisportsai/backend-v2/package.json /Users/cody/workspace/geminisportsai/backend-v2/nodemon.json /Users/cody/workspace/geminisportsai/backend-v2/nodemon-debug.json` → `0` for all files

**Metadata:** `{ "plan": "replicated-jumping-ladybug", "type": "bug", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "grep -c 'ts-node' /Users/cody/workspace/geminisportsai/backend-v2/package.json /Users/cody/workspace/geminisportsai/backend-v2/nodemon.json /Users/cody/workspace/geminisportsai/backend-v2/nodemon-debug.json", "expected": "0 for all files" } }`

---

### Task 3: Verify Lisa builds and tests pass (blocked by Task 1)

**subject**: Verify Lisa typecheck, lint, and tests pass
**activeForm**: Verifying Lisa typecheck, lint, and tests pass

**Type:** Task

**Description:** Run `bun run typecheck && bun run lint && bun run test:unit` in Lisa to verify no regressions.

**Verification:** `bun run typecheck && bun run lint && bun run test:unit` → all pass

**Metadata:** `{ "plan": "replicated-jumping-ladybug", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "test", "command": "bun run typecheck && bun run lint && bun run test:unit", "expected": "All pass" } }`

---

### Task 4: Verify backend-v2 typecheck and lint pass (blocked by Task 2)

**subject**: Verify backend-v2 typecheck and lint pass
**activeForm**: Verifying backend-v2 typecheck and lint pass

**Type:** Task

**Description:** Run `bun run typecheck && bun run lint` in backend-v2 to verify no regressions. Cannot run full tests without database, but typecheck and lint confirm script changes are syntactically valid.

**Verification:** `cd /Users/cody/workspace/geminisportsai/backend-v2 && bun run typecheck && bun run lint` → all pass

**Metadata:** `{ "plan": "replicated-jumping-ladybug", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "cd /Users/cody/workspace/geminisportsai/backend-v2 && bun run typecheck && bun run lint", "expected": "All pass" } }`

---

### Task 5: Commit and open draft PRs (blocked by Tasks 3, 4)

**subject**: Commit changes and open draft PRs in both repos
**activeForm**: Committing changes and opening draft PRs

**Type:** Task

**Description:** Use `/git:commit` to create conventional commits in both repos. Open draft PR in Lisa (fix/tsconfig-local-override → main) and backend-v2 (fix/remove-ts-node-use-tsx → dev). Use `/git:submit-pr`.

**Acceptance Criteria:**
- [ ] Lisa PR opened as draft to main
- [ ] Backend-v2 PR opened as draft to dev

**Skills to Invoke:** `/git:commit`, `/git:submit-pr`

**Verification:** `gh pr list --head fix/tsconfig-local-override --json number,url` (Lisa) and `gh pr list --head fix/remove-ts-node-use-tsx --json number,url` (backend-v2) → both return PR info

**Metadata:** `{ "plan": "replicated-jumping-ladybug", "type": "task", "skills": ["/coding-philosophy", "/git:commit", "/git:submit-pr"], "verification": { "type": "manual-check", "command": "gh pr list --head fix/tsconfig-local-override --json number,url", "expected": "PR exists" } }`

---

### Task 6: CodeRabbit review (blocked by Task 5)

**subject**: Review code changes with CodeRabbit
**activeForm**: Reviewing code changes with CodeRabbit

**Type:** Task
**Description:** Run CodeRabbit review on changes in both repos.
**Skills to Invoke:** `/coderabbit:review`
**Metadata:** `{ "plan": "replicated-jumping-ladybug", "type": "task", "skills": ["/coderabbit:review"] }`

---

### Task 7: Local code review (parallel with Task 6, blocked by Task 5)

**subject**: Run local code review on changes
**activeForm**: Running local code review on changes

**Type:** Task
**Description:** Run `/plan-local-code-review` on changes in both repos.
**Skills to Invoke:** `/plan:local-code-review`
**Metadata:** `{ "plan": "replicated-jumping-ladybug", "type": "task", "skills": ["/plan:local-code-review"] }`

---

### Task 8: Implement valid review suggestions (blocked by Tasks 6, 7)

**subject**: Implement valid code review suggestions
**activeForm**: Implementing valid code review suggestions

**Type:** Task
**Description:** Review and implement valid suggestions from CodeRabbit and local code review.
**Skills to Invoke:** `/coding-philosophy`
**Metadata:** `{ "plan": "replicated-jumping-ladybug", "type": "task", "skills": ["/coding-philosophy"] }`

---

### Task 9: Simplify code (blocked by Task 8)

**subject**: Simplify implemented code with code-simplifier
**activeForm**: Simplifying implemented code

**Type:** Task
**Description:** Run code-simplifier agent on all modified files.
**Metadata:** `{ "plan": "replicated-jumping-ladybug", "type": "task", "skills": ["/coding-philosophy"] }`

---

### Task 10: Update tests (blocked by Task 8)

**subject**: Update tests referencing ts-node
**activeForm**: Updating tests referencing ts-node

**Type:** Task
**Description:** Search for any test files in both repos that reference ts-node and update them. Check jest configs for ts-node references.
**Verification:** `grep -r 'ts-node' --include='*.spec.ts' --include='*.test.ts' --include='jest.*' .` → no matches (run in both repos)
**Metadata:** `{ "plan": "replicated-jumping-ladybug", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "grep -r 'ts-node' --include='*.spec.ts' --include='*.test.ts' --include='jest.*' .", "expected": "No matches" } }`

---

### Task 11: Update documentation (blocked by Task 8)

**subject**: Update documentation referencing ts-node
**activeForm**: Updating documentation referencing ts-node

**Type:** Task
**Description:** Search for ts-node references in README.md, skill docs, and other markdown files in both repos. Update to reflect tsx as the standard TypeScript executor for NestJS projects.
**Skills to Invoke:** `/coding-philosophy`, `/jsdoc-best-practices`
**Verification:** `grep -r 'ts-node' --include='*.md' nestjs/` → no stale references (Lisa)
**Metadata:** `{ "plan": "replicated-jumping-ladybug", "type": "task", "skills": ["/coding-philosophy", "/jsdoc-best-practices"], "verification": { "type": "documentation", "command": "grep -r 'ts-node' --include='*.md' nestjs/", "expected": "No stale references" } }`

---

### Task 12: Verify all task verification metadata (blocked by Tasks 9, 10, 11)

**subject**: Verify all task verification commands pass
**activeForm**: Verifying all task verification commands pass

**Type:** Task
**Description:** Re-run every verification command from all tasks to confirm everything passes.
**Metadata:** `{ "plan": "replicated-jumping-ladybug", "type": "task", "skills": ["/coding-philosophy"] }`

---

### Task 13: Archive the plan (blocked by Task 12)

**subject**: Archive the plan and finalize PRs
**activeForm**: Archiving the plan and finalizing PRs

**Type:** Task

**Description:**
1. Create folder `remove-ts-node-nestjs` in `./plans/completed`
2. Rename `replicated-jumping-ladybug.md` to `remove-ts-node-from-nestjs-templates.md`
3. Move it into `./plans/completed/remove-ts-node-nestjs/`
4. Read session IDs from `./plans/completed/remove-ts-node-nestjs/remove-ts-node-from-nestjs-templates.md`
5. For each session ID, move `~/.claude/tasks/<session-id>` to `./plans/completed/remove-ts-node-nestjs/tasks`
6. Update any "in_progress" task in `./plans/completed/remove-ts-node-nestjs/tasks` to "completed"
7. Commit changes
8. Push all changes to the pull request
9. Change the pull request to ready for review
10. Set the pull request to auto merge

**Skills to Invoke:** `/git:commit`
**Metadata:** `{ "plan": "replicated-jumping-ladybug", "type": "task", "skills": ["/coding-philosophy", "/git:commit"] }`

## Task Dependencies

```
Task 1 (Lisa templates) ──────> Task 3 (Lisa verify) ──┐
                                                         ├─> Task 5 (commit/PR)
Task 2 (backend-v2 changes) ──> Task 4 (b-v2 verify) ──┘
                                        │
Task 5 ──┬──> Task 6 (CodeRabbit) ──┬──> Task 8 (implement suggestions)
         └──> Task 7 (local review) ─┘           │
                                          ┌──────┼──────┐
                                          v      v      v
                                      Task 9  Task 10  Task 11
                                          └──────┼──────┘
                                                 v
                                             Task 12 (verify all)
                                                 v
                                             Task 13 (archive)
```

Tasks 1 and 2 can run in parallel. Tasks 6 and 7 can run in parallel. Tasks 9, 10, and 11 can run in parallel.

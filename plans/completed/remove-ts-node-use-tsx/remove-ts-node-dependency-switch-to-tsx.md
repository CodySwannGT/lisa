# Remove ts-node Dependency and Switch CDK Projects to tsx

## Problem

Lisa 1.20.1 templates use **array `extends`** in `tsconfig.json` files (a TypeScript 5.0+ feature). **ts-node does not support array extends**, causing CDK synth to crash:

```
TypeError: value.replace is not a function
    at normalizeSlashes (ts-node/dist/util.js:62:18)
    at Object.getExtendsConfigPath (ts-node/dist/ts-internals.js:24:54)
```

**tsx** (already a Lisa forced dependency) **does support array extends** via esbuild. Lisa's own CDK template (`cdk/create-only/cdk.json`) already uses tsx. The fix is to remove ts-node from Lisa's forced dependencies and ensure downstream projects use tsx.

## Branch & PR

- **Branch**: `fix/tsconfig-local-override`
- **PR**: To be opened as draft against `main`

## Solution

Keep the array extends pattern (it's correct TypeScript 5.0+). Remove ts-node from Lisa's governance and let tsx handle TypeScript execution.

### Changes

#### 1. Remove ts-node from `package.lisa.json` forced devDependencies

- `package.lisa.json` (line 43): Remove `"ts-node": "^10.9.2"`
- `typescript/package-lisa/package.lisa.json` (line 43): Remove `"ts-node": "^10.9.2"`

#### 2. Add ts-node to NestJS package.lisa.json

NestJS still needs ts-node for `typeorm-ts-node-commonjs` migration scripts. Add `"ts-node": "^10.9.2"` to `nestjs/package-lisa/package.lisa.json` `force.devDependencies`.

#### 3. Remove ts-node from Lisa's own package.json

Lisa uses tsx for dev (`"dev": "tsx src/index.ts"`), not ts-node. Remove `ts-node` from Lisa's own `devDependencies` and run `bun install`.

#### 4. Fix infrastructure-v2's cdk.json (during integration test)

Change `"app"` from `"npx ts-node --prefer-ts-exts bin/infrastructure.ts"` to `"npx tsx bin/infrastructure.ts"` (matching Lisa's template). This is a project-specific fix since cdk.json is create-only.

### Files to Modify

| File | Change |
|------|--------|
| `package.lisa.json` | Remove `ts-node` from `force.devDependencies` |
| `typescript/package-lisa/package.lisa.json` | Remove `ts-node` from `force.devDependencies` |
| `nestjs/package-lisa/package.lisa.json` | Add `ts-node` to `force.devDependencies` |
| `package.json` | Remove `ts-node` from `devDependencies` |
| (infra-v2) `cdk.json` | Change `app` to use tsx |

### Reusable Code

No new functions needed. Template/config-only changes.

## Skills to Invoke

- `/coding-philosophy`
- `/git:commit`
- `/lisa:integration-test` (against infrastructure-v2)

## Task List

Create the following tasks using `TaskCreate`:

### Task 1: Remove ts-node from Lisa governance templates

**subject**: Remove ts-node from package.lisa.json forced dependencies
**activeForm**: Removing ts-node from package.lisa.json forced dependencies

**Description (markdown)**:

```
**Type:** Bug

**Description:** ts-node doesn't support TypeScript 5.0+ array extends in tsconfig.json, breaking CDK synth. Remove ts-node from forced devDependencies in root and typescript package.lisa.json. tsx (already forced) is the replacement.

**Acceptance Criteria:**
- [ ] `package.lisa.json` no longer has ts-node in force.devDependencies
- [ ] `typescript/package-lisa/package.lisa.json` no longer has ts-node in force.devDependencies

**Relevant Research:**
- `package.lisa.json:43` — `"ts-node": "^10.9.2"` in force.devDependencies
- `typescript/package-lisa/package.lisa.json:43` — `"ts-node": "^10.9.2"` in force.devDependencies
- tsx is already forced at `package.lisa.json:49` and `typescript/package-lisa/package.lisa.json:49`

**Skills to Invoke:** `/coding-philosophy`

**Implementation Details:**
- Remove line 43 (`"ts-node": "^10.9.2"`) from both files
- Keep tsx dependency unchanged

**Testing Requirements:** N/A (JSON config files)

**Verification:**
- Type: manual-check
- Command: `grep -r 'ts-node' package.lisa.json typescript/package-lisa/package.lisa.json`
- Expected: No matches
```

**Metadata:** `{ "plan": "linear-churning-key", "type": "bug", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "grep -r 'ts-node' package.lisa.json typescript/package-lisa/package.lisa.json", "expected": "No matches" } }`

### Task 2: Add ts-node to NestJS package.lisa.json

**subject**: Add ts-node to NestJS forced devDependencies
**activeForm**: Adding ts-node to NestJS forced devDependencies

**Description (markdown)**:

```
**Type:** Task

**Description:** NestJS needs ts-node for TypeORM migration scripts (`typeorm-ts-node-commonjs`). Since ts-node is being removed from the typescript stack, add it explicitly to the NestJS stack.

**Acceptance Criteria:**
- [ ] `nestjs/package-lisa/package.lisa.json` has `"ts-node": "^10.9.2"` in force.devDependencies

**Relevant Research:**
- `nestjs/package-lisa/package.lisa.json:4-6` — migration scripts use `typeorm-ts-node-commonjs`
- NestJS inherits from typescript stack, which will no longer force ts-node

**Skills to Invoke:** `/coding-philosophy`

**Implementation Details:**
- Add `"ts-node": "^10.9.2"` to `nestjs/package-lisa/package.lisa.json` under `force.devDependencies`

**Testing Requirements:** N/A (JSON config file)

**Verification:**
- Type: manual-check
- Command: `grep 'ts-node' nestjs/package-lisa/package.lisa.json`
- Expected: Shows `"ts-node": "^10.9.2"`
```

**Metadata:** `{ "plan": "linear-churning-key", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "grep 'ts-node' nestjs/package-lisa/package.lisa.json", "expected": "Shows ts-node entry" } }`

### Task 3: Remove ts-node from Lisa's own package.json

**subject**: Remove ts-node from Lisa's own devDependencies
**activeForm**: Removing ts-node from Lisa's own devDependencies

**Description (markdown)**:

```
**Type:** Task

**Description:** Lisa uses tsx for dev, not ts-node. Remove ts-node from Lisa's own package.json devDependencies and run `bun install` to update the lockfile.

**Acceptance Criteria:**
- [ ] `package.json` no longer lists ts-node in devDependencies
- [ ] `bun.lock` is updated
- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes
- [ ] `bun run test:unit` passes

**Relevant Research:**
- `package.json` devDependencies includes `"ts-node": "^10.9.2"`
- Lisa uses `"dev": "tsx src/index.ts"` — tsx, not ts-node
- ts-jest may have used ts-node but can work without it

**Skills to Invoke:** `/coding-philosophy`

**Implementation Details:**
- Remove `"ts-node"` line from package.json devDependencies
- Run `bun install`
- Run `bun run typecheck && bun run lint && bun run test:unit` to verify nothing breaks

**Testing Requirements:** Run existing test suite

**Verification:**
- Type: test
- Command: `bun run typecheck && bun run lint && bun run test:unit`
- Expected: All pass
```

**Metadata:** `{ "plan": "linear-churning-key", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "test", "command": "bun run typecheck && bun run lint && bun run test:unit", "expected": "All pass" } }`

### Task 4: Commit changes and open draft PR

**subject**: Commit template fixes and open draft PR
**activeForm**: Committing template fixes and opening draft PR

**Description (markdown)**:

```
**Type:** Task

**Description:** Commit all changes using `/git:commit` and open a draft PR against main using `/git:submit-pr`.

**Acceptance Criteria:**
- [ ] Changes committed with conventional commit message
- [ ] Draft PR opened against main

**Skills to Invoke:** `/coding-philosophy`, `/git:commit`, `/git:submit-pr`

**Verification:**
- Type: manual-check
- Command: `gh pr view --json state,url`
- Expected: PR exists in draft state
```

**Metadata:** `{ "plan": "linear-churning-key", "type": "task", "skills": ["/coding-philosophy", "/git:commit", "/git:submit-pr"], "verification": { "type": "manual-check", "command": "gh pr view --json state,url", "expected": "PR exists" } }`

### Task 5: Integration test against infrastructure-v2

**subject**: Run Lisa integration test against infrastructure-v2
**activeForm**: Running Lisa integration test against infrastructure-v2

**Description (markdown)**:

```
**Type:** Task

**Description:** Use `/lisa:integration-test` to apply the fixed Lisa templates to infrastructure-v2. During the test, also fix infrastructure-v2's `cdk.json` to use tsx instead of ts-node (`"app": "npx tsx bin/infrastructure.ts"`), since cdk.json is create-only and Lisa's template already recommends tsx. Verify typecheck, lint, and tests all pass.

**Acceptance Criteria:**
- [ ] Lisa applies cleanly to infrastructure-v2
- [ ] infrastructure-v2's cdk.json uses tsx (not ts-node)
- [ ] ts-node is no longer in infrastructure-v2's devDependencies
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes (27 tests)

**Relevant Research:**
- infrastructure-v2's cdk.json: `"app": "npx ts-node --prefer-ts-exts bin/infrastructure.ts"`
- Lisa's CDK template: `"app": "npx tsx bin/infrastructure.ts"`
- infrastructure-v2 already has tsx installed

**Skills to Invoke:** `/coding-philosophy`, `/lisa:integration-test`

**Implementation Details:**
- Run Lisa against infrastructure-v2
- Fix cdk.json app field (project-specific since create-only)
- Run `npm install` if package.json changed (ts-node removal)
- Verify all checks pass

**Testing Requirements:** Full integration test

**Verification:**
- Type: test
- Command: Run integration test and verify all checks pass
- Expected: typecheck, lint, tests all pass; cdk.json uses tsx
```

**Metadata:** `{ "plan": "linear-churning-key", "type": "task", "skills": ["/coding-philosophy", "/lisa:integration-test"], "verification": { "type": "test", "command": "run integration test against infrastructure-v2", "expected": "All checks pass" } }`

### Task 6: Review code with CodeRabbit

**subject**: Review code changes with CodeRabbit
**activeForm**: Reviewing code changes with CodeRabbit

**Description (markdown)**:

```
**Type:** Task
**Description:** Run CodeRabbit code review on the PR changes.
**Skills to Invoke:** `/coderabbit:review`
**Verification:**
- Type: manual-check
- Command: Review CodeRabbit output
- Expected: No critical issues
```

**Metadata:** `{ "plan": "linear-churning-key", "type": "task", "skills": ["/coderabbit:review"], "verification": { "type": "manual-check", "command": "review output", "expected": "No critical issues" } }`

### Task 7: Review code with local code review

**subject**: Review code changes with local code review
**activeForm**: Reviewing code changes with local code review

**Description (markdown)**:

```
**Type:** Task
**Description:** Run `/plan:local-code-review` on the branch changes.
**Skills to Invoke:** `/plan:local-code-review`
**Verification:**
- Type: manual-check
- Command: Review output
- Expected: No critical issues
```

**Metadata:** `{ "plan": "linear-churning-key", "type": "task", "skills": ["/plan:local-code-review"], "verification": { "type": "manual-check", "command": "review output", "expected": "No critical issues" } }`

### Task 8: Implement valid review suggestions

**subject**: Implement valid suggestions from code reviews
**activeForm**: Implementing valid suggestions from code reviews

**Description (markdown)**:

```
**Type:** Task
**Description:** Review findings from Tasks 6 and 7, implement valid suggestions.
**Skills to Invoke:** `/coding-philosophy`
**Verification:**
- Type: test
- Command: `bun run typecheck && bun run lint && bun run test:unit`
- Expected: All pass after implementing suggestions
```

**Metadata:** `{ "plan": "linear-churning-key", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "test", "command": "bun run typecheck && bun run lint && bun run test:unit", "expected": "All pass" } }`

### Task 9: Simplify code with code-simplifier agent

**subject**: Simplify implemented code with code-simplifier
**activeForm**: Simplifying implemented code

**Description (markdown)**:

```
**Type:** Task
**Description:** Run code-simplifier agent on recently modified files.
**Skills to Invoke:** `/coding-philosophy`
**Verification:**
- Type: test
- Command: `bun run typecheck && bun run lint`
- Expected: All pass
```

**Metadata:** `{ "plan": "linear-churning-key", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "test", "command": "bun run typecheck && bun run lint", "expected": "All pass" } }`

### Task 10: Update tests

**subject**: Update tests for ts-node removal
**activeForm**: Updating tests for ts-node removal

**Description (markdown)**:

```
**Type:** Task
**Description:** Check if any existing tests reference ts-node or depend on it. Update or remove as needed.
**Skills to Invoke:** `/coding-philosophy`
**Verification:**
- Type: test
- Command: `bun run test:unit`
- Expected: All pass
```

**Metadata:** `{ "plan": "linear-churning-key", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "test", "command": "bun run test:unit", "expected": "All pass" } }`

### Task 11: Update documentation

**subject**: Update documentation for ts-node removal
**activeForm**: Updating documentation for ts-node removal

**Description (markdown)**:

```
**Type:** Task
**Description:** Check README.md and other docs for ts-node references. Update to reflect tsx as the standard TypeScript executor. Note that NestJS projects retain ts-node for TypeORM migrations.
**Skills to Invoke:** `/coding-philosophy`, `/jsdoc-best-practices`
**Verification:**
- Type: documentation
- Command: `grep -r 'ts-node' README.md`
- Expected: No stale ts-node references (or accurately reflects NestJS exception)
```

**Metadata:** `{ "plan": "linear-churning-key", "type": "task", "skills": ["/coding-philosophy", "/jsdoc-best-practices"], "verification": { "type": "documentation", "command": "grep -r 'ts-node' README.md", "expected": "No stale references" } }`

### Task 12: Verify all task verifications

**subject**: Verify all task verification metadata
**activeForm**: Verifying all task verification metadata

**Description (markdown)**:

```
**Type:** Task
**Description:** Re-run the verification commands from all previous tasks to confirm everything still passes.
**Skills to Invoke:** `/coding-philosophy`
**Verification:**
- Type: manual-check
- Command: Run all verification commands from tasks 1-11
- Expected: All pass
```

**Metadata:** `{ "plan": "linear-churning-key", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "run all verifications", "expected": "All pass" } }`

### Task 13: Archive plan

**subject**: Archive the plan
**activeForm**: Archiving the plan

**Description (markdown)**:

```
**Type:** Task

**Description:**
1. Create folder `remove-ts-node-use-tsx` in `./plans/completed`
2. Rename `linear-churning-key.md` to `remove-ts-node-dependency-switch-to-tsx.md`
3. Move it into `./plans/completed/remove-ts-node-use-tsx/`
4. Read the session IDs from `./plans/completed/remove-ts-node-use-tsx/remove-ts-node-dependency-switch-to-tsx.md`
5. For each session ID, move `~/.claude/tasks/<session-id>` to `./plans/completed/remove-ts-node-use-tsx/tasks`
6. Update any "in_progress" task in `./plans/completed/remove-ts-node-use-tsx/tasks` to "completed"
7. Commit changes
8. Push changes to the PR

**Skills to Invoke:** `/coding-philosophy`, `/git:commit`

**Verification:**
- Type: manual-check
- Command: `ls ./plans/completed/remove-ts-node-use-tsx/`
- Expected: Plan file and tasks directory exist
```

**Metadata:** `{ "plan": "linear-churning-key", "type": "task", "skills": ["/coding-philosophy", "/git:commit"], "verification": { "type": "manual-check", "command": "ls ./plans/completed/remove-ts-node-use-tsx/", "expected": "Plan file and tasks directory exist" } }`

## Task Dependencies

- Tasks 1 & 2: Run in parallel (independent config changes)
- Task 3: Blocked by Tasks 1 & 2
- Task 4: Blocked by Task 3
- Task 5: Blocked by Task 4
- Tasks 6 & 7: Run in parallel, blocked by Task 5
- Task 8: Blocked by Tasks 6 & 7
- Tasks 9, 10, 11: Run in parallel, blocked by Task 8
- Task 12: Blocked by Tasks 9, 10 & 11
- Task 13: Blocked by Task 12

## Verification

End-to-end: After applying Lisa to infrastructure-v2 with tsx in cdk.json, CI/CD's `npx cdk synth --all --quiet` should succeed without the ts-node array extends crash.

## Sessions
| 3debad6e-0b3b-4ded-8fe5-30b6e0fe69d1 | 2026-02-04T04:03:42Z | plan |

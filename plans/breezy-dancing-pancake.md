# Plan: Add Claude Nightly Code Complexity Workflow

## Context

The nightly test coverage workflow incrementally raises Jest coverage thresholds by 5% per run toward 90%. We want an analogous workflow that incrementally **lowers** ESLint code complexity thresholds toward target minimums, allowing downstream projects to gradually improve code quality without massive one-shot refactoring.

**Metrics to target:**
- `cognitiveComplexity`: target **15**, decrement **2** per run (matches existing `plan-lower-code-complexity` skill)
- `maxLinesPerFunction`: target **30**, decrement **5** per run
- `maxLines`: **unchanged** (not targeted by this workflow)

## Files to Create/Modify

| Template (source of truth) | Lisa's own copy (must be identical) |
|---|---|
| `typescript/copy-overwrite/.github/workflows/claude-nightly-code-complexity.yml` (NEW) | `.github/workflows/claude-nightly-code-complexity.yml` |
| `typescript/copy-overwrite/.github/GITHUB_ACTIONS.md` (add docs) | `.github/GITHUB_ACTIONS.md` |
| `all/copy-overwrite/.claude/rules/lisa.md` (add to managed files) | `.claude/rules/lisa.md` |

## Workflow Design

### Trigger & Guards

- **Schedule**: `0 5 * * 1-5` (5 AM UTC weekdays, after test coverage at 4 AM)
- **Manual**: `workflow_dispatch`
- **Opt-in guard**: `vars.ENABLE_CLAUDE_NIGHTLY == 'true'`
- **Duplicate prevention**: Skip if open PR with branch prefix `claude/nightly-code-complexity-`

### Threshold Calculation Logic

Read `eslint.thresholds.json` and for each metric:
- `cognitiveComplexity`: if `value > 15`, propose `Math.max(value - 2, 15)`
- `maxLinesPerFunction`: if `value > 30`, propose `Math.max(value - 5, 30)`
- Skip missing keys gracefully (downstream project may not track all metrics)
- If no metrics need lowering, set `all_at_target = 'true'` and skip

**Example progression** (downstream project starting at cognitiveComplexity: 25, maxLinesPerFunction: 75):
```
Run 1: cognitiveComplexity 25 -> 23, maxLinesPerFunction 75 -> 70
Run 2: cognitiveComplexity 23 -> 21, maxLinesPerFunction 70 -> 65
...
Run 5: cognitiveComplexity 17 -> 15, maxLinesPerFunction 50 -> 45
Run 6: maxLinesPerFunction 45 -> 40  (complexity already at target)
...
Run 9: maxLinesPerFunction 30 -> done (all at target, skips)
```

### Claude Prompt Strategy

1. Read CLAUDE.md and package.json for project conventions
2. Update `eslint.thresholds.json` with proposed values (do NOT change `maxLines`)
3. Run `bun run lint` to find violations at new thresholds
4. For cognitive complexity violations: early returns, extract helpers, lookup tables
5. For max-lines-per-function violations: split functions, extract helpers, separate concerns
6. Run `bun run lint` + `bun run test` to verify
7. Commit and create PR

### Claude Action Config

- `branch_prefix: claude/nightly-code-complexity-`
- `--max-turns 30`
- `--allowedTools "Edit,MultiEdit,Write,Read,Glob,Grep,Bash(git:*),Bash(npm:*),Bash(npx:*),Bash(bun:*),Bash(yarn:*),Bash(pnpm:*),Bash(gh:*)"` (same as other nightly workflows)

## Documentation Updates

### GITHUB_ACTIONS.md

Add new section after "Claude Nightly Test Coverage" (line ~216), before "Load Testing":

```markdown
### Claude Nightly Code Complexity (`claude-nightly-code-complexity.yml`)

**Triggers**: Cron at 5 AM UTC weekdays, manual dispatch

**Opt-in**: Set repository variable `ENABLE_CLAUDE_NIGHTLY` to `true`

Incrementally lowers ESLint code complexity thresholds toward target minimums:

1. Reads `eslint.thresholds.json` to get current complexity thresholds
2. For `cognitiveComplexity` above 15, proposes a decrease of 2 (floored at 15)
3. For `maxLinesPerFunction` above 30, proposes a decrease of 5 (floored at 30)
4. Refactors functions to meet the stricter thresholds
5. Updates `eslint.thresholds.json` with the new values
6. Verifies lint and tests pass
7. Creates a PR summarizing which metrics were reduced

Does not modify the `maxLines` threshold. Skips if all metrics are at/below targets. Prevents duplicate PRs.
```

Also add `claude-nightly-code-complexity.yml` to the directory structure listing.

### lisa.md Managed Files

Append `, .github/workflows/claude-nightly-code-complexity.yml` to the workflow files line in the "Files and directories with NO local override" section.

## Implementation Steps

1. Create `typescript/copy-overwrite/.github/workflows/claude-nightly-code-complexity.yml`
2. Copy to `.github/workflows/claude-nightly-code-complexity.yml`
3. Update `typescript/copy-overwrite/.github/GITHUB_ACTIONS.md` (docs + directory listing)
4. Copy to `.github/GITHUB_ACTIONS.md`
5. Update `all/copy-overwrite/.claude/rules/lisa.md` managed files list
6. Copy to `.claude/rules/lisa.md`
7. Commit: `feat: add claude-nightly-code-complexity workflow for incremental threshold reduction`

## Verification

1. Validate YAML: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/claude-nightly-code-complexity.yml'))"`
2. Verify all 3 file pairs are identical: `diff` template vs Lisa's own copy
3. Verify managed files list includes new workflow: `grep "claude-nightly-code-complexity" .claude/rules/lisa.md`
4. Run `bun run lint` and `bun run test`
5. After merge: manual dispatch to verify threshold calculation outputs correct values

## Critical Files

- `typescript/copy-overwrite/.github/workflows/claude-nightly-test-coverage.yml` — primary pattern to follow
- `eslint.thresholds.json` — the threshold file the workflow reads/updates
- `eslint.base.ts` — shows how thresholds are consumed by ESLint rules (lines 155-179)
- `.claude/skills/plan-lower-code-complexity/SKILL.md` — existing skill for reference

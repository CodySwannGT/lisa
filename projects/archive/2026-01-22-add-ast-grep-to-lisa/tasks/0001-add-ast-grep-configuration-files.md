# Task: Add ast-grep Configuration Files

**Type:** Task
**Parent:** None

## Description

Create the ast-grep configuration file (sgconfig.yml) and directory structure following Lisa's inheritance pattern for TypeScript projects. The configuration should mirror the ESLint pattern where a base configuration is provided via `copy-overwrite` and projects can extend it.

## Acceptance Criteria

- [ ] `typescript/copy-overwrite/sgconfig.yml` exists with proper configuration
- [ ] `typescript/copy-overwrite/ast-grep/rules/.gitkeep` exists
- [ ] `typescript/copy-overwrite/ast-grep/rule-tests/.gitkeep` exists
- [ ] `typescript/copy-overwrite/ast-grep/utils/.gitkeep` exists
- [ ] Configuration points to the correct directories

## Relevant Research

From research.md:

**Reference sgconfig.yml pattern** (claude-code-safety-net):
```yaml
ruleDirs:
- ast-grep/rules
testConfigs:
- testDir: ast-grep/rule-tests
utilDirs:
- ast-grep/utils
```

**File Placement Strategy:**
| File | Strategy | Location |
|------|----------|----------|
| `sgconfig.yml` | `copy-overwrite` | `typescript/copy-overwrite/` |
| `ast-grep/rules/.gitkeep` | `copy-overwrite` | `typescript/copy-overwrite/` |
| `ast-grep/rule-tests/.gitkeep` | `copy-overwrite` | `typescript/copy-overwrite/` |
| `ast-grep/utils/.gitkeep` | `copy-overwrite` | `typescript/copy-overwrite/` |

**Answer from Q3**: Empty rules directory for now. Projects will define their own rules.

## Applicable Skills

Invoke these skills before writing implementation code:

- `/coding-philosophy` - Always required for all code

## Implementation Details

1. Create `typescript/copy-overwrite/sgconfig.yml`:
```yaml
ruleDirs:
  - ast-grep/rules
testConfigs:
  - testDir: ast-grep/rule-tests
utilDirs:
  - ast-grep/utils
```

2. Create directory structure with .gitkeep files:
   - `typescript/copy-overwrite/ast-grep/rules/.gitkeep`
   - `typescript/copy-overwrite/ast-grep/rule-tests/.gitkeep`
   - `typescript/copy-overwrite/ast-grep/utils/.gitkeep`

## Testing Requirements

### Unit Tests
N/A - Configuration files, no code to test

### Integration Tests
N/A - no integration points

### E2E Tests
N/A - no user-facing changes

## Documentation Requirements

### Code Documentation (JSDoc)
N/A - YAML configuration files

### Database Comments
N/A - no database changes

### GraphQL Descriptions
N/A - no GraphQL changes

## Verification

### Type
`manual-check`

### Proof Command
```bash
ls -la /Users/cody/workspace/lisa/typescript/copy-overwrite/sgconfig.yml /Users/cody/workspace/lisa/typescript/copy-overwrite/ast-grep/rules/.gitkeep /Users/cody/workspace/lisa/typescript/copy-overwrite/ast-grep/rule-tests/.gitkeep /Users/cody/workspace/lisa/typescript/copy-overwrite/ast-grep/utils/.gitkeep && cat /Users/cody/workspace/lisa/typescript/copy-overwrite/sgconfig.yml
```

### Expected Output
All four files should exist and sgconfig.yml should contain the proper YAML configuration with ruleDirs, testConfigs, and utilDirs.

## Implementation Steps

### Step 0: Setup Tracking
Use TodoWrite to create task tracking todos:
- Invoke skills
- Write failing tests
- Write implementation
- Verify implementation
- Update documentation
- Commit changes

### Step 1: Invoke Skills
Mark "Invoke skills" as in_progress.

1. Mark this task as "in progress" in `progress.md`
2. Invoke each skill listed in "Applicable Skills" using the Skill tool

Mark "Invoke skills" as completed.

### Step 2: Write Failing Tests
Mark "Write failing tests" as in_progress.

N/A - Configuration files only, no tests needed.

Mark "Write failing tests" as completed.

### Step 3: Write Implementation
Mark "Write implementation" as in_progress.

1. Create `typescript/copy-overwrite/sgconfig.yml` with the configuration
2. Create `typescript/copy-overwrite/ast-grep/` directory
3. Create `typescript/copy-overwrite/ast-grep/rules/.gitkeep`
4. Create `typescript/copy-overwrite/ast-grep/rule-tests/.gitkeep`
5. Create `typescript/copy-overwrite/ast-grep/utils/.gitkeep`

Mark "Write implementation" as completed.

### Step 4: Verify Implementation
Mark "Verify implementation" as in_progress.

1. Run the Proof Command from Verification section
2. Confirm output matches Expected Output
3. If verification fails, fix and re-verify

Mark "Verify implementation" as completed.

### Step 5: Update Documentation
Mark "Update documentation" as in_progress.

N/A - No documentation updates needed for this task.

Mark "Update documentation" as completed.

### Step 6: Commit Changes
Mark "Commit changes" as in_progress.

1. Run `/git:commit`
2. Mark this task as "completed" in `progress.md`
3. Record any learnings in `findings.md`

Mark "Commit changes" as completed.

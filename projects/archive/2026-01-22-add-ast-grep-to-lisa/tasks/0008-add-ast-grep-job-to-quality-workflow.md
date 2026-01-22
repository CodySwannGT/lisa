# Task: Add ast-grep Job to quality.yml Workflow

**Type:** Task
**Parent:** None

## Description

Add a new `sg_scan` job to the quality.yml GitHub Actions workflow. This job will run ast-grep scan as part of CI/CD quality checks, following the pattern of existing quality jobs. The job should check for sgconfig.yml existence and skip gracefully if not present.

## Acceptance Criteria

- [ ] `sg_scan` job is added to quality.yml workflow
- [ ] Job has `skip_sg_scan` input option for skipping
- [ ] Job checks for sgconfig.yml before running scan
- [ ] Job outputs warning if sgconfig.yml not found (skips gracefully)
- [ ] Job follows existing quality job patterns (checkout, setup node, install deps)
- [ ] Job is included in the required jobs list (if applicable)

## Relevant Research

From research.md:

**Quality workflow location:** `/Users/cody/workspace/lisa/.github/workflows/quality.yml`

Quality checks run as separate parallel jobs:
- lint, typecheck, test, format, build, dead_code, npm_security_scan, etc.

**Pattern for Adding New Quality Check:**
```yaml
ast_grep:
  name: <emoji> AST Grep Scan
  runs-on: ubuntu-latest
  timeout-minutes: 10
  if: ${{ !inputs.skip_ast_grep && !contains(inputs.skip_jobs, 'ast_grep') }}

  steps:
    - name: Checkout repository
      uses: actions/checkout@v4

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node_version }}

    - name: Install dependencies
      run: <package manager> install

    - name: Check for sgconfig.yml
      id: check_config
      run: |
        if [ -f "sgconfig.yml" ]; then
          echo "has_config=true" >> $GITHUB_OUTPUT
        else
          echo "has_config=false" >> $GITHUB_OUTPUT
        fi

    - name: Run ast-grep scan
      if: steps.check_config.outputs.has_config == 'true'
      run: ${{ inputs.package_manager }} run sg:scan

    - name: AST Grep Skipped (no config)
      if: steps.check_config.outputs.has_config != 'true'
      run: echo "::warning::ast-grep scan skipped - no sgconfig.yml found"
```

**Answer from Q4**: Skip input should be named `skip_sg_scan`

## Applicable Skills

Invoke these skills before writing implementation code:

- `/coding-philosophy` - Always required for all code
- `/jsdoc-best-practices` - For YAML comments explaining the job

## Implementation Details

1. Read the existing `/Users/cody/workspace/lisa/.github/workflows/quality.yml` file
2. Add `skip_sg_scan` to workflow_call inputs (following existing skip input patterns)
3. Add `sg_scan` job following the pattern from research
4. Place the job logically among other quality checks

The job should:
- Use `inputs.node_version` for Node.js setup
- Use `inputs.package_manager` for running the scan script
- Check for sgconfig.yml existence before scanning
- Output a warning (not error) if config is missing

Files to modify:
- `.github/workflows/quality.yml` (this is Lisa's own workflow, in the root)

Note: This modifies Lisa's own quality.yml, which serves as the template that gets copied to TypeScript projects.

## Testing Requirements

### Unit Tests
N/A - YAML workflow file

### Integration Tests
N/A - Tested via actual GitHub Actions runs

### E2E Tests
N/A - no user-facing changes

## Documentation Requirements

### Code Documentation (JSDoc)
N/A - YAML workflow file (use YAML comments)

### Database Comments
N/A - no database changes

### GraphQL Descriptions
N/A - no GraphQL changes

## Verification

### Type
`manual-check`

### Proof Command
```bash
grep -A30 'sg_scan:' /Users/cody/workspace/lisa/.github/workflows/quality.yml | head -35
```

### Expected Output
Should show the sg_scan job definition with checkout, node setup, install deps, config check, and conditional scan execution steps.

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

N/A - YAML workflow file, no unit tests needed.

Mark "Write failing tests" as completed.

### Step 3: Write Implementation
Mark "Write implementation" as in_progress.

1. Read `/Users/cody/workspace/lisa/.github/workflows/quality.yml`
2. Add `skip_sg_scan` input to workflow_call inputs
3. Add `sg_scan` job with all required steps

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

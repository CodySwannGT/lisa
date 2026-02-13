---
date: 2026-01-22T10:30:00-06:00
status: complete
last_updated: 2026-01-22
---

# Research

## Summary

This research documents the existing Lisa infrastructure patterns that will be used to add ast-grep support. The implementation will follow Lisa's established inheritance pattern for ESLint configurations, Claude hooks system, pre-commit integration via Husky/lint-staged, and quality.yml workflow patterns. The claude-code-safety-net project provides a reference implementation of ast-grep configuration that can be adapted.

## Detailed Findings

### 1. Lisa Inheritance Pattern for Configuration Files

Lisa uses a hierarchical project type system with cascading inheritance:

```
all/                    <- Applied to every project
|-- typescript/         <- TypeScript-specific
    |-- npm-package/    <- Publishable npm packages
    |-- expo/           <- Expo projects
    |-- nestjs/         <- NestJS projects
    |-- cdk/            <- CDK projects
```

**Configuration Files Location:** `/Users/cody/workspace/lisa/src/core/config.ts`

The project type hierarchy is defined in `PROJECT_TYPE_HIERARCHY`:
```typescript
export const PROJECT_TYPE_HIERARCHY: Readonly<
  Record<string, ProjectType | undefined>
> = {
  expo: "typescript",
  nestjs: "typescript",
  cdk: "typescript",
  "npm-package": "typescript",
  typescript: undefined,
} as const;
```

**Copy Strategies:**

| Directory | Purpose |
|-----------|---------|
| `copy-overwrite/` | Standard config files that should match Lisa's version |
| `copy-contents/` | Append missing lines (e.g., .gitignore) |
| `create-only/` | Template files created once, never overwritten |
| `merge/` | JSON deep merge for package.json |

### 2. ESLint Configuration Pattern (Model for ast-grep)

ESLint uses a multi-file inheritance pattern:

**Main Entry Point:** `typescript/copy-overwrite/eslint.config.ts`
```typescript
import { getTypescriptConfig } from "./eslint.typescript";
import localConfig from "./eslint.config.local.ts";

export default [
  ...getTypescriptConfig({ tsconfigRootDir, ignorePatterns, thresholds }),
  ...localConfig,
];
```

**Base Configuration:** `typescript/copy-overwrite/eslint.base.ts`
- Exports shared rules, plugins, and configuration helpers
- Defines `defaultIgnores` and `defaultThresholds`

**Project-Local Customizations:** `typescript/create-only/eslint.config.local.ts`
- Uses `create-only` strategy so projects can customize without overwrites
- Empty by default, allows project-specific rule additions

**Thresholds Configuration:** `typescript/create-only/eslint.thresholds.json`
- External JSON for configurable limits
- Allows projects to override defaults without touching config files

### 3. Claude Hooks System

**Hooks Location:** `typescript/copy-overwrite/.claude/hooks/`

**Existing Hooks:**
- `format-on-edit.sh` - Runs Prettier on edited files (PostToolUse)
- `lint-on-edit.sh` - Runs ESLint with --fix on edited files (PostToolUse)
- `install-pkgs.sh` - Ensures dependencies installed (SessionStart)
- `notify-ntfy.sh` - Notification integration (Notification, Stop)

**Settings Configuration:** `typescript/merge/.claude/settings.json`
```json
{
  "hooks": {
    "SessionStart": [{"matcher": "startup", "hooks": [...]}],
    "PostToolUse": [{"matcher": "Write|Edit", "hooks": [...]}]
  }
}
```

**Hook Pattern (lint-on-edit.sh):**
1. Read JSON input from stdin
2. Extract file path from tool_input
3. Validate file exists and has supported extension
4. Check file is in lintable directory (src/, apps/, libs/, test/, etc.)
5. Detect package manager from lock file
6. Run linter with --fix flag
7. Exit 0 always to not interrupt Claude's workflow

### 4. Pre-commit Integration (Husky/lint-staged)

**Pre-commit Hook:** `typescript/copy-contents/.husky/pre-commit`

Current pre-commit flow:
1. Detect package manager (bun > yarn > npm)
2. Check branch protection (prevent direct commits to dev/staging/main)
3. Run Gitleaks secret detection
4. Run typecheck (`$RUNNER typecheck`)
5. Run lint-staged (`$EXECUTOR lint-staged --config .lintstagedrc.json`)

**lint-staged Configuration:** `typescript/copy-overwrite/.lintstagedrc.json`
```json
{
  "*.{js,mjs,ts,tsx}": ["eslint --quiet --cache --fix"],
  "*.{json,mjs,js,ts,jsx,tsx,html,md,mdx,css,scss,yaml,yml,graphql}": ["prettier --write"]
}
```

The lint-staged config uses `copy-overwrite` strategy because it should match Lisa's patterns.

### 5. Reference Implementation: claude-code-safety-net ast-grep Setup

**sgconfig.yml:** `/Users/cody/workspace/claude-code-safety-net/sgconfig.yml`
```yaml
ruleDirs:
- ast-grep/rules
testConfigs:
- testDir: ast-grep/rule-tests
utilDirs:
- ast-grep/utils
```

**Directory Structure:**
```
ast-grep/
|-- rules/           <- Rule YAML files
|   |-- .gitkeep
|   |-- no-dynamic-import.yml
|-- rule-tests/      <- Test cases for rules
|   |-- no-dynamic-import.yml
|-- utils/           <- Shared utility rules
    |-- .gitkeep
```

**Example Rule:** `ast-grep/rules/no-dynamic-import.yml`
```yaml
id: no-dynamic-import
language: typescript
rule:
  pattern: await import($PATH)
message: "Dynamic import() is not allowed. Use static imports at the top of the file instead."
severity: error
```

**Test Case Format:** `ast-grep/rule-tests/no-dynamic-import.yml`
```yaml
id: no-dynamic-import
valid:
  - "import { foo } from 'bar'"
  - "import * as foo from 'bar'"
invalid:
  - "await import('bar')"
  - "const foo = await import('bar')"
```

**Package.json Integration:**
```json
{
  "scripts": {
    "sg:scan": "ast-grep scan"
  },
  "devDependencies": {
    "@ast-grep/cli": "^0.40.4"
  },
  "trustedDependencies": ["@ast-grep/cli"]
}
```

**lint-staged Integration:**
```json
{
  "*.{js,ts,cjs,mjs,d.cts,d.mts,json,jsonc}": [
    "biome check --write --no-errors-on-unmatched",
    "ast-grep scan"
  ]
}
```

### 6. quality.yml Workflow Pattern

**Location:** `/Users/cody/workspace/lisa/.github/workflows/quality.yml`

Quality checks run as separate parallel jobs:
- lint
- typecheck
- test
- format
- build
- dead_code (knip)
- npm_security_scan
- sonarcloud, snyk, secret_scanning, license_compliance

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

## Code References

- `/Users/cody/workspace/lisa/src/core/config.ts` - Project type hierarchy and copy strategies
- `/Users/cody/workspace/lisa/src/detection/index.ts` - Detector registry pattern
- `/Users/cody/workspace/lisa/src/detection/detectors/typescript.ts` - Example detector implementation
- `/Users/cody/workspace/lisa/typescript/copy-overwrite/eslint.config.ts` - ESLint main entry point
- `/Users/cody/workspace/lisa/typescript/copy-overwrite/eslint.base.ts` - ESLint base configuration
- `/Users/cody/workspace/lisa/typescript/create-only/eslint.config.local.ts` - Local customization template
- `/Users/cody/workspace/lisa/typescript/copy-overwrite/.claude/hooks/lint-on-edit.sh` - Claude hook example
- `/Users/cody/workspace/lisa/typescript/merge/.claude/settings.json` - Hook registration
- `/Users/cody/workspace/lisa/typescript/copy-contents/.husky/pre-commit` - Pre-commit hook
- `/Users/cody/workspace/lisa/typescript/copy-overwrite/.lintstagedrc.json` - lint-staged config
- `/Users/cody/workspace/lisa/.github/workflows/quality.yml` - Quality workflow template
- `/Users/cody/workspace/claude-code-safety-net/sgconfig.yml` - Reference ast-grep config
- `/Users/cody/workspace/claude-code-safety-net/ast-grep/rules/no-dynamic-import.yml` - Reference rule
- `/Users/cody/workspace/claude-code-safety-net/.lintstagedrc.json` - lint-staged with ast-grep

## Architecture Documentation

### File Placement Strategy

Based on the ESLint pattern, ast-grep configuration should be placed as follows:

| File | Strategy | Location | Purpose |
|------|----------|----------|---------|
| `sgconfig.yml` | `copy-overwrite` | `typescript/copy-overwrite/` | Main config pointing to rule directories |
| `ast-grep/rules/.gitkeep` | `copy-overwrite` | `typescript/copy-overwrite/` | Empty rules directory for inheritance |
| `ast-grep/rule-tests/.gitkeep` | `copy-overwrite` | `typescript/copy-overwrite/` | Empty tests directory |
| `ast-grep/utils/.gitkeep` | `copy-overwrite` | `typescript/copy-overwrite/` | Empty utils directory |
| `ast-grep.local.yml` or similar | `create-only` | `typescript/create-only/` | Project-specific rules (optional) |

### Package Manager Detection

Both hooks and pre-commit use the same detection pattern:
```bash
if ([ -f "bun.lockb" ] || [ -f "bun.lock" ]) && command -v bun >/dev/null 2>&1; then
  PACKAGE_MANAGER="bun"
elif [ -f "yarn.lock" ] && command -v yarn >/dev/null 2>&1; then
  PACKAGE_MANAGER="yarn"
elif [ -f "package-lock.json" ]; then
  PACKAGE_MANAGER="npm"
else
  PACKAGE_MANAGER="npm"
fi
```

## Testing Patterns

### Unit Test Patterns
- **Location**: `tests/unit/**/*.test.ts`
- **Framework**: Vitest
- **Example to follow**: `/Users/cody/workspace/lisa/tests/unit/detection/detectors.test.ts`
- **Conventions**:
  - Use `beforeEach`/`afterEach` for setup/teardown
  - Create temp directories with `createTempDir()` helper
  - Clean up with `cleanupTempDir()` helper
  - Test files named `*.test.ts`

### Test Helpers
- **Location**: `tests/helpers/test-utils.ts`
- **Available helpers**:
  - `createTempDir()` - Create isolated test directory
  - `cleanupTempDir(dir)` - Clean up test directory
  - `createMinimalProject(dir)` - Create basic package.json
  - `createTypeScriptProject(dir)` - Create TS project structure
  - `createMockLisaDir(dir)` - Create mock Lisa config structure

## Documentation Patterns

### JSDoc Conventions
- **Style**: TypeDoc-compatible JSDoc
- **Required tags**: `@param`, `@returns`
- **Example**: `/Users/cody/workspace/lisa/src/detection/detectors/typescript.ts`

```typescript
/**
 * Detector for TypeScript projects
 * Detects by presence of tsconfig.json or typescript dependency
 */
export class TypeScriptDetector implements IProjectTypeDetector {
  /**
   * Detect if the project uses TypeScript
   * @param destDir - Project directory to check
   * @returns True if TypeScript is detected
   */
  async detect(destDir: string): Promise<boolean> { ... }
}
```

## Open Questions

### Q1: ast-grep Package Addition Method
**Question**: Should `@ast-grep/cli` be added to the `typescript/merge/package.json` devDependencies, or should it be a separate concern?
**Context**: The brief mentions following the ESLint inheritance pattern. ESLint is in merge/package.json. However, ast-grep might not be needed for all TypeScript projects.
**Impact**: Affects whether ast-grep is installed automatically for all TypeScript projects or requires opt-in.
**Answer**: Add to `typescript/merge/package.json` for all TypeScript projects automatically.

### Q2: Claude Hook Blocking vs Non-blocking
**Question**: Should the ast-grep Claude hook block (fail) on scan errors, or should it always exit 0 like the existing lint hook?
**Context**: The lint-on-edit.sh hook always exits 0 to "not interrupt Claude's workflow". However, ast-grep might catch more critical issues that should block.
**Impact**: Determines the hook script behavior and user experience during Claude sessions.
**Answer**: Blocking. The hook should give Claude feedback so it has to fix the error.

### Q3: Base Rules to Include
**Question**: Should Lisa ship with any default ast-grep rules in the `typescript/copy-overwrite/ast-grep/rules/` directory, or start with an empty rules directory?
**Context**: The reference implementation (claude-code-safety-net) has a `no-dynamic-import` rule. Starting empty follows the pattern of eslint.config.local.ts being empty.
**Impact**: Determines whether projects get immediate value from ast-grep or need to define their own rules.
**Answer**: Empty rules directory for now. Projects will define their own rules.

### Q4: Quality Workflow Skip Input Naming
**Question**: What should the skip input be named: `skip_ast_grep`, `skip_sg_scan`, or something else?
**Context**: Existing inputs use patterns like `skip_lint`, `skip_typecheck`, `skip_dead_code`. Need consistency.
**Impact**: Affects the workflow_call input interface.
**Answer**: `skip_sg_scan`

## External References

- [ast-grep sgconfig.yml Reference](https://ast-grep.github.io/reference/sgconfig.html)
- [ast-grep YAML Rule Configuration](https://ast-grep.github.io/reference/yaml.html)
- [ast-grep Scan Your Project Guide](https://ast-grep.github.io/guide/scan-project.html)

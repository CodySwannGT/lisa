# Lisa

Lisa is a **Claude Code governance framework** that ensures Claude produces high-quality, consistent code through multiple layers of guardrails, guidance, and automated enforcement.

## Why Lisa Exists

Claude Code is powerful, but without guardrails it can:
- Produce inconsistent code styles across sessions
- Skip tests or quality checks when not reminded
- Over-engineer solutions or create unnecessary abstractions
- Mutate data instead of using immutable patterns
- Leave deprecated code instead of cleanly deleting it

Lisa solves this by applying a comprehensive governance system that guides Claude's behavior at every step.

**The key insight:** Not every developer needs to be an AI expert. Platform teams with deep AI knowledge can encode best practices into Lisa, and implementation teams get the benefits automatically through simple commands.

## How It Works

Lisa applies multiple layers of quality control to your project:

| Layer | Purpose | Examples |
|-------|---------|----------|
| **CLAUDE.md** | Direct behavioral rules | "Never skip tests", "Always use immutable patterns" |
| **Skills** | Teach patterns & philosophy | Immutability, TDD, YAGNI/SOLID/DRY/KISS |
| **Hooks** | Auto-enforcement on every edit | Format and lint after Write/Edit operations |
| **Slash Commands** | Guided workflows | `/project:implement`, `/project:review`, `/git:commit` |
| **Custom ESLint Plugins** | Enforce code structure | Statement ordering, component structure |
| **Thresholds** | Configurable limits | Max complexity, max file length |
| **Git Hooks** | Pre-commit quality gates | Husky + lint-staged + commitlint |
| **Agents** | Specialized sub-agents | Codebase analysis, pattern finding |

These layers work together. When Claude writes code:
1. **CLAUDE.md** tells it what patterns to follow
2. **Skills** teach it the philosophy behind those patterns
3. **Hooks** automatically format and lint the code
4. **ESLint plugins** catch structural violations
5. **Git hooks** prevent commits that fail quality checks

## Team & Organization Usage

Lisa is designed for a **two-tier organizational model** that separates AI expertise from day-to-day development:

```
┌─────────────────────────────────────────────────────────────┐
│                      PLATFORM TEAM                          │
│                                                             │
│  • Deep AI/LLM expertise (prompting, context engineering)  │
│  • Domain knowledge of coding standards & best practices    │
│  • Maintains and iterates on Lisa configurations           │
│  • Writes skills, hooks, ESLint rules, slash commands      │
│  • Tests guardrails against real-world edge cases          │
│                                                             │
│                         │                                   │
│                         ▼                                   │
│                   Lisa Repository                           │
│                         │                                   │
│                         ▼                                   │
├─────────────────────────────────────────────────────────────┤
│                   IMPLEMENTATION TEAMS                      │
│                                                             │
│  • Focus on building end-user software                      │
│  • Run `lisa.sh` to bootstrap projects                      │
│  • Use simple commands like `/project:implement`            │
│  • Don't need deep AI expertise                             │
│  • Automatically get guardrails & quality enforcement       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Why This Model Works

**For Platform Teams:**
- Centralize AI governance expertise in one place
- Iterate on prompts, skills, and guardrails based on real feedback
- A/B test different approaches across the organization
- Push improvements to all teams instantly via Lisa updates

**For Implementation Teams:**
- No need to learn prompt engineering or context engineering
- Simple commands produce high-quality, consistent code
- Guardrails prevent common mistakes automatically
- Focus on business logic, not AI wrangling

### How Implementation Teams Work

Once Lisa is applied to a project, developers have two paths:

**Path 1: Just Type a Prompt**

Even if a developer just types a vague request, Lisa's built-in `prompt-complexity-scorer` skill automatically evaluates it:

```
Developer: "Make the app faster"

Claude: This request scores 8/10 on complexity. I suggest writing it
        as a spec to plan it out properly.

        Would you like me to create `specs/performance-optimization.md`?
```

Complex or vague prompts (score 5+) are automatically routed to the spec workflow. Simple, well-defined requests (score 1-4) proceed immediately. Developers don't need to know which path to take—Lisa routes them automatically.

**Path 2: The Full Workflow**

For planned work, the workflow is two commands:

```bash
# 1. Create a spec file describing what you want
#    (or let Claude create it from your prompt)
echo "Add user authentication with OAuth" > specs/add-auth.md

# 2. Bootstrap: research, analyze, identify gaps
/project:bootstrap @specs/add-auth.md

# 3. Execute: plan tasks, implement with TDD, verify completion
/project:execute @projects/add-auth
```

That's it. Behind the scenes, Lisa ensures:
- Comprehensive codebase and web research
- Knowledge gap detection (stops if questions need answering)
- Task breakdown and TDD implementation
- Verification that all tasks completed
- New patterns captured in `PROJECT_RULES.md`

### Platform Team Iteration Example

1. **Platform Team** discovers Claude sometimes creates overly complex functions
2. **Platform Team** adds a `cognitiveComplexity: 10` threshold to ESLint config
3. **Platform Team** writes a skill teaching Claude to decompose complex logic
4. **Platform Team** pushes update to Lisa repository
5. **Implementation Teams** run `lisa.sh` on their projects (or it happens via CI)
6. **Implementation Teams** now automatically get simpler, more maintainable code

### Forking for Your Organization

```bash
# Fork Lisa for your organization
gh repo fork CodySwannGT/lisa --org your-org --clone

# Customize configurations
cd lisa
# Edit skills, hooks, CLAUDE.md, ESLint rules, etc.

# Push to your org's fork
git push origin main
```

Implementation teams then clone from your organization's fork:

```bash
git clone https://github.com/your-org/lisa ~/lisa
~/lisa/lisa.sh /path/to/project
```

## Installation

Clone the Lisa repository to your machine:

```bash
git clone <lisa-repo-url> ~/lisa
cd ~/lisa
npm install
npm run build
```

### Requirements

- **Node.js 18+**
- **npm** or **bun**

## Usage

Run Lisa against any project directory:

```bash
~/lisa/lisa.sh /path/to/your-project

# Or from within your project
~/lisa/lisa.sh .
```

### Options

| Option | Description |
|--------|-------------|
| `-n, --dry-run` | Show what would be done without making changes |
| `-y, --yes` | Non-interactive mode (auto-accept defaults, overwrite on conflict) |
| `-v, --validate` | Validate project compatibility without applying changes |
| `-u, --uninstall` | Remove Lisa-managed files from the project |
| `-h, --help` | Show help message |

### Dry Run

Preview changes before applying them:

```bash
~/lisa/lisa.sh --dry-run /path/to/your-project
```

### CI/CD Usage

For automated pipelines, use non-interactive mode:

```bash
~/lisa/lisa.sh --yes /path/to/project
```

### Validate Mode

Check project compatibility without making changes:

```bash
~/lisa/lisa.sh --validate /path/to/project
```

### Uninstall

Remove Lisa-managed files from a project:

```bash
~/lisa/lisa.sh --uninstall /path/to/project

# Preview what would be removed
~/lisa/lisa.sh --dry-run --uninstall /path/to/project
```

Note: Files applied with `copy-contents` or `merge` strategies require manual cleanup as they modify existing content.

## What Lisa Applies

### CLAUDE.md - Behavioral Rules

Direct instructions for Claude Code:

```markdown
Always invoke /coding-philosophy skill to enforce immutable patterns
Always make atomic commits with clear conventional messages
Never skip or disable any tests or quality checks
Never use --no-verify with git commands
Never create TODOs or placeholders
```

### Skills - Teaching Philosophy

Skills teach Claude the "why" behind coding decisions:

- **coding-philosophy** - Immutability, function structure, TDD, clean deletion
- **jsdoc-best-practices** - Documentation that explains "why" not "what"
- **container-view-pattern** - Component architecture for React/Expo

### Hooks - Automated Enforcement

Hooks run automatically during Claude Code sessions:

| Hook | Trigger | Action |
|------|---------|--------|
| `format-on-edit.sh` | After Write/Edit | Run Prettier on changed files |
| `lint-on-edit.sh` | After Write/Edit | Run ESLint on changed files |
| `install_pkgs.sh` | Session start | Ensure dependencies installed |
| `notify-ntfy.sh` | Permission prompt/Stop | Send notifications |

**Async Workflow:** Lisa includes built-in [ntfy.sh](https://ntfy.sh) integration for push notifications. This enables a powerful async workflow with Claude Code Web - fire off tasks and get notified when they complete or need attention. See [Claude Code Web + Notifications](docs/workflows/claude-code-web-notifications.md) for setup instructions.

### Slash Commands - Guided Workflows

Pre-built workflows for common tasks:

| Command | Purpose |
|---------|---------|
| `/project:plan` | Create implementation plan |
| `/project:implement` | Execute all planned tasks |
| `/project:review` | Run code review |
| `/project:verify` | Run all quality checks |
| `/git:commit` | Create conventional commit |
| `/git:submit-pr` | Create pull request |

### Custom ESLint Plugins

Lisa includes custom ESLint plugins that enforce code structure:

**eslint-plugin-code-organization**
- `enforce-statement-order` - Definitions → Side effects → Return

**eslint-plugin-component-structure** (Expo)
- `single-component-per-file` - One component per file
- `require-memo-in-view` - Memoization in view components
- `no-inline-styles` - Extract styles to StyleSheet

### Thresholds

Configurable limits in `eslint.thresholds.config.json`:

```json
{
  "cognitiveComplexity": 10,
  "maxLines": 300,
  "maxLinesView": 300
}
```

## Project Type Detection

Lisa auto-detects project types and applies appropriate configurations:

| Type | Detection |
|------|-----------|
| TypeScript | `tsconfig.json` or `"typescript"` in package.json |
| npm-package | Not `"private": true` and has `main`, `bin`, `exports`, or `files` |
| Expo | `app.json`, `eas.json`, or `"expo"` in package.json |
| NestJS | `nest-cli.json` or `"@nestjs"` in package.json |
| CDK | `cdk.json` or `"aws-cdk"` in package.json |

### Cascading Inheritance

Types inherit from their parents:

```
all/                    ← Applied to every project
└── typescript/         ← TypeScript-specific
    ├── npm-package/    ← Publishable npm packages (includes typescript)
    ├── expo/           ← Expo (includes typescript)
    ├── nestjs/         ← NestJS (includes typescript)
    └── cdk/            ← CDK (includes typescript)
```

An Expo project receives configs from: `all/` → `typescript/` → `expo/`

An npm package receives configs from: `all/` → `typescript/` → `npm-package/`

### Why Stack-Specific Rules Matter

**Generic AI rules don't work.** Each technology stack has its own:
- Architectural patterns (NestJS modules vs. Expo screens vs. CDK constructs)
- Testing approaches (Jest + Testing Library vs. Supertest vs. CDK assertions)
- File organization conventions
- Performance pitfalls
- Security considerations

When Claude writes code without stack-specific guidance, it produces "generic" solutions that miss the idioms and best practices of your stack. For example:

| Stack | Generic AI Output | With Lisa Stack Rules |
|-------|-------------------|----------------------|
| **Expo** | Inline styles, direct RN imports | Uses design system, container/view pattern |
| **NestJS** | Mixed concerns in controllers | Proper service/repository separation |
| **CDK** | Hardcoded values, no constructs | Parameterized, reusable L3 constructs |

The more specific the guidance, the better the output. That's why Lisa is structured around project types rather than one-size-fits-all rules.

### npm Package Publishing

Projects detected as `npm-package` automatically receive a GitHub Actions workflow for publishing to npm. This workflow:

1. Triggers on push to `main`
2. Runs semantic versioning via `release.yml`
3. Publishes to npm with `npm publish --access public`

**Required Setup:**

Add an `NPM_TOKEN` secret to your GitHub repository:

1. Generate a token at [npmjs.com](https://www.npmjs.com/) → Access Tokens → Generate New Token (Automation)
2. Go to your GitHub repo → Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Name: `NPM_TOKEN`, Value: your npm token

If `NPM_TOKEN` is not set, the workflow will skip publishing and log a message.

### Extending Lisa for Other Stacks

Lisa currently supports TypeScript, npm-package, Expo, NestJS, and CDK—but the architecture is designed for extension. **We're calling on the community to contribute stack-specific configurations.**

**Stacks that would benefit from Lisa extensions:**

| Stack | Potential Rules |
|-------|-----------------|
| **Next.js** | App Router patterns, Server Components vs. Client, caching strategies |
| **React Native (non-Expo)** | Native module patterns, platform-specific code |
| **Django** | Model/View/Template separation, ORM patterns, admin customization |
| **FastAPI** | Dependency injection, Pydantic models, async patterns |
| **Spring Boot** | Bean lifecycle, annotation patterns, JPA repositories |
| **Laravel** | Eloquent patterns, Blade templates, queue workers |
| **Rails** | Convention over configuration, concerns, ActiveRecord |
| **Go (Gin/Echo)** | Error handling, middleware patterns, struct design |
| **Rust (Axum/Actix)** | Ownership patterns, error types, async runtime |
| **Flutter** | Widget composition, BLoC pattern, platform channels |
| **Vue/Nuxt** | Composition API, Pinia stores, auto-imports |
| **Svelte/SvelteKit** | Reactive statements, load functions, form actions |
| **Terraform** | Module structure, state management, provider patterns |
| **Kubernetes** | Helm charts, operator patterns, RBAC |

**To contribute a new stack:**

1. Create a new detector in `src/detection/detectors/`
2. Register the detector in `src/detection/index.ts`
3. Add the config directory structure:

```bash
# Create the stack directory
mkdir -p your-stack/{copy-overwrite,merge}

# Add stack-specific skills
mkdir -p your-stack/copy-overwrite/.claude/skills/your-pattern
cat > your-stack/copy-overwrite/.claude/skills/your-pattern/SKILL.md << 'EOF'
---
name: your-pattern
description: Teaches Claude the idioms of your stack
---
# Your Pattern
...
EOF

# Add stack-specific ESLint rules
mkdir -p your-stack/copy-overwrite/eslint-plugin-your-stack

# Add package.json dependencies via merge/
```

See the `expo/` directory for a comprehensive example of stack-specific configuration.

**Example prompts to bootstrap a new stack with Claude:**

Use these prompts in Claude Code (with Lisa applied) to generate stack configurations:

```
Research Rails best practices and create a Lisa configuration for Ruby on Rails projects.
Look at the expo/ directory as a reference for structure. Include:
- Detection logic as a new detector in src/detection/detectors/
- Skills for Rails conventions (MVC, ActiveRecord patterns, concerns)
- ESLint equivalent rules using RuboCop (create a rubocop config, not an ESLint plugin)
- Common .gitignore entries for Rails projects
```

```
Create a Lisa configuration for Flutter projects. Reference expo/ for structure.
Include:
- Detection logic (pubspec.yaml with flutter dependency)
- Skills for widget composition, BLoC/Riverpod patterns, platform channels
- Dart analyzer rules (analysis_options.yaml instead of ESLint)
- Flutter-specific .gitignore entries
```

```
Add Next.js support to Lisa. This should be a child of typescript/ (like expo is).
Include:
- Detection logic (next.config.js or "next" in package.json)
- Skills for App Router patterns, Server vs Client Components, caching
- ESLint rules for Next.js idioms (or extend next/core-web-vitals)
- Typical Next.js scripts in package.json
```

```
Analyze the expo/ directory structure and create equivalent configuration for Django.
Include:
- Detection logic (manage.py, settings.py, or django in requirements.txt)
- Skills for MVT pattern, ORM best practices, admin customization
- Linting via flake8/ruff config (not ESLint)
- Django-specific .gitignore entries
```

## Copy Strategies

Each type directory contains subdirectories that control how files are applied:

| Strategy | Dest doesn't exist | Dest identical | Dest differs |
|----------|-------------------|----------------|--------------|
| `copy-overwrite/` | Copy | Skip | Prompt (overwrite/skip) |
| `copy-contents/` | Copy | Skip | Append missing lines |
| `create-only/` | Copy | Skip | Skip |
| `merge/` | Copy | Skip | JSON deep merge |

### Strategy Details

**copy-overwrite**: Standard config files that should match Lisa's version. Prompts when local changes exist.

**copy-contents**: For files like `.gitignore` where you want to ensure certain lines exist without removing custom entries.

**create-only**: Template files that should only be created once (e.g., `PROJECT_RULES.md` for project-specific customization).

**merge**: For `package.json` files. Performs a deep merge where:
- Lisa provides default values
- Your project's values take precedence
- Missing scripts/dependencies are added without overwriting existing ones

## Architecture

Lisa is written in TypeScript with the following structure:

```
lisa/
├── src/
│   ├── index.ts                    # CLI entry point
│   ├── cli/
│   │   ├── index.ts                # Commander setup
│   │   └── prompts.ts              # Interactive prompts
│   ├── core/
│   │   ├── lisa.ts                 # Main orchestrator
│   │   ├── config.ts               # Types and configuration
│   │   └── manifest.ts             # Manifest operations
│   ├── detection/
│   │   ├── index.ts                # Detector registry
│   │   └── detectors/              # Project type detectors
│   ├── strategies/
│   │   ├── index.ts                # Strategy registry
│   │   ├── copy-overwrite.ts
│   │   ├── copy-contents.ts
│   │   ├── create-only.ts
│   │   └── merge.ts
│   ├── transaction/
│   │   ├── backup.ts               # Backup/restore
│   │   └── transaction.ts          # Atomic wrapper
│   ├── logging/                    # Console logger
│   ├── errors/                     # Custom error types
│   └── utils/                      # File and JSON utilities
├── all/                            # Applied to all projects
├── typescript/                     # TypeScript projects
├── npm-package/                    # Publishable npm packages
├── expo/                           # Expo projects
├── nestjs/                         # NestJS projects
├── cdk/                            # CDK projects
├── tests/                          # Vitest test suite
├── lisa.sh                         # Wrapper script
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Coding Philosophy

Lisa enforces a consistent coding philosophy through skills and linting:

### Core Principles

1. **Immutability First** - Never mutate data; always create new references
2. **Function Structure** - Definitions → Side effects → Return
3. **Functional Transformations** - Use `map`, `filter`, `reduce` over loops
4. **Test-Driven Development** - Write failing tests before implementation
5. **Clean Deletion** - Delete old code completely; no deprecation layers

### YAGNI + SOLID + DRY + KISS

When principles conflict, **KISS wins**. The decision framework:

1. Do I need this now? (YAGNI) → If no, don't build it
2. Is there a simpler way? (KISS) → Choose simpler
3. Am I repeating 3+ times? (DRY) → Extract if simpler
4. Does this do one thing? (SRP) → Split only if clearer

## Configuration Customization

### Project-Specific Rules

Edit `PROJECT_RULES.md` (created by Lisa) to add project-specific instructions:

```markdown
# Project Rules

This is a mobile app for sports betting.
Always use the design system components from `@/ui`.
Never import directly from react-native.
```

### Threshold Adjustment

Edit `eslint.thresholds.config.json` to adjust limits:

```json
{
  "cognitiveComplexity": 15,
  "maxLines": 400
}
```

### Local Settings

Create `.claude/settings.local.json` for machine-specific overrides:

```json
{
  "env": {
    "CUSTOM_VAR": "value"
  }
}
```

This file should be in `.gitignore`.

## Troubleshooting

### Common Issues

#### "Node.js not found"

Install Node.js 18+:

```bash
# macOS with Homebrew
brew install node

# Using nvm
nvm install 18
nvm use 18
```

#### "Permission denied" when running lisa.sh

Make the script executable:

```bash
chmod +x ~/lisa/lisa.sh
```

#### JSON merge fails with "parse error"

Your project's `package.json` may have syntax errors. Validate it:

```bash
node -e "require('./package.json')"
```

#### Hooks not running

Ensure `.claude/settings.json` was applied and hooks are executable:

```bash
chmod +x .claude/hooks/*.sh
```

### Debug Mode

```bash
# See all operations without making changes
~/lisa/lisa.sh --dry-run /path/to/project

# Check compatibility issues
~/lisa/lisa.sh --validate /path/to/project
```

## Development

### Building

```bash
npm install
npm run build
```

### Testing

Lisa includes a comprehensive test suite using Vitest:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

### Type Checking

```bash
npm run typecheck
```

## Adding New Configurations

### Adding a Skill

```bash
mkdir -p all/copy-overwrite/.claude/skills/my-skill
cat > all/copy-overwrite/.claude/skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: What this skill teaches Claude
---

# My Skill

## When to Use
- Scenario 1
- Scenario 2

## Instructions
1. Step one
2. Step two
EOF
```

### Adding a Slash Command

```bash
mkdir -p all/copy-overwrite/.claude/commands/my-category
cat > all/copy-overwrite/.claude/commands/my-category/my-command.md << 'EOF'
---
description: What this command does
argument-hint: <optional-args>
---

Instructions for Claude to follow...
EOF
```

### Adding an ESLint Rule

1. Add rule to appropriate plugin in `eslint-plugin-*/rules/`
2. Register in plugin's `index.js`
3. Add tests in `__tests__/`

### Adding a New Project Type Detector

1. Create detector in `src/detection/detectors/your-type.ts`
2. Register in `src/detection/index.ts`
3. Update `PROJECT_TYPE_HIERARCHY` in `src/core/config.ts` if it has a parent
4. Add tests in `tests/unit/detection/`

## Changelog

### v2.0.0 (2026-01-17)

**Breaking Changes:**
- Rewritten from Bash to TypeScript
- Removed dependency on `jq` - now uses native Node.js
- Removed bats test suite - now uses Vitest

**Features:**
- Full TypeScript implementation with type safety
- 97 comprehensive tests with Vitest
- Modular architecture with dependency injection
- Atomic transactions with backup/rollback
- Improved error handling with custom error types
- New `npm-package` project type with automated npm publishing workflow
- ESLint 9 flat config support for TypeScript projects

### v1.0.0 (2026-01-17)

**Features:**
- Initial release
- Multi-layer Claude Code governance (CLAUDE.md, skills, hooks, commands)
- Custom ESLint plugins for code structure enforcement
- Project type detection (TypeScript, Expo, NestJS, CDK)
- Four copy strategies: copy-overwrite, copy-contents, create-only, merge
- Cascading type inheritance
- Dry-run and validate modes
- Non-interactive mode for CI/CD
- Uninstall capability with manifest tracking

**Governance Layers:**
- Behavioral rules via CLAUDE.md
- Teaching skills for coding philosophy
- Automated hooks for format/lint on edit
- Pre-built slash commands for workflows
- Threshold-based complexity limits
- Git hooks via Husky for pre-commit gates

## License

MIT License - see [LICENSE](LICENSE) for details

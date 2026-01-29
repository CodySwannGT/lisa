# Lisa

Lisa is a **Claude Code governance framework** that ensures Claude produces high-quality, consistent code through multiple layers of guardrails, guidance, and automated enforcement.

> **New to Lisa?** Start with the **[Architecture Overview](OVERVIEW.md)** for a visual guide to how Lisa works, including the developer workflow diagram and multi-layer governance architecture.

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
│  • Run `npx @codyswann/lisa` to bootstrap projects          │
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
- New patterns captured in `.claude/rules/PROJECT_RULES.md`

### Platform Team Iteration Example

1. **Platform Team** discovers Claude sometimes creates overly complex functions
2. **Platform Team** adds a `cognitiveComplexity: 10` threshold to ESLint config
3. **Platform Team** writes a skill teaching Claude to decompose complex logic
4. **Platform Team** pushes update to Lisa repository
5. **Implementation Teams** run `lisa` on their projects (or it happens via CI)
6. **Implementation Teams** now automatically get simpler, more maintainable code

### Upstreaming Improvements

When implementation teams make improvements to Lisa-managed files (better CI configs, new hooks, etc.), the `/lisa:review-implementation` command helps upstream those changes back to Lisa:

```bash
# Start Claude Code with access to both your project and Lisa
claude --add-dir ~/lisa

# Run the review command
/lisa:review-implementation
```

This command:
1. Compares your project's Lisa-managed files against Lisa's source templates
2. Generates a diff report showing what has changed
3. Offers to copy improvements back to Lisa for all teams to benefit

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

Implementation teams then install from your organization's fork:

```bash
# Install globally from your fork
npm install -g github:your-org/lisa

# Or use npx with your fork
npx github:your-org/lisa /path/to/project
```

## Installation

Install Lisa globally via npm:

```bash
npm install -g @codyswann/lisa
```

Or use npx to run without installing:

```bash
npx @codyswann/lisa /path/to/project
```

### Requirements

- **Node.js 18+** (workflows default to 22.x)
- **npm**, **bun**, or **pnpm**

### Optional Tools

These tools enhance Lisa's capabilities but are not required:

- **[CodeRabbit CLI](https://coderabbit.ai/)** - AI-powered code review tool used by `/project:review`

  **Installation (choose one):**
  ```bash
  # Recommended
  curl -fsSL https://cli.coderabbit.ai/install.sh | sh
  coderabbit --version  # Verify installation

  # Homebrew (macOS/Linux)
  brew install coderabbit

  # NPX (no install needed)
  npx coderabbitai-mcp@latest
  ```

  If not installed, the CodeRabbit review step in `/project:review` will be skipped silently.

## Usage

Run Lisa against any project directory:

```bash
lisa /path/to/your-project

# Or from within your project
lisa .

# Or with npx (no install required)
npx @codyswann/lisa .
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
lisa --dry-run /path/to/your-project
```

### CI/CD Usage

For automated pipelines, use non-interactive mode:

```bash
lisa --yes /path/to/project

# Or with npx
npx @codyswann/lisa --yes /path/to/project
```

### Validate Mode

Check project compatibility without making changes:

```bash
lisa --validate /path/to/project
```

### Uninstall

Remove Lisa-managed files from a project:

```bash
lisa --uninstall /path/to/project

# Preview what would be removed
lisa --dry-run --uninstall /path/to/project
```

Note: Files applied with `copy-contents` or `merge` strategies require manual cleanup as they modify existing content.

### GitHub Rulesets

Lisa can also apply GitHub repository rulesets via a separate script. This enforces branch protection rules like requiring PRs, status checks, and preventing force pushes.

```bash
# Apply rulesets to a project's GitHub repo
~/lisa/lisa-github-rulesets.sh /path/to/project

# Preview what would be applied
~/lisa/lisa-github-rulesets.sh --dry-run /path/to/project

# Non-interactive mode
~/lisa/lisa-github-rulesets.sh --yes /path/to/project
```

**Requirements:**
- `gh` CLI installed and authenticated (`gh auth login`)
- Admin permissions on the repository
- `jq` installed

**How it works:**

1. Detects project types (same as main Lisa script)
2. Collects ruleset templates from `github-rulesets/` directories:
   - `all/github-rulesets/` → applied to all projects
   - `typescript/github-rulesets/` → TypeScript projects
   - `expo/github-rulesets/` → Expo projects (inherits typescript)
   - etc.
3. Creates or updates rulesets via the GitHub API

**Template format:**

Place JSON files in `{type}/github-rulesets/`. The script strips read-only fields (`id`, `source`, `source_type`) before applying:

```json
{
  "name": "Protect Main Branch",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["~DEFAULT_BRANCH"],
      "exclude": []
    }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": true,
        "required_review_thread_resolution": true
      }
    }
  ]
}
```

You can export an existing ruleset from GitHub's UI or API and place it in the appropriate directory. The script handles idempotency—if a ruleset with the same name exists, it updates rather than creates.

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
| `/project:reduce-max-lines` | Reduce max file lines threshold and fix violations |
| `/project:reduce-max-lines-per-function` | Reduce max lines per function threshold and fix violations |
| `/git:commit` | Create conventional commit |
| `/git:submit-pr` | Create pull request |
| `/lisa:review-implementation` | Compare project files against Lisa templates, upstream changes |

### Custom ESLint Plugins

Lisa includes custom ESLint plugins that enforce code structure:

**eslint-plugin-code-organization**
- `enforce-statement-order` - Definitions → Side effects → Return

**eslint-plugin-component-structure** (Expo)
- `single-component-per-file` - One component per file
- `require-memo-in-view` - Memoization in view components

### Thresholds

Configurable limits in `eslint.thresholds.config.json`:

```json
{
  "cognitiveComplexity": 10,
  "maxLines": 300,
  "maxLinesPerFunction": 75
}
```

### File Backups

When Lisa overwrites files that have local modifications (conflicts), it automatically creates timestamped backup copies in the `.lisabak/` directory. This allows you to review or recover your original files if needed.

**Backup naming format:** `<YYYY-MM-DD>-<filename>.<extension>.lisa.bak`

**Example:**
```
.lisabak/
├── 2026-01-19-eslint.config.mjs.lisa.bak
├── 2026-01-19-package.json.lisa.bak
└── 2026-01-19-.prettierrc.json.lisa.bak
```

**Key behaviors:**
- Backups are created only when files are overwritten (not on first creation or when identical)
- Multiple backups of the same file on the same day are all preserved
- The `.lisabak/` directory is automatically added to `.gitignore` (backups are local-only)
- Backups are meant for manual review; the `.lisabak/` directory can be safely deleted after reviewing

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

Projects detected as `npm-package` automatically receive a GitHub Actions workflow for publishing to npm using **OIDC trusted publishing**. This workflow:

1. Triggers on push to `main`
2. Runs semantic versioning via `release.yml`
3. Publishes to npm with `npm publish --access public --provenance`

**Step 1: First-Time Publish (Manual)**

OIDC trusted publishing requires the package to exist on npm first. For new packages, do a manual initial publish:

```bash
# Login to npm (opens browser for authentication)
npm login

# Verify you're logged in
npm whoami

# Build the package
npm run build

# Publish for the first time
npm publish --access public
```

**Step 2: Configure Trusted Publisher on npm**

After the first publish, configure OIDC for automated future releases:

1. Go to [npmjs.com](https://www.npmjs.com/) and navigate to your package
2. Click **Settings** → **Trusted Publishers**
3. Click **Add GitHub Actions**
4. Fill in the required fields:
   - **Organization/User**: Your GitHub username or org (e.g., `CodySwannGT`)
   - **Repository**: Your repo name (e.g., `lisa`)
   - **Workflow filename**: `publish.yml` (must match exactly, including `.yml`)
   - **Environment**: Leave blank unless using GitHub environments
5. Click **Save**

**Step 3: Future Releases (Automatic)**

Once configured, all future releases are automatic:
- Push to `main` triggers the workflow
- Semantic versioning determines the version bump
- OIDC authenticates without tokens
- Package publishes with provenance attestation

**Benefits of OIDC Trusted Publishing:**

- No tokens to manage, rotate, or risk leaking
- Automatic provenance attestations for supply chain security
- Short-lived, workflow-specific credentials
- No 90-day expiration limits to worry about

**Requirements:**

- npm CLI 11.5+ (workflow automatically installs latest)
- Cannot use self-hosted GitHub runners (not yet supported by npm)

**Workflow Configuration:**

The `publish-to-npm.yml` workflow accepts configurable inputs:

| Input | Default | Description |
|-------|---------|-------------|
| `node_version` | `20.x` | Node.js version to use |
| `package_manager` | `npm` | Package manager (`npm`, `yarn`, or `bun`) |

Example with custom configuration:

```yaml
publish:
  uses: ./.github/workflows/publish-to-npm.yml
  needs: [release]
  with:
    tag: ${{ needs.release.outputs.tag }}
    version: ${{ needs.release.outputs.version }}
    node_version: '22.x'
    package_manager: 'bun'
```

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

## Package.lisa.json: Governance-Driven Package.json Management

The `package.lisa.json` strategy provides a specialized approach to managing `package.json` files with structured governance. Instead of using `//lisa-*` tags directly in project `package.json` files, Lisa separates governance logic into `package.lisa.json` files within each type directory.

### How It Works

Each project type directory (all/, typescript/, expo/, nestjs/, cdk/, npm-package/) can contain a `package.lisa.json` file in the `tagged-merge/` subdirectory:

```
typescript/
├── tagged-merge/
│   └── package.lisa.json
```

The `package.lisa.json` file defines three sections:

```json
{
  "force": {
    "scripts": { "test": "jest", "lint": "eslint ." },
    "devDependencies": { "typescript": "^5.0.0" }
  },
  "defaults": {
    "engines": { "node": "22.x" }
  },
  "merge": {
    "trustedDependencies": ["@ast-grep/cli"]
  }
}
```

### Section Semantics

- **force**: Lisa's values completely override project values. Used for critical governance like test runners and linters.
- **defaults**: Provides default values only when keys are missing from the project. Project values always win if present.
- **merge**: Concatenates arrays and deduplicates. Useful for combining Lisa's required dependencies with project's custom ones.

### Type Inheritance

Templates follow the project type hierarchy:

```
all/package-lisa/package.lisa.json
└── typescript/package-lisa/package.lisa.json
    ├── expo/package-lisa/package.lisa.json
    ├── nestjs/package-lisa/package.lisa.json
    ├── cdk/package-lisa/package.lisa.json
    └── npm-package/package-lisa/package.lisa.json
```

Child types inherit and override parent templates. For example, a NestJS project loads templates from `all/`, `typescript/`, and `nestjs/` in order, with later types overriding earlier ones.

### Benefits vs Tagged Comments

Unlike `//lisa-force-*` tags embedded in `package.json`:

- **Clean Project Files**: Project `package.json` files remain completely free of Lisa governance markers
- **Type-Specific Governance**: Different governance rules for different project types (TypeScript vs Expo vs NestJS)
- **Inheritance Chain**: Automatically applies parent type templates (TypeScript rules apply to all TS projects)
- **Separation of Concerns**: Governance lives in Lisa directory; project files are purely for application use
- **Transparent Updates**: Lisa can update governance without modifying project files

### Migration for Existing Users

If you're currently using `//lisa-*` tags in your `package.json`:

1. Extract the tagged sections into a `package.lisa.json` file
2. Organize by section: move `//lisa-force-*` sections to `force`, etc.
3. Remove the tags from your `package.json`
4. Lisa will now manage those properties via `package.lisa.json`

## Copy Strategies

Each type directory contains subdirectories that control how files are applied:

| Strategy | Dest doesn't exist | Dest identical | Dest differs |
|----------|-------------------|----------------|--------------|
| `copy-overwrite/` | Copy | Skip | Prompt (overwrite/skip) |
| `copy-contents/` | Copy | Skip | Append missing lines |
| `create-only/` | Copy | Skip | Skip |
| `merge/` | Copy | Skip | JSON deep merge |
| `tagged-merge/` | Copy | Skip | Merge by tagged sections |

### Strategy Details

**copy-overwrite**: Standard config files that should match Lisa's version. Prompts when local changes exist.

**copy-contents**: For files like `.gitignore` where you want to ensure certain lines exist without removing custom entries.

**create-only**: Template files that should only be created once (e.g., `.claude/rules/PROJECT_RULES.md` for project-specific customization).

**merge**: For JSON files. Performs a deep merge where:
- Lisa provides default values
- Your project's values take precedence
- Missing scripts/dependencies are added without overwriting existing ones

**tagged-merge**: For JSON files with explicit section management via comment tags. Enables fine-grained control over which parts Lisa manages vs. which parts projects can customize:

```json
{
  "scripts": {
    "//lisa-force-scripts-quality-assurance": "Required by Lisa for CI/CD and governance",
    "lint": "eslint . --quiet",
    "build": "tsc",
    "test": "vitest run",
    "//end-lisa-force-scripts-quality-assurance": "",
    "deploy": "my-custom-deploy"
  },
  "devDependencies": {
    "//lisa-force-dev-dependencies": "Required by Lisa for standard governance",
    "eslint": "^9.39.0",
    "prettier": "^3.3.3",
    "//end-lisa-force-dev-dependencies": ""
  },
  "engines": {
    "//lisa-defaults-engines": "Defaults - projects can override",
    "node": "22.21.1",
    "bun": ">= 1.3.5",
    "//end-lisa-defaults-engines": ""
  },
  "//lisa-merge-trusted-dependencies": "Lisa's + project's combined",
  "trustedDependencies": ["@ast-grep/cli"],
  "//end-lisa-merge-trusted-dependencies": ""
}
```

**Tag Format:** `//lisa-<behavior>-<category>` with matching `//end-lisa-<behavior>-<category>`

**Tag Semantics:**
- `//lisa-force-<name>` → `//end-lisa-force-<name>`: Lisa replaces this section entirely; project changes within tags are ignored
- `//lisa-defaults-<name>` → `//end-lisa-defaults-<name>`: Project can override the entire section; Lisa provides defaults if missing
- `//lisa-merge-<name>` → `//end-lisa-merge-<name>`: For arrays—Lisa's items are merged with project's (deduplicated by value equality)

**Benefits:**
- Lisa controls critical configs (CI/CD scripts, required dependencies) via `force` tags
- Projects can safely customize defaults via `defaults` tags
- Array merging via `merge` tags enables shared dependency lists without overwriting project additions
- Projects can safely extend with custom values outside tagged sections
- Tags are visible in the file, making governance transparent to developers

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
│   │   ├── merge.ts
│   │   ├── tagged-merge.ts         # Tagged merge with comment-based tags
│   │   └── tagged-merge-types.ts   # Types for tagged merge
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

Edit `.claude/rules/PROJECT_RULES.md` (created by Lisa) to add project-specific instructions:

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

### Ignoring Files (.lisaignore)

Create a `.lisaignore` file in your project root to skip specific files from Lisa's management. This is useful when you have custom configurations that shouldn't be overwritten.

```bash
# Ignore specific files
eslint.config.mjs
.prettierrc.json

# Ignore entire directories
.claude/hooks/

# Use glob patterns
*.example.json
**/*.custom.ts
```

Lisa will skip any files matching these patterns during apply operations. The ignored file count appears in the summary output.

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
lisa --dry-run /path/to/project

# Check compatibility issues
lisa --validate /path/to/project
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
npm run test:cov
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

### v2.1.0 (2026-01-28)

**Features:**
- New `tagged-merge` copy strategy for fine-grained JSON section control
  - `//lisa-force-*` tags: Lisa replaces section entirely
  - `//lisa-defaults-*` tags: Project can override, Lisa provides defaults
  - `//lisa-merge-*` tags: Arrays merged with deduplication
- Tagged-merge templates for all project types (typescript, expo, nestjs, cdk)
- Backward-compatible with existing `merge/` strategy

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

## Future Enhancements

Planned improvements for future versions of Lisa:

### Beads / Task Management Integration

Integrate with [Beads](https://github.com/steveyegge/beads), a git-backed issue tracker engineered for AI-supervised coding workflows, and Claude Code's task management system (v2.1.16+).

**Value:**
- **Persistent Memory**: Beads stores tasks as JSONL in `.beads/`, version-controlled with code—agents maintain context across sessions
- **Dependency-Aware Execution**: `bd ready` shows only unblocked work, enabling true parallel multi-agent execution
- **Async Workflows**: Combine Claude Code Web + ntfy notifications + Beads status updates for fire-and-forget task execution
- **Audit Trail**: Git-tracked task history provides immutable record of work decomposition and completion

**Integration Points:**
- Update `/project:plan` to create Beads issues with dependencies
- Update `/project:execute` to claim and resolve tasks automatically
- Enable multi-agent orchestration querying `bd ready` for unblocked work

### Biome Migration

Migrate formatting from Prettier to [Biome](https://biomejs.dev/) for 40x faster formatting, while keeping ESLint for governance-critical rules.

**Value:**
- **Performance**: Biome formats 10,000 files in 0.3s vs Prettier's 12.1s
- **Unified Tooling**: Single binary replaces Prettier, reducing dependencies
- **97% Prettier-Compatible**: Nearly identical output with minimal configuration changes

**Approach:**
- Replace Prettier with Biome formatter (low-risk, high-reward)
- Keep ESLint for custom rules (enforce-statement-order, functional/immutable-data)
- Monitor Biome's GritQL plugin system for future full migration when it matures

**Note:** Full ESLint replacement is not recommended yet—Lisa's custom plugins and eslint-plugin-functional have no Biome equivalents.

### ESLint Plugin Extraction

Extract custom ESLint plugins to separate npm packages for independent versioning and broader adoption.

**Current Plugins:**
- `eslint-plugin-code-organization` (1 rule: enforce-statement-order)
- `eslint-plugin-component-structure` (4 rules: container/view pattern enforcement)
- `eslint-plugin-ui-standards` (3 rules: NativeWind/styling standards)

**Value:**
- **Independent Versioning**: Bug fixes ship without waiting for Lisa releases
- **Reusability**: Any ESLint project can adopt these rules, not just Lisa users
- **Easier Contribution**: Focused repos with clearer scope for community PRs
- **Smaller Bundle**: Lisa package size reduced; users install only needed plugins
- **Clear Ownership**: Each plugin has its own documentation and maintenance cycle

**Extraction Order:**
1. `eslint-plugin-code-organization` (generic, cleanest extraction)
2. `eslint-plugin-ui-standards` (Expo-specific, smaller)
3. `eslint-plugin-component-structure` (largest, most complex)

### Test Library Standardization

Standardize on Vitest across all Lisa-managed projects for consistent, fast testing.

**Current State:** Lisa uses Vitest 3.0 with 97 tests, 90% coverage thresholds, and v8 provider.

**Value:**
- **Consistency**: All projects use same test APIs and patterns
- **Performance**: Vitest is 10-20x faster than Jest in watch mode
- **TypeScript-Native**: No ts-jest configuration needed
- **Modern Ecosystem**: Growing adoption (20M+ weekly downloads), active maintenance

**Trade-offs Considered:**
- Jest: Industry standard but slower, requires ts-jest for TypeScript
- Bun Test: Fastest but smallest ecosystem, 34% compatibility issues reported
- Vitest: Best balance of speed, TypeScript support, and ecosystem maturity

### Ruby on Rails Support

Add Ruby on Rails as a project type with RuboCop integration and Rails-specific skills.

**Detection:** Check for `Gemfile` + `Gemfile.lock` + `config/application.rb` + `app/` directory

**What Lisa Would Provide:**
- **RuboCop Configuration**: `.rubocop.yml` with rubocop-rails, rubocop-performance, rubocop-rspec
- **Skills**: Rails conventions (MVC, service objects, concerns), RSpec testing, database/migrations
- **Gemfile Merge**: Add development gems (rspec-rails, factory_bot_rails, faker) via merge strategy
- **CI/CD**: GitHub workflows for RuboCop + RSpec

**Skills to Create:**
1. `rails-conventions` - MVC patterns, service objects, concerns, ActiveRecord
2. `rspec-testing` - Test structure, shared examples, factories, isolation
3. `rubocop-patterns` - Linting rules, Rails-specific cops
4. `rails-database` - Migrations, models, scopes, associations

**Note:** Rails would be a standalone type (not inheriting from TypeScript) since Ruby uses different tooling.

### Plugin Publishing

Publish Claude Code skills, commands, and agents as installable plugins via the Claude Code marketplace system.

**Current Plugin Ecosystem:**
- Official plugins: `claude-plugins-official` (typescript-lsp, code-review, playwright)
- Community registry: [claude-plugins.dev](https://claude-plugins.dev/)

**Lisa Components That Could Become Plugins:**
- `coding-philosophy` skill - Teachable immutability and function structure patterns
- `prompt-complexity-scorer` skill - Request complexity evaluation
- `jsdoc-best-practices` skill - Documentation standards
- `project:*` commands - Implementation workflows
- Custom agents (skill-evaluator, codebase-analyzer)

**Value:**
- **À La Carte Adoption**: Teams install only relevant governance patterns
- **Automatic Updates**: Plugin updates flow without re-running Lisa CLI
- **Community Contributions**: Accept PRs for stack-specific patterns (Django, FastAPI, etc.)
- **Ecosystem Discovery**: Listed on claude-plugins.dev for broader reach
- **Mix-and-Match**: Combine Lisa's `coding-philosophy` with other teams' specialized plugins

**Implementation Path:**
1. Extract skills as standalone plugins with `.claude-plugin/plugin.json` manifests
2. Create `lisa-governance-plugins` marketplace repository
3. List on claude-plugins.dev community registry
4. Provide marketplace.json for organizations to self-host

## License

MIT License - see [LICENSE](LICENSE) for details

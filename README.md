# Lisa

A Claude Code governance framework that applies guardrails, guidance, and automated enforcement to projects.

Developers write specs and answer questions. Agents implement, test, verify, question, and document.

## About This Project

> Ask Claude: "What is the purpose of Lisa and how does it work?"

## Installation

```bash
# Install via npm
npm install -g @codyswann/lisa

# Or use npx (no install required)
npx @codyswann/lisa /path/to/project
```

## How It Works

Lisa applies multiple layers of quality control to Claude Code projects:

| Layer | Purpose |
|-------|---------|
| **CLAUDE.md** | Direct behavioral rules for Claude |
| **Skills** | Teach coding philosophy and patterns |
| **Hooks** | Auto-format and lint on every edit |
| **Slash Commands** | Guided workflows (`/project:implement`, `/git:commit`) |
| **ESLint Plugins** | Enforce code structure and ordering |
| **Git Hooks** | Pre-commit quality gates via Husky |

## Step 1: Install Claude Code

```bash
brew install claude-code
# Or: npm install -g @anthropic-ai/claude-code
```

## Step 2: Set Up This Project

> Ask Claude: "I just cloned this repo. Walk me through the full setup including installing dependencies and building the project."

## Step 3: Apply Lisa to a Project

```bash
lisa /path/to/your-project

# Or from within your project
npx @codyswann/lisa .
```

> Ask Claude: "How do I apply Lisa to a project? Walk me through using the CLI on an existing codebase."

## Step 4: Work on a Feature

> Ask Claude: "I have a feature to implement: [describe feature]. Research the codebase and create a plan."

Or break it down:

- `/project:setup` - Set up the project from a spec or ticket
- `/project:research` - Research the codebase
- `/project:plan` - Create an implementation plan
- `/project:implement` - Execute the plan
- `/project:review` - Review the changes

## Common Tasks

### Code Review

> Ask Claude: "Review the changes on this branch and suggest improvements."

### Submit a PR

> Ask Claude: "Commit my changes and open a pull request."

### Fix Lint Errors

> Ask Claude: "Run the linter and fix all errors."

### Add Test Coverage

> Ask Claude: "Increase test coverage for the files I changed."

### Run Tests

> Ask Claude: "Run the test suite and fix any failures."

### Contributing

> Ask Claude: "I want to add a new stack type to Lisa. Walk me through the process."

## Project Standards

> Ask Claude: "What coding standards and conventions does this project follow?"

## Architecture

> Ask Claude: "Explain the architecture of this project, including key components and how they interact."

## Troubleshooting

> Ask Claude: "I'm having an issue with [describe problem]. Help me debug it."

## License

MIT License - see [LICENSE](LICENSE) for details.

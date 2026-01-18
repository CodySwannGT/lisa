# Contributing to Lisa

Thank you for your interest in contributing to Lisa! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Style Guidelines](#style-guidelines)

## Code of Conduct

Please be respectful and constructive in all interactions. We welcome contributors of all experience levels.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Create a branch for your changes

```bash
git clone https://github.com/YOUR_USERNAME/lisa.git
cd lisa
git checkout -b feature/your-feature-name
```

## Development Setup

### Prerequisites

- Bash 3.2+ (default on macOS)
- `jq` for JSON processing
- `bats-core` for testing (optional but recommended)

### Installing Dependencies

**macOS:**
```bash
brew install jq bats-core
```

**Linux (Debian/Ubuntu):**
```bash
sudo apt install jq bats
```

**Linux (RHEL/CentOS):**
```bash
sudo yum install jq
# For bats, install from source or use npm
npm install -g bats
```

### Project Structure

```
lisa/
├── lisa.sh                 # Main bootstrapper script
├── tests/                  # Test suite
│   └── lisa.bats          # Bats tests for lisa.sh
├── all/                    # Configs for all projects
│   ├── copy-overwrite/    # Files that replace existing
│   ├── copy-contents/     # Files that append content
│   ├── create-only/       # Files created only if missing
│   └── merge/             # JSON files to deep merge
├── typescript/             # TypeScript-specific configs
├── expo/                   # Expo-specific configs
├── nestjs/                 # NestJS-specific configs
└── cdk/                    # CDK-specific configs
```

## Making Changes

### Adding New Configuration Files

1. Identify the correct type directory (`all/`, `typescript/`, `expo/`, etc.)
2. Choose the appropriate strategy subdirectory:
   - `copy-overwrite/` - Standard configs that should match Lisa's version
   - `copy-contents/` - Files like `.gitignore` where content is appended
   - `create-only/` - Template files created once and customized by user
   - `merge/` - JSON files where Lisa provides defaults

3. Place your file in the correct location

**Example: Adding an ESLint config for TypeScript projects**
```bash
lisa/typescript/copy-overwrite/eslint.config.mjs
```

**Example: Adding default scripts to Expo package.json**
```bash
lisa/expo/merge/package.json
# Only include the keys you want to add/ensure exist
```

### Adding a New Project Type

1. Create a new directory at the root level
2. Add detection logic in `lisa.sh` in the `detect_project_types()` function
3. If the type should inherit from another, update `get_parent_type()`
4. Add strategy subdirectories as needed

### Modifying lisa.sh

When modifying the main script:

1. Maintain Bash 3.2 compatibility (macOS default)
2. Use `set -euo pipefail` error handling
3. Add proper quoting for all variables
4. Update the usage text if adding options
5. Add tests for new functionality

## Testing

### Running Tests

```bash
# Run all tests
bats tests/lisa.bats

# Run specific test
bats tests/lisa.bats --filter "detects TypeScript"

# Verbose output
bats tests/lisa.bats --verbose-run
```

### Writing Tests

Tests use [bats-core](https://github.com/bats-core/bats-core). Key patterns:

```bash
@test "description of what is being tested" {
    # Setup
    create_typescript_project

    # Execute
    run "$LISA_SCRIPT" --dry-run --yes "$TEST_PROJECT"

    # Assert
    [[ "$status" -eq 0 ]]
    [[ "$output" =~ "expected text" ]]
}
```

### Test Coverage Requirements

- All new command-line options must have tests
- All project type detection logic must be tested
- All copy strategies should be tested
- Edge cases (empty dirs, special characters, etc.) should be covered

## Submitting Changes

### Commit Messages

Follow conventional commit format:

```
type(scope): description

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Adding or updating tests
- `refactor`: Code changes that don't add features or fix bugs
- `chore`: Maintenance tasks

Examples:
```
feat(cli): add --uninstall flag to remove Lisa configs
fix(detection): correctly detect NestJS projects without nest-cli.json
docs(readme): add troubleshooting section
test(strategies): add tests for copy-contents strategy
```

### Pull Request Process

1. Ensure all tests pass: `bats tests/lisa.bats`
2. Update documentation if needed
3. Add tests for new functionality
4. Create a pull request with:
   - Clear title describing the change
   - Description of what and why
   - Reference to any related issues

### Pull Request Template

```markdown
## Summary
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Refactoring

## Testing
- [ ] All existing tests pass
- [ ] Added tests for new functionality

## Checklist
- [ ] Code follows project style guidelines
- [ ] Documentation updated
- [ ] Bash 3.2 compatible
```

## Style Guidelines

### Bash Script Style

- Use `local` for function variables
- Quote all variable expansions: `"$variable"`
- Use `[[` instead of `[` for conditionals
- Use `$(command)` instead of backticks
- Add comments for non-obvious logic
- Keep functions focused and under 50 lines when possible

**Good:**
```bash
process_file() {
    local src="$1"
    local dest="$2"

    if [[ -f "$dest" ]]; then
        log_info "File exists: $dest"
    fi
}
```

**Avoid:**
```bash
process_file() {
    src=$1  # Missing local, missing quotes
    if [ -f $dest ]; then  # Using [ instead of [[, missing quotes
        echo File exists  # Using echo instead of log function
    fi
}
```

### File Organization

- Configuration files should be self-contained
- Comments should explain "why", not "what"
- Group related configurations together

### Documentation

- Use clear, concise language
- Include examples where helpful
- Keep README focused on usage
- Put detailed docs in separate files

## Questions?

Open an issue for:
- Bug reports
- Feature requests
- Questions about contributing

Thank you for contributing to Lisa!

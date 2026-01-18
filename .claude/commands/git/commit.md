---
description: "Create conventional commits for current changes"
allowed-tools: ["Bash"]
argument-hint: "[commit-message-hint]"
---

# Git Commit Workflow

Create conventional commits for current changes. Optional hint: $ARGUMENTS

## Workflow

### See what has changed

!git status
!git diff --stat

### Apply these requirements

1. **Branch Check**: If on `dev`, `staging`, or `main`, create a feature branch named after the changes
2. **Commit Strategy**: Group related changes into conventional commits (feat, fix, chore, docs, etc.)
3. **Commit Creation**: Stage and commit changes in logical batches with clear messages
4. **Verification**: Ensure all changes are committed

### Use conventional commit format

- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation
- `chore:` for maintenance
- `style:` for formatting
- `refactor:` for code restructuring
- `test:` for test additions

### Never

- use `--no-verify` or `--no-verify` flags
- attempt to bypass tests or quality checks
- skip tests or quality checks
- stash changes

## Execute

Execute the workflow now.

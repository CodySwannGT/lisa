---
name: lisa-git-commit
description: "creating conventional commits…"
allowed-tools: ["Bash"]
---
This skill should be used when creating conventional commits for current changes. It groups related changes into logical commits, ensures all files are committed, and verifies the working directory is clean afterward.


# Git Commit Workflow

Create conventional commits for current changes. Optional hint: $ARGUMENTS

## Workflow

### See what has changed

!git status
!git diff --stat

### Apply these requirements

1. **Branch Check**: If on `dev`, `staging`, or `main`, create a feature branch named after the changes
2. **Commit Strategy**: Group related changes into logical conventional commits (feat, fix, chore, docs, etc.). Every rule below that says "all" or "everything" excludes the local-only `.lisa/work-item-context.md` described in rule 3.
3. **Commit ALL Files**: Every file must be assigned to a commit group - no file gets left out or unstaged. **Local-only exception:** never stage `.lisa/work-item-context.md`, or any other file the work-item context contract marks local-only, even when it is untracked and not ignored — it can quote credentials from tracker comments. Leave it untracked, and say in your report that it was left out and why.
4. **Commit Creation**: Stage and commit each group with clear messages
5. **Verification**: Run `git status` to confirm working directory is clean - must show "nothing to commit" (apart from a local-only file left untracked under rule 3)

### Use conventional commit format

- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation
- `chore:` for maintenance
- `style:` for formatting
- `refactor:` for code restructuring
- `test:` for test additions

For hand-written messages, put prose and attribution text before one final,
unbroken block of `Key: value` trailers, including `Work-Item:` and
`Co-authored-by:`. Commit preparation repairs a misplaced work-item reference;
the original authored line may remain in the message.

### Never

- use `--no-verify` flag
- attempt to bypass tests or quality checks
- skip tests or quality checks
- stash changes - ALL changes must be committed, except the local-only `.lisa/work-item-context.md`
- skip or exclude any files from the commit - even if they're unrelated (the local-only `.lisa/work-item-context.md` is the one exclusion, and it is mandatory)
- leave uncommitted changes in the working directory, other than the local-only `.lisa/work-item-context.md`
- ask the user which files to commit - commit everything except the local-only `.lisa/work-item-context.md`

## Execute

Execute the workflow now.

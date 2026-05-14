# Lisa Workflow Playbook

Lisa exposes lifecycle commands and quality workflows that route work through repeatable steps.

## Lifecycle Commands

- Research: investigate the codebase and problem, then produce a PRD.
- Plan: decompose a PRD into ordered work items.
- Implement: take a ticket from spec to PR with verification.
- Verify: commit, push, open or update PR, monitor, and verify behavior.
- Debrief: mine shipped work for learnings and follow-up improvements.

## Maintenance Commands

Lisa also supports local review, PR review handling, test coverage improvement, test hardening, code-complexity reduction, max-lines reduction, linter-error cleanup, branch pruning, and security scans.

## Quality Gate Habit

Before shipping Lisa changes, expect local hooks and CI to run typecheck, formatting, linting, slow lint, dead-code detection, tests, coverage, security audit, and integration checks depending on the action.

# Project Rules

Project-specific rules and guidelines that apply to this codebase.

Rules in `.claude/rules/` are automatically loaded by Claude Code at session start.
Add project-specific patterns, conventions, and requirements below.

This file is **human-authored only** — the humans' decree surface. Automated
flows never append to it: machine-captured learnings land in the learnings
ledger (default `.lisa/PROJECT_LEARNINGS.md`) via the executable contract, and
the gardener (`/lisa:learnings:audit`) proposes promotions, demotions, and
retirements as human-gated tracker tickets. Existing sections of this file are
first-run gardener candidates like any other knowledge — expect prose that
restates what a lint or hook already enforces to earn a promote-and-delete
ticket over time, so this file shrinks instead of growing.

---

## Never name a downstream project

**Projects may mention Lisa. Lisa may not mention projects.** The direction is
the whole rule: a host repo citing `@codyswann/lisa` is fine; anything in this
repository naming a host project is not.

This repository is **public**, and `dist/` is in the npm `files` allowlist — so a
comment in `src/` is published twice over, on github.com and to every consumer
that installs the package.

Applies to commit messages, PR and issue bodies, code comments, tests,
documentation, plans, and the wiki. It covers more than the GitHub org slug:

- org slugs and human-readable company names
- product and repository names
- AWS account numbers, bundle identifiers, and internal domains
- local absolute paths that embed any of the above

**Write the evidence, not the identity.** Lisa's convention of citing the real
repository that proved something is what makes its commits good evidence, and it
is exactly what leaks. Keep the rigour and drop the name: *"a caller repo in the
portfolio"*, *"repo A"* / *"repo B"* where a document contrasts two, `<ticket>`
in place of a real ticket id. The argument never depends on which named client
proved it — if it seems to, the argument is the thing to fix.

Two deliberate exceptions, both of which stay out of published artifacts:
`.lisa.workspaces.json` is a runtime input that must name real local checkouts,
and third-party product names (Google's Gemini, Antigravity) are not host
projects.

When updating package.json, always check if there's a corresponding `package.lisa.json` template file. Update both together:

- **package.lisa.json** (source): Defines governance rules in `force`, `defaults`, and `merge` sections
- **package.json** (destination): Remains clean with no `//lisa-*` tags

For example:
- Changes to `typescript/package-lisa/package.lisa.json` apply to all TypeScript projects
- Changes to `package.lisa.json` force/defaults/merge sections determine how they affect project package.json files
- Project package.json files should never contain governance markers; they're purely application files

See README.md "Package.lisa.json" section for details on force/defaults/merge semantics.

### Semantic Merge Behaviors

Understanding force/defaults/merge is critical for template design:

- **force**: Lisa's values completely replace project's values. Use for governance-critical configs (linting rules, mandatory dependencies, commit hooks).
- **defaults**: Project's values are preserved; Lisa provides fallback. Use for helpful starting templates that projects can override (Node.js version, TypeScript version).
- **merge**: Arrays are concatenated and deduplicated. Use for shared lists (trusted dependencies, linting plugins) where both Lisa and project contributions are valuable.

When adding a new configuration:
1. Ask: "Is this governance-critical?" → Use `force`
2. Ask: "Can projects safely override this?" → Use `defaults`
3. Ask: "Is this a list where Lisa and projects both contribute?" → Use `merge`

## General Rules

When updating a project file, always check to see if it has a corresponding template file. IF it does, update it to match. This DOES NOT apply to "create-only" rules.

When upstreaming a governance pattern discovered in a downstream project (e.g., frontend-v2, backend-v2), trace it back to the Lisa template source files and update both the template and its tests. This ensures the pattern propagates to all projects using that stack template.

When creating Claude Code hooks for enforcement (linting, code quality, static analysis), always use blocking behavior (exit 2 on failures) so Claude receives feedback and can fix the errors. Notification-only hooks (like ntfy.sh) should exit 0 since they don't require Claude to take action.

## Skills and Commands

Skills and commands serve different roles across coding-agent harnesses:

- **Skills** (`.claude/skills/<name>/SKILL.md`): Contain implementation logic. Use hyphen-separated naming (e.g., `lisa-plan`, `lisa-git-commit`). Skills do NOT support `argument-hint` or `$ARGUMENTS` substitution.
- **Commands** (`.claude/commands/<namespace>/<name>.md`): User-facing interface with `argument-hint` and `$ARGUMENTS` support. Use colon-scoped namespaces whenever the target agent supports native commands. Directory nesting creates colon-separated names in slash-command UIs (e.g., `lisa/implement.md` becomes `/lisa:implement` in Claude/OpenCode-style harnesses). Commands pass through to skills.

Every user-facing workflow should have a colon-scoped command and a hyphenated skill target when both surfaces exist. Example: `/lisa:implement` delegates to `/lisa-implement`. Not every coding agent supports `/` commands; Codex does not. For agents without native command support, install the equivalent hyphenated skill alias and document its native invocation syntax, such as `$lisa-implement` for Codex.

Skills can invoke other skills via the Skill tool, enabling skill chaining and composition. Internal skill-to-skill references use hyphen names (e.g., `/lisa-git-commit`).

Lisa-specific skills (like `lisa-integration-test`, `lisa-learn`, `lisa-review-project`) should only exist in the root `.claude/skills/` and `.claude/commands/` directories, NOT in downstream template directories such as `all/merge/`, since they are only relevant to the Lisa repository itself, not downstream projects.

## Task Metadata

When creating tasks, do not include `/coding-philosophy` in the `skills` array of task metadata. The coding philosophy is distributed as a generated Lisa rule and does not need to be explicitly invoked.

## Agent Team Workflows

When working with agent teams, follow these patterns to handle platform behaviors:

### Context Compaction Resilience

Context compaction can cause team leads to lose in-memory state (task assignments, owner fields). To mitigate this:

1. **Dual owner storage** - On every TaskUpdate that sets `owner`, also store it in `metadata.owner`:
   ```
   TaskUpdate({ taskId: "1", owner: "implementer-1", metadata: { owner: "implementer-1" } })
   ```
2. **Re-read after compaction** - Immediately call TaskList to reload all task state after compaction occurs
3. **Restore missing owners** - If any task has `metadata.owner` but no `owner` field, restore it via TaskUpdate
4. **Never rely on memory** - Always call TaskList before assigning new work

### Review Task Parallelization

Parallelize all independent review agents after implementation is complete:

- `product-specialist`, `coderabbit:code-reviewer`, `plan-local-code-review`, `quality-specialist` all run concurrently
- Gate a single "implement valid suggestions" task behind all review completions using `blockedBy`
- This minimizes review cycle time by running 4 reviews concurrently instead of sequentially

```text
[implementation] → [product] [coderabbit] [local] [quality] → [implement suggestions]
                    ↑ all run in parallel ↑                    ↑ blocked by all 4 ↑
```

### Plugin Agent Naming

Plugin agents use colon-separated naming format: `namespace:agent-name`

Examples:
- `coderabbit:code-reviewer` (not `coderabbit`)
- `code-simplifier:code-simplifier` (not `code-simplifier`)

This is a platform convention for spawning plugin agents via the Agent Team API.

## File Operations

### Barrel Export Pre-commit Constraint

Cannot make "deletion-only" commits when barrel exports (index.ts files) reference the deleted files. Pre-commit hooks run lint/typecheck which will fail on broken imports.

Solution: Combine deletion of old file + creation of new file in the same atomic commit.

Example: Deleting `src/utils/fibonacci.ts` alone fails because `src/utils/index.ts` exports `export * from './fibonacci.js'`. Instead, delete the old implementation and add the new implementation in a single commit.

## TDD RED Phase with Deleted Source

When performing TDD RED by deleting the source module, Jest reports **0 tests found** (not N failed) because module-not-found prevents test file parsing entirely — `describe`/`it` blocks never register.

This is expected behavior. Verify RED by confirming either:
- `Tests: 0 total` (test file couldn't parse)
- A module resolution error in Jest output

Do **not** expect N individual test failures when the imported module doesn't exist.

## TDD 3-Commit Deletion Workflow

When replacing a module from scratch via TDD, use exactly 3 atomic commits:

1. **`refactor: remove existing <module>`** — delete source file, remove barrel export from `index.ts`, delete test file
2. **`test: add failing tests for new <module> (TDD RED)`** — write comprehensive tests importing the (non-existent) source directly
3. **`feat: implement new <module> (TDD GREEN)`** — create implementation and re-add barrel export to `index.ts`

This sequence is necessary because:
- Barrel exports must be removed in commit 1 (see [Barrel Export Pre-commit Constraint](#barrel-export-pre-commit-constraint))
- Barrel exports must be re-added in commit 3, not commit 2, since the source file doesn't exist yet during RED phase
- Pre-commit hooks (lint/typecheck) run on every commit and will fail if barrel exports reference missing files

Deviating from this sequence (e.g., deleting source without removing barrel export, or adding barrel export before implementation exists) causes pre-commit hook failures.

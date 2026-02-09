# Project Rules

Project-specific rules and guidelines that apply to this codebase.

Rules in `.claude/rules/` are automatically loaded by Claude Code at session start.
Add project-specific patterns, conventions, and requirements below.

---

## package.json and package.lisa.json Management

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

Never parse JSON in shell scripts using grep/sed/cut/awk - always use jq for robust JSON handling.

When creating Claude Code hooks for enforcement (linting, code quality, static analysis), always use blocking behavior (exit 1 on failures) so Claude receives feedback and can fix the errors. Notification-only hooks (like ntfy.sh) should exit 0 since they don't require Claude to take action.

## Skills and Commands

Skills and commands serve different roles in Claude Code:

- **Skills** (`.claude/skills/<name>/SKILL.md`): Contain implementation logic. Use hyphen-separated naming (e.g., `plan-create`, `git-commit`). Skills do NOT support `argument-hint` or `$ARGUMENTS` substitution.
- **Commands** (`.claude/commands/<namespace>/<name>.md`): User-facing interface with `argument-hint` and `$ARGUMENTS` support. Directory nesting creates colon-separated names in the UI (e.g., `plan/create.md` becomes `/plan:create`). Commands pass through to skills.

Every skill should have a corresponding command that acts as a pass-through. The command provides the user-facing description, argument hints, and delegates to the skill via "Use the /<skill-name> skill... $ARGUMENTS".

Skills can invoke other skills via the Skill tool, enabling skill chaining and composition. Internal skill-to-skill references use hyphen names (e.g., `/git-commit`).

Lisa-specific skills (like `lisa-integration-test`, `lisa-learn`, `lisa-review-project`) should only exist in the root `.claude/skills/` and `.claude/commands/` directories, NOT in `all/copy-overwrite/`, since they are only relevant to the Lisa repository itself, not downstream projects.

## Task Metadata

When creating tasks, do not include `/coding-philosophy` in the `skills` array of task metadata. The coding philosophy is auto-loaded as a rule via `.claude/rules/coding-philosophy.md` and does not need to be explicitly invoked.

# Lisa Architecture

Lisa is a governance framework for AI-assisted software development. It packages project standards, templates, commands, rules, skills, hooks, and verification workflows so AI agents and humans follow the same quality path.

## Core Layers

- Rules: project-wide behavioral and coding conventions loaded into AI sessions.
- Skills: reusable specialized instructions and workflow implementations.
- Commands: lifecycle entry points that route work into repeatable flows.
- Hooks: local enforcement around edits, commits, pushes, and AI actions.
- Template strategies: installation behavior for downstream project files.
- ESLint, ast-grep, Knip, tests, and CI: empirical quality gates.
- GitHub workflows: hosted automation for review, nightly improvements, CI, release, and deployment support.

## Monorepo Shape

Lisa is published as `@codyswann/lisa` and exposes a CLI binary named `lisa`. The repo contains source code in `src/`, workflow and packaging scripts in `scripts/`, stack templates in template-family directories, and workspace packages for custom ESLint plugins.

## Primary Runtime And Tooling

- Bun is the expected package manager.
- TypeScript is the primary language.
- Vitest and Jest configuration templates are both distributed.
- Oxlint, ESLint, ast-grep, Knip, Gitleaks, and coverage gates are part of the quality model.

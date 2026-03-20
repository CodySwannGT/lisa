# Plan: Publish api-creator to npm

## Context

api-creator is a standalone TypeScript CLI tool that reverse-engineers web APIs into typed CLIs. It needs to be published to npm as an open-source package, modeled after Lisa's publishing pipeline (OIDC trusted publishing, standard-version, conventional commits). It is NOT a Lisa-managed project — we're just replicating the publishing pattern.

The unscoped name `api-creator` is already taken on npm. We'll use `@codyswann/api-creator` (same org as `@codyswann/lisa`).

## Files to Modify

- `/Users/cody/workspace/api-creator/package.json` — rename, add metadata, scripts, devDependencies
- `/Users/cody/workspace/api-creator/src/cli.ts` — dynamic version from package.json
- `/Users/cody/workspace/api-creator/README.md` — update install command + npm badge

## Files to Create

- `/Users/cody/workspace/api-creator/.versionrc` — standard-version config
- `/Users/cody/workspace/api-creator/commitlint.config.cjs` — conventional commits
- `/Users/cody/workspace/api-creator/.husky/commit-msg` — commitlint hook
- `/Users/cody/workspace/api-creator/.github/workflows/ci.yml` — PR quality checks
- `/Users/cody/workspace/api-creator/.github/workflows/release.yml` — release + publish pipeline

## Steps

### 1. Update package.json

```json
{
  "name": "@codyswann/api-creator",
  "version": "0.1.0",
  "description": "Reverse-engineer any web API into a typed CLI by recording real browser traffic",
  "type": "module",
  "main": "./dist/cli.js",
  "bin": {
    "api-creator": "./bin/api-creator.js"
  },
  "files": ["dist", "bin"],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/CodySwannGT/api-creator.git"
  },
  "homepage": "https://github.com/CodySwannGT/api-creator#readme",
  "bugs": { "url": "https://github.com/CodySwannGT/api-creator/issues" },
  "author": "Cody Swann",
  "license": "MIT",
  "keywords": ["api", "cli", "har", "typescript", "code-generator", "reverse-engineering", "playwright"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "dev": "tsup --watch",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run build",
    "prepare": "husky install || true"
  }
}
```

Add devDependencies: `standard-version`, `@commitlint/cli`, `@commitlint/config-conventional`, `husky`.

### 2. Fix version sync in src/cli.ts

Replace hardcoded `.version('0.1.0')` with dynamic version read from package.json:

```typescript
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

program.version(version);
```

### 3. Create .versionrc

Same as Lisa's but without the `postbump` script (no plugins to rebuild):

```json
{
  "types": [
    { "type": "feat", "section": "Features" },
    { "type": "fix", "section": "Bug Fixes" },
    { "type": "chore", "hidden": true },
    { "type": "docs", "section": "Documentation" },
    { "type": "style", "hidden": true },
    { "type": "refactor", "section": "Code Refactoring" },
    { "type": "perf", "section": "Performance Improvements" },
    { "type": "test", "hidden": true }
  ],
  "bumpFiles": [
    { "filename": "package.json", "type": "json" }
  ]
}
```

### 4. Create commitlint.config.cjs

```javascript
module.exports = {
  extends: ["@commitlint/config-conventional"],
};
```

### 5. Set up husky + commit-msg hook

- Run `npx husky install`
- Create `.husky/commit-msg` with `npx commitlint --edit $1`

### 6. Create .github/workflows/ci.yml

PR quality checks: build, typecheck, test. Runs on `pull_request`. Uses Node 22 + npm.

### 7. Create .github/workflows/release.yml

Combined release + publish workflow (simpler than Lisa's 3-file approach since this is a small project):

1. **Release job** (on push to main, skip `[skip ci]`):
   - npm ci, build, test
   - standard-version to bump, changelog, tag
   - git push --follow-tags
2. **Publish job** (needs release, OIDC trusted publishing):
   - Wait for tag propagation
   - OIDC token via `actions/github-script@v7`
   - `npm publish --access public --provenance`

Pattern copied directly from Lisa's `publish-to-npm.yml`.

### 8. Update README.md

- Install command: `npm install -g @codyswann/api-creator`
- Add npm version badge

## Bootstrap: First Publish

OIDC trusted publishing requires the package to exist on npm first. For the initial publish:

1. Build locally: `npm run build`
2. Publish manually: `npm publish --access public`
3. Configure OIDC trusted publishing on npmjs.com:
   - Package: `@codyswann/api-creator`
   - Repository: `CodySwannGT/api-creator`
   - Workflow: `release.yml`

After this one-time setup, all subsequent releases are fully automated via GitHub Actions.

## Verification

1. `npm run build` succeeds
2. `npm run test` passes (66 tests)
3. `npm run typecheck` passes
4. `npm pack --dry-run` shows only dist/, bin/, LICENSE, README.md, package.json
5. `npx commitlint --from HEAD~1` validates commit messages
6. Manual `npm publish --access public` succeeds for initial publish
7. After OIDC setup: push to main triggers automated release + publish

# Fix ZAP Commit + tsconfig Paths Restoration

## Summary

Two issues on branch `fix/tsconfig-eslint-jest-include`:
1. Untracked ZAP files need to be committed with `serve` devDependency added for expo
2. `@/*` paths mapping dropped from tsconfig chain for existing projects — must move to copy-overwrite stack configs

---

## Commit 1: `feat: add OWASP ZAP baseline scanning for expo and nestjs stacks`

### Modify before staging

**`expo/package-lisa/package.lisa.json`** — Add `serve` to `force.devDependencies`:
```json
"serve": "^14.2.0"
```
(Insert after `"jest-expo"` entry, alphabetical position in `s`)

### Stage all ZAP-related files

New (untracked):
- `expo/copy-overwrite/.github/workflows/zap-baseline.yml`
- `expo/copy-overwrite/.zap/baseline.conf`
- `expo/copy-overwrite/scripts/zap-baseline.sh`
- `expo/copy-overwrite/.claude/skills/owasp-zap/SKILL.md`
- `nestjs/copy-overwrite/.github/workflows/zap-baseline.yml`
- `nestjs/copy-overwrite/.zap/baseline.conf`
- `nestjs/copy-overwrite/scripts/zap-baseline.sh`
- `typescript/copy-overwrite/.claude/commands/security/zap-scan.md`

Modified (tracked):
- `all/copy-contents/.gitignore`
- `expo/create-only/.github/workflows/ci.yml`
- `nestjs/create-only/.github/workflows/ci.yml`
- `expo/package-lisa/package.lisa.json`
- `nestjs/package-lisa/package.lisa.json`
- `typescript/copy-overwrite/.github/workflows/quality.yml`

---

## Commit 2: `fix: move paths and include/exclude to copy-overwrite stack tsconfigs`

### File changes

**`expo/copy-overwrite/tsconfig.expo.json`** — Add `paths` to compilerOptions:
```json
{
  "extends": ["expo/tsconfig.base", "./tsconfig.base.json"],
  "compilerOptions": {
    "strict": true,
    "jsx": "react-native",
    "baseUrl": "./",
    "paths": {
      "@/*": ["./*"]
    },
    "moduleSuffixes": [".ios", ".android", ".native", ".web", ""]
  }
}
```

**`nestjs/copy-overwrite/tsconfig.nestjs.json`** — Add `paths` to compilerOptions:
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2021",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "declaration": true,
    "sourceMap": true,
    "outDir": ".build",
    "baseUrl": "./",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

**`expo/copy-overwrite/tsconfig.json`** — Add `include` and `exclude`:
```json
{
  "extends": ["./tsconfig.expo.json", "./tsconfig.local.json"],
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", "dist", "web-build"]
}
```

**`expo/create-only/tsconfig.local.json`** — Remove paths/include/exclude (now in copy-overwrite):
```json
{
  "compilerOptions": {}
}
```

### Why this works

- Stack hierarchy: expo/nestjs inherit `tsconfig.base.json` from typescript parent (copy-overwrite, always applied)
- `paths` in stack configs (copy-overwrite) ensures every Lisa run restores them for existing projects
- `tsconfig.local.json` (create-only) remains as an override point — projects can still customize paths there since later extends entries win
- NestJS uses `@/* -> ./src/*` (rootDir is src); Expo uses `@/* -> ./*` (project root)

---

## Verification

```bash
# After both commits
bun run typecheck    # Lisa's own TS compiles
bun run test         # Tests pass
bun run lint         # No lint violations
git log --oneline -2 # Both commits present with correct messages
git show --stat HEAD~1 # Commit 1: ~14 files
git show --stat HEAD   # Commit 2: 4 files
```

---

## Skills

- `/git-commit` for creating conventional commits
- `/jsdoc-best-practices` — not applicable (JSON/YAML/shell changes only)

## Task parallelism

Both commits are sequential (commit 1 first, then commit 2). Within each commit, file edits can be done in parallel.

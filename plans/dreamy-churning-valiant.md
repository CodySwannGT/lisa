# Publish ESLint Plugins as Scoped npm Packages

## Context

Lisa currently copies three custom ESLint plugins verbatim into every downstream project via `copy-overwrite`. This pollutes project root directories with `eslint-plugin-*/` folders, uses fragile `file:./` devDependency references, and silently overwrites files the project appears to own. The goal is to publish these plugins as proper `@codyswann/` scoped npm packages so downstream projects install them like any other devDependency — no local directories, no file references.

**Three plugins:**
- `eslint-plugin-code-organization` — TypeScript/all stacks (1 rule: `enforce-statement-order`)
- `eslint-plugin-component-structure` — Expo only (4 rules)
- `eslint-plugin-ui-standards` — Expo only (2 rules)

**Published names:**
- `@codyswann/eslint-plugin-code-organization`
- `@codyswann/eslint-plugin-component-structure`
- `@codyswann/eslint-plugin-ui-standards`

**Key insight on publish pipeline:** Lisa already has a `publish-to-npm.yml` reusable workflow using OIDC trusted publishing (`npm publish --access public --provenance`). The plugin packages are pure CommonJS JS with no build step — they can be published from the same workflow with additional `cd <plugin-dir> && npm publish` steps.

---

## Implementation Steps

### Step 1 — Move expo plugins to Lisa root

`eslint-plugin-component-structure` and `eslint-plugin-ui-standards` currently only exist in `expo/copy-overwrite/`. Move them to the Lisa root alongside `eslint-plugin-code-organization` so all three plugins live at root level — the canonical source of truth.

```
eslint-plugin-code-organization/     ← already here (source)
eslint-plugin-component-structure/   ← move from expo/copy-overwrite/
eslint-plugin-ui-standards/          ← move from expo/copy-overwrite/
```

### Step 2 — Update each plugin's package.json

For all three root-level plugins, remove `"private": true`, add scoped name, add `publishConfig`:

```json
{
  "name": "@codyswann/eslint-plugin-code-organization",
  "version": "1.0.0",
  "description": "ESLint plugin for code organization standards",
  "main": "index.js",
  "publishConfig": { "access": "public" },
  "peerDependencies": { "eslint": ">=9.0.0" }
}
```

Apply same pattern to `component-structure` and `ui-standards` with their respective names.

### Step 3 — Update ESLint config imports (two files)

**`typescript/copy-overwrite/eslint.typescript.ts`** — change relative require to package name:
```typescript
// Before
const codeOrganization = require("./eslint-plugin-code-organization/index.js");
// After
const codeOrganization = require("@codyswann/eslint-plugin-code-organization");
```

**`expo/copy-overwrite/eslint.expo.ts`** — same for both expo plugins:
```typescript
// Before
const componentStructure = require("./eslint-plugin-component-structure/index.js");
const uiStandards = require("./eslint-plugin-ui-standards/index.js");
// After
const componentStructure = require("@codyswann/eslint-plugin-component-structure");
const uiStandards = require("@codyswann/eslint-plugin-ui-standards");
```

Also update **`eslint.typescript.ts`** at Lisa root (Lisa's own ESLint config, not the template) with the same change.

### Step 4 — Update package.lisa.json templates

**`typescript/package-lisa/package.lisa.json`** — update `force.devDependencies`:
```json
"@codyswann/eslint-plugin-code-organization": "^1.0.0"
```
(Remove the old `"eslint-plugin-code-organization": "file:./eslint-plugin-code-organization"` entry)

**`expo/package-lisa/package.lisa.json`** — same for both expo plugins:
```json
"@codyswann/eslint-plugin-component-structure": "^1.0.0",
"@codyswann/eslint-plugin-ui-standards": "^1.0.0"
```

### Step 5 — Update Lisa root package.json

- `devDependencies`: change `"eslint-plugin-code-organization": "file:./eslint-plugin-code-organization"` → `"@codyswann/eslint-plugin-code-organization": "^1.0.0"`
- `files` array: remove `"eslint-plugin-code-organization"` (no longer ships inside the Lisa package — it's a separate published package)
- Run `bun install` to regenerate the lockfile

### Step 6 — Delete copy-overwrite plugin directories

Remove the plugin directories from copy-overwrite (they are no longer deployed as files):
- `typescript/copy-overwrite/eslint-plugin-code-organization/` — delete entire directory
- `expo/copy-overwrite/eslint-plugin-component-structure/` — delete entire directory
- `expo/copy-overwrite/eslint-plugin-ui-standards/` — delete entire directory

### Step 7 — Update deletions.json for downstream cleanup

When downstream projects run `lisa:update`, the old local plugin directories must be deleted. Both files already exist — add new entries:

**`typescript/deletions.json`** — add `"eslint-plugin-code-organization"` to the `paths` array.

**`expo/deletions.json`** — add `"eslint-plugin-component-structure"` and `"eslint-plugin-ui-standards"` to the `paths` array.

NestJS and CDK inherit from the typescript stack (confirmed in `src/detection/index.ts`: "Child types automatically include their parent"), so `typescript/deletions.json` covers them — no separate entries needed.

### Step 8 — Update .lisa-manifest

Remove the five `eslint-plugin-code-organization` entries from `.lisa-manifest`:
```
copy-overwrite:eslint-plugin-code-organization/README.md
copy-overwrite:eslint-plugin-code-organization/__tests__/enforce-statement-order.test.js
copy-overwrite:eslint-plugin-code-organization/index.js
copy-overwrite:eslint-plugin-code-organization/package.json
copy-overwrite:eslint-plugin-code-organization/rules/enforce-statement-order.js
```

### Step 9 — Update publish-to-npm.yml template to publish plugin packages

The template source is `npm-package/copy-overwrite/.github/workflows/publish-to-npm.yml` (confirmed via `.lisa-manifest`). This template is deployed to all npm-package projects — so plugin publish steps must use existence checks so they are no-ops in other projects.

Add three steps after the main `Publish to npm with OIDC` step, each gated with `if: hashFiles('eslint-plugin-*/package.json') != ''`:

```yaml
- name: Publish @codyswann/eslint-plugin-code-organization
  if: ${{ hashFiles('eslint-plugin-code-organization/package.json') != '' }}
  run: |
    cd eslint-plugin-code-organization
    npm version ${{ inputs.version }} --no-git-tag-version --allow-same-version
    npm publish --access public --provenance

- name: Publish @codyswann/eslint-plugin-component-structure
  if: ${{ hashFiles('eslint-plugin-component-structure/package.json') != '' }}
  run: |
    cd eslint-plugin-component-structure
    npm version ${{ inputs.version }} --no-git-tag-version --allow-same-version
    npm publish --access public --provenance

- name: Publish @codyswann/eslint-plugin-ui-standards
  if: ${{ hashFiles('eslint-plugin-ui-standards/package.json') != '' }}
  run: |
    cd eslint-plugin-ui-standards
    npm version ${{ inputs.version }} --no-git-tag-version --allow-same-version
    npm publish --access public --provenance
```

Plugin versions mirror the Lisa release version (same `npm version` step the main publish uses). This ensures plugins are always published at a version that matches the Lisa release that introduced the corresponding eslint config changes. The `package.lisa.json` uses `"^1.0.0"` — the `^` range picks up all compatible future versions automatically on `bun install`.

Auth is inherited from the OIDC setup earlier in the job (the `~/.npmrc` is already configured by the time these steps run).

### Step 10 — Update lisa.md template

**`all/copy-overwrite/.claude/rules/lisa.md`** — remove `eslint-plugin-code-organization/*` from the "no local override" list and add a note that plugins are published npm packages (`@codyswann/eslint-plugin-*`), not local directories.

---

## Verification

```bash
# 1. Verify plugins no longer exist in copy-overwrite
ls typescript/copy-overwrite/ | grep eslint-plugin  # should show nothing
ls expo/copy-overwrite/ | grep eslint-plugin         # should show nothing

# 2. Verify plugins exist at root with updated package.json
cat eslint-plugin-code-organization/package.json | grep name    # @codyswann/...
cat eslint-plugin-component-structure/package.json | grep name  # @codyswann/...
cat eslint-plugin-ui-standards/package.json | grep name         # @codyswann/...

# 3. Verify eslint configs use package names
grep "eslint-plugin" typescript/copy-overwrite/eslint.typescript.ts  # @codyswann/...
grep "eslint-plugin" expo/copy-overwrite/eslint.expo.ts              # @codyswann/...

# 4. Verify package.lisa.json references npm packages
grep "eslint-plugin" typescript/package-lisa/package.lisa.json  # @codyswann/...
grep "eslint-plugin" expo/package-lisa/package.lisa.json        # @codyswann/...

# 5. Verify deletions.json entries exist
cat typescript/deletions.json
cat expo/deletions.json

# 6. Run quality checks
bun run typecheck && bun run lint && bun run test
```

---

## Critical Files

| File | Change |
|---|---|
| `eslint-plugin-code-organization/package.json` | Remove private, add `@codyswann/` name, add publishConfig |
| `eslint-plugin-component-structure/package.json` | Move from expo/copy-overwrite/ + same updates |
| `eslint-plugin-ui-standards/package.json` | Move from expo/copy-overwrite/ + same updates |
| `typescript/copy-overwrite/eslint.typescript.ts` | `require` path → `@codyswann/eslint-plugin-code-organization` |
| `eslint.typescript.ts` (root) | Same require path update |
| `expo/copy-overwrite/eslint.expo.ts` | Two `require` paths → `@codyswann/` scoped names |
| `typescript/package-lisa/package.lisa.json` | `file:./` ref → `@codyswann/eslint-plugin-code-organization: ^1.0.0` |
| `expo/package-lisa/package.lisa.json` | Two `file:./` refs → scoped npm refs |
| `package.json` (root) | devDeps + files array |
| `typescript/copy-overwrite/eslint-plugin-code-organization/` | Delete entire directory |
| `expo/copy-overwrite/eslint-plugin-component-structure/` | Delete entire directory |
| `expo/copy-overwrite/eslint-plugin-ui-standards/` | Delete entire directory |
| `typescript/deletions.json` | Create/update with plugin dir deletion |
| `expo/deletions.json` | Create/update with plugin dir deletions |
| `.lisa-manifest` | Remove 5 eslint-plugin-code-organization entries |
| `npm-package/copy-overwrite/.github/workflows/publish-to-npm.yml` | Add 3 conditional plugin publish steps |
| `all/copy-overwrite/.claude/rules/lisa.md` | Update documentation |

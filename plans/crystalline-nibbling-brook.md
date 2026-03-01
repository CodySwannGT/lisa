# Migrate frontend-v2 to Lisa 1.49.x (postinstall-driven)

## Context

The goal is a one-step migration: add `@codyswann/lisa` as a devDependency, run `bun install`, and the `postinstall` script handles everything — no separate `lisa:update` run required.

Lisa 1.49.0's `postinstall` (`scripts/install-claude-plugins.sh`) only installs Claude plugins. It needs two additions before frontend-v2 can be migrated:
1. **Run `lisa --yes .`** as the first step — this applies all template changes (deletions, merges, copy-overwrites) non-interactively via the `-y` flag that the Lisa CLI already supports.
2. **Strip the `hooks` key from `.claude/settings.json`** after `lisa .` runs — the merge strategy (lodash.merge) never removes keys, so the `hooks` key from the project's existing settings.json persists even though all referenced hook scripts are deleted via `deletions.json`. This must be cleaned up programmatically.

Also, the version pinned in `*/package-lisa/package.lisa.json` force.devDependencies is `"^1.48.0"` — needs to be `"^1.49.0"`. And `lisa:update` in templates should use the local binary (`lisa .`) rather than `npx @codyswann/lisa@latest .`.

**Current state of frontend-v2 (Lisa v1.46.4):**
- Expo stack
- Has `CLAUDE.md`, `HUMAN.md`, `.claude/README.md`, `.claude/rules/lisa.md` (all to be deleted)
- Has 13 hook scripts in `.claude/hooks/` (all in `all/deletions.json`)
- `.claude/settings.json` has full `hooks` key (must be stripped — no hook scripts will exist after update)
- Missing `expo@lisa`, `sentry@claude-plugins-official`, `extraKnownMarketplaces` in settings.json
- Missing `@codyswann/lisa` in devDependencies and trustedDependencies

---

## Phase 1 — Fix Lisa's postinstall (new commit on main)

### 1a. Update `scripts/install-claude-plugins.sh`

**File**: `scripts/install-claude-plugins.sh`

Add two blocks between the `cd "$PROJECT_ROOT"` line and the marketplace registration:

```bash
# Apply Lisa templates non-interactively
node "$LISA_DIR/dist/index.js" --yes "$PROJECT_ROOT" || true

# Strip the hooks key from .claude/settings.json if .claude/hooks/ is now empty/absent
# (hooks moved to plugin.json; all .claude/hooks/*.sh scripts are deleted by lisa update)
SETTINGS_FILE="$PROJECT_ROOT/.claude/settings.json"
HOOKS_DIR="$PROJECT_ROOT/.claude/hooks"
if [ -f "$SETTINGS_FILE" ] && command -v python3 >/dev/null 2>&1; then
  if [ ! -d "$HOOKS_DIR" ] || [ -z "$(ls -A "$HOOKS_DIR" 2>/dev/null)" ]; then
    python3 - "$SETTINGS_FILE" <<'PYEOF'
import json, sys
path = sys.argv[1]
with open(path) as f:
    d = json.load(f)
if "hooks" in d:
    del d["hooks"]
    with open(path, "w") as f:
        json.dump(d, f, indent=2)
        f.write("\n")
PYEOF
  fi
fi
```

**Ordering**: `lisa --yes .` runs first (so `expo@lisa` gets added to settings.json before plugin detection), then hooks cleanup, then marketplace registration + plugin install.

### 1b. Update devDependency version in package-lisa templates

**Files**: `typescript/package-lisa/package.lisa.json`, `expo/package-lisa/package.lisa.json`, `nestjs/package-lisa/package.lisa.json`, `cdk/package-lisa/package.lisa.json`

Change `"@codyswann/lisa": "^1.48.0"` → `"@codyswann/lisa": "^1.49.0"` in each file's `force.devDependencies`.

### 1c. Update `lisa:update` script in template

**File**: `typescript/package-lisa/package.lisa.json` (force.scripts)

Change:
```json
"lisa:update": "npx @codyswann/lisa@latest ."
```
to:
```json
"lisa:update": "lisa ."
```

This uses the locally pinned devDependency instead of always fetching latest.

### 1d. Commit, bump version to 1.49.1, publish

```bash
git add scripts/install-claude-plugins.sh typescript/package-lisa/package.lisa.json \
        expo/package-lisa/package.lisa.json nestjs/package-lisa/package.lisa.json \
        cdk/package-lisa/package.lisa.json
git commit -m "feat: run lisa update and strip hooks in postinstall; bump devDep to ^1.49.0"
# bump version to 1.49.1 and publish
```

---

## Phase 2 — Migrate frontend-v2

With Phase 1 published as 1.49.1, the migration is a single `bun install`.

### 2a. Add `@codyswann/lisa` to devDependencies in frontend-v2

**File**: `package.json` (in frontend-v2 project root)

Add to `devDependencies`:
```json
"@codyswann/lisa": "^1.49.0"
```

### 2b. Run `bun install`

```bash
cd <frontend-v2-project-root>
bun install
```

The `postinstall` script now does everything in order:
1. `node dist/index.js --yes .` — applies all template changes:
   - Deletes: `CLAUDE.md`, `HUMAN.md`, `.claude/README.md`, `.claude/rules/lisa.md`, all `.claude/hooks/*.sh`
   - Deep-merges settings.json: adds `expo@lisa`, `sentry`, `extraKnownMarketplaces`
   - Adds `@codyswann/lisa` to `devDependencies` + `trustedDependencies` in package.json
   - Updates `lisa:update` script to `"lisa ."`
   - Applies all other copy-overwrite updates
2. Strips `hooks` from settings.json (`.claude/hooks/` is now empty)
3. Registers Lisa marketplace
4. Installs `expo@lisa` + 7 third-party Claude plugins

### 2c. Commit

```bash
cd <frontend-v2-project-root>
git add -A
git commit -m "chore: add @codyswann/lisa devDep, migrate to v1.49.1 via postinstall"
```

---

## Critical Files

| File | Change |
|------|--------|
| `scripts/install-claude-plugins.sh` | Add `lisa --yes .` + hooks cleanup before plugin install |
| `typescript/package-lisa/package.lisa.json` | `^1.48.0` → `^1.49.0`; `lisa:update` → `"lisa ."` |
| `expo/package-lisa/package.lisa.json` | `^1.48.0` → `^1.49.0` |
| `nestjs/package-lisa/package.lisa.json` | `^1.48.0` → `^1.49.0` |
| `cdk/package-lisa/package.lisa.json` | `^1.48.0` → `^1.49.0` |
| `frontend-v2/package.json` | Add `"@codyswann/lisa": "^1.49.0"` to devDependencies |

---

## Verification

After `bun install` in frontend-v2:

```bash
cd <frontend-v2-project-root>

# Deleted files are gone
test ! -f CLAUDE.md && echo "✓ CLAUDE.md deleted"
test ! -f HUMAN.md && echo "✓ HUMAN.md deleted"
test ! -f .claude/rules/lisa.md && echo "✓ lisa.md deleted"
test ! -d .claude/hooks && echo "✓ .claude/hooks/ deleted"

# settings.json correct
node -e "const s=require('./.claude/settings.json'); console.assert(!s.hooks,'hooks not stripped'); console.assert(s.enabledPlugins['expo@lisa'],'expo@lisa missing'); console.assert(s.extraKnownMarketplaces,'marketplace missing'); console.log('✓ settings.json correct')"

# @codyswann/lisa installed
node -e "const p=require('./package.json'); console.assert(p.devDependencies['@codyswann/lisa'],'missing devDep'); console.log('✓ devDep present:', p.devDependencies['@codyswann/lisa'])"
test -d node_modules/@codyswann/lisa && echo "✓ node_modules/@codyswann/lisa exists"
```

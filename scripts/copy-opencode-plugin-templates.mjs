#!/usr/bin/env node
/**
 * Copy OpenCode plugin templates next to the compiled OpenCode hooks installer.
 *
 * `src/opencode/plugin-templates/*.ts` are NOT app source — they run under
 * OpenCode's Bun runtime inside a host project's `.opencode/plugin/`, so they
 * are excluded from this repo's tsconfig (tsc never emits them). The installer
 * (`dist/opencode/hooks-installer.js`) copies them verbatim into a host project
 * at install time, resolving them from `dist/opencode/plugin-templates/`. This
 * step puts the source `.ts` files there. Mirrors `copy-codex-scripts.mjs`.
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourceDir = path.join(repoRoot, "src", "opencode", "plugin-templates");
const destDir = path.join(repoRoot, "dist", "opencode", "plugin-templates");

fs.rmSync(destDir, { recursive: true, force: true });
fs.mkdirSync(destDir, { recursive: true });

for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".ts")) {
    continue;
  }
  const sourcePath = path.join(sourceDir, entry.name);
  const destPath = path.join(destDir, entry.name);
  fs.copyFileSync(sourcePath, destPath);
}

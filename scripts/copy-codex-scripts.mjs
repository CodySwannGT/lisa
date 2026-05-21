#!/usr/bin/env node
/**
 * Copy shell hook scripts next to the compiled Codex hook installer.
 *
 * TypeScript compilation emits `dist/codex/hooks-installer.js`, whose runtime
 * resolver looks for scripts in `dist/codex/scripts/`. The source scripts are
 * plain shell files, so tsc does not copy them.
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourceDir = path.join(repoRoot, "src", "codex", "scripts");
const destDir = path.join(repoRoot, "dist", "codex", "scripts");

fs.rmSync(destDir, { recursive: true, force: true });
fs.mkdirSync(destDir, { recursive: true });

for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
  if (!entry.isFile()) {
    continue;
  }

  const sourcePath = path.join(sourceDir, entry.name);
  const destPath = path.join(destDir, entry.name);
  fs.copyFileSync(sourcePath, destPath);
  fs.chmodSync(destPath, 0o755);
}

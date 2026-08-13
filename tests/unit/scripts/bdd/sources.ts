/**
 * Helpers for the cases that assert on the gate's SOURCE and on how it behaves
 * once vendored into an adopter's `scripts/` directory.
 *
 * Kept apart from `support.ts`, which is about laying down fixture projects.
 *
 * @module tests/unit/scripts/bdd/sources
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { REPO_ROOT, read } from "./support";

/** Template directories the gate is vendored from. */
export const GATE_DIR = "expo/copy-overwrite/scripts";
export const SHARED_DIR = "all/copy-overwrite/scripts";

/**
 * A source file with its block comments stripped.
 *
 * A source-shape assertion must be about the CODE: prose that quotes the shape
 * it forbids would otherwise fail the check, and prose that quotes the shape it
 * requires would satisfy it without any code doing so.
 * @param relativePath - Repo-relative path.
 * @returns The file's code, comments removed.
 */
export function sourceCode(relativePath: string): string {
  return read(relativePath).replace(/\/\*[\s\S]*?\*\//gu, "");
}

/**
 * Copy the gate into an adopter-shaped `scripts/` directory, deliberately
 * WITHOUT `scripts/schemas/` — what a half-finished copy leaves behind.
 * @param project - Fixture project root.
 * @returns The scripts directory.
 */
export function vendorGateWithoutSchemas(project: string): string {
  // The real path, because the gate's own entry guard compares `process.argv[1]`
  // against `import.meta.url`, and macOS `os.tmpdir()` is a symlink — passing
  // the symlinked spelling makes Node's `main` block never run at all.
  const scripts = path.join(fs.realpathSync(project), "scripts");
  fs.mkdirSync(path.join(scripts, "bdd"), { recursive: true });
  for (const name of fs.readdirSync(path.join(REPO_ROOT, GATE_DIR))) {
    const from = path.join(REPO_ROOT, GATE_DIR, name);
    if (fs.statSync(from).isFile()) {
      fs.copyFileSync(from, path.join(scripts, name));
    }
  }
  for (const name of fs.readdirSync(path.join(REPO_ROOT, GATE_DIR, "bdd"))) {
    fs.copyFileSync(
      path.join(REPO_ROOT, GATE_DIR, "bdd", name),
      path.join(scripts, "bdd", name)
    );
  }
  for (const name of [
    "lisa-command-envelope.mjs",
    "lisa-schema-validate.mjs",
  ]) {
    fs.copyFileSync(
      path.join(REPO_ROOT, SHARED_DIR, name),
      path.join(scripts, name)
    );
  }
  return scripts;
}

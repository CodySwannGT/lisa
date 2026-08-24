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
  // The real path. The gate's entry guard now realpaths `process.argv[1]`
  // itself, so the symlinked spelling of macOS `os.tmpdir()` no longer makes
  // `main` silently never run — but the fixture keeps resolving it, so a
  // regression in the guard shows up as the guard's own test failing rather
  // than as this whole suite going quiet.
  const scripts = path.join(fs.realpathSync(project), "scripts");
  fs.mkdirSync(path.join(scripts, "bdd"), { recursive: true });
  fs.mkdirSync(path.join(scripts, "lib"), { recursive: true });
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
  // EVERY shared module under `lib/`, which the vendored entry points import.
  // Copied for the same reason the modules below are: this fixture models a
  // copy missing `scripts/schemas/`, not one missing code.
  //
  // A directory read, not a named file. This copied `invoked-as-script.mjs`
  // alone and therefore stopped honouring its own stated intent the moment a
  // vendored entry point imported a second shared module
  // (CodySwannGT/lisa#2980) — the gate then died on ERR_MODULE_NOT_FOUND before
  // reaching the readable-envelope path, so the case asserting "no raw stack"
  // failed with a raw stack, about a file the fixture chose not to copy.
  for (const name of fs.readdirSync(path.join(REPO_ROOT, SHARED_DIR, "lib"))) {
    const from = path.join(REPO_ROOT, SHARED_DIR, "lib", name);
    if (fs.statSync(from).isFile()) {
      fs.copyFileSync(from, path.join(scripts, "lib", name));
    }
  }
  // The envelope's own code dependencies. `lisa-destructive-guard.mjs` is a
  // HARD dependency deliberately: it carries the production refusal, and an
  // envelope that degraded gracefully when the guard was missing would turn a
  // half-finished copy into a silently unguarded one. This fixture models a
  // copy missing `scripts/schemas/`, not one missing modules.
  for (const name of [
    "lisa-command-envelope.mjs",
    "lisa-destructive-guard.mjs",
    "lisa-schema-validate.mjs",
  ]) {
    fs.copyFileSync(
      path.join(REPO_ROOT, SHARED_DIR, name),
      path.join(scripts, name)
    );
  }
  return scripts;
}

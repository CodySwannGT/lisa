/**
 * Plain folders holding the files that define a repository's checks, for
 * the suites that take a digest of them.
 *
 * None of these folders is a git repository. The digest is taken from
 * content alone, and a suite that builds its cases without git is the proof
 * that nothing else is read.
 * @module tests/unit/controls/support/binding-folders
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { canonicalText } from "../../../../src/controls/canonical-json.js";

/** The file that declares the checks. */
export const DECLARATION = ".lisa.config.json";

/** A proof's violating change. */
export const VIOLATION_PATCH = ".lisa/controls/proofs/lint.violation.patch";

/** A proof's clean change. */
export const CLEAN_PATCH = ".lisa/controls/proofs/lint.clean.patch";

/** The record of the files Lisa placed. */
export const RECORD = ".lisa/controls/carriers.json";

/** The hook script git runs at commit. */
export const COMMIT_HOOK = ".lisa/hooks/pre-commit";

/** The gate runner's entry file. */
export const RUNNER = "scripts/lisa-run-gates.mjs";

/** A file the record lists that is in none of the usual places. */
export const PLACED = "tools/placed.sh";

/** The gates block the sample declaration holds. */
export const GATES = { "code-style": { commit: "required" } };

const folders: string[] = [];

/**
 * Make an empty folder that {@link removeFolders} removes.
 * @returns Its real path
 */
export function emptyFolder(): string {
  const folder = realpathSync(mkdtempSync(path.join(tmpdir(), "lisa-bind-")));
  folders.push(folder);
  return folder;
}

/** Remove every folder a case made. */
export function removeFolders(): void {
  folders.splice(0).forEach(folder => {
    rmSync(folder, { force: true, maxRetries: 10, recursive: true });
  });
}

/**
 * Write a file, making its folder first.
 * @param root - The folder
 * @param file - The file, from that folder
 * @param content - What it holds
 */
export function put(root: string, file: string, content: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
}

/**
 * The declaration file's content for a gates block and any other settings.
 * @param gates - The gates block
 * @param others - Other top-level settings
 * @returns The file's content
 */
export function declarationOf(
  gates: unknown,
  others: Readonly<Record<string, unknown>> = {}
): string {
  return `${JSON.stringify({ ...others, gates }, null, 2)}\n`;
}

/**
 * The record's content for a list of placed files.
 * @param files - The files it lists
 * @returns The file's content
 */
export function recordOf(files: readonly string[]): string {
  return `${JSON.stringify({ files, schema_version: 1 }, null, 2)}\n`;
}

/** What a folder with every kind of covered file holds. */
export const DEFINING_FILES: Readonly<Record<string, string>> = {
  [DECLARATION]: declarationOf(GATES, { harness: "claude" }),
  [VIOLATION_PATCH]: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n",
  [CLEAN_PATCH]: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+c\n",
  [RECORD]: recordOf([COMMIT_HOOK, RUNNER, PLACED]),
  [COMMIT_HOOK]: "#!/bin/sh\nexec node scripts/lisa-run-gates.mjs\n",
  [RUNNER]: "console.log('gates');\n",
  [PLACED]: "#!/bin/sh\nexit 0\n",
};

/**
 * Make a folder that holds every kind of file that defines the checks, and
 * two files that do not.
 * @param change - Files to write differently, or beside the usual ones
 * @returns The folder's real path
 */
export function definingFolder(
  change: Readonly<Record<string, string>> = {}
): string {
  const root = emptyFolder();
  Object.entries({
    ...DEFINING_FILES,
    "src/app.py": "print('hello')\n",
    Makefile: "lint:\n\ttrue\n",
    ...change,
  }).forEach(([file, content]) => {
    put(root, file, content);
  });
  return root;
}

/**
 * The SHA-256 digest of some text.
 * @param content - The text
 * @returns The digest, in lower-case hexadecimal
 */
export function sha256Of(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * The digest the binding gives a gates block.
 * @param gates - The block
 * @returns The digest of the block in canonical form
 */
export function gatesDigestOf(gates: unknown): string {
  return sha256Of(canonicalText({ gates }));
}

/**
 * Pins where the managed-file guard reads the Lisa-owned hash ledger from.
 *
 * Since CodySwannGT/lisa#4929 the ledger ships as JSON
 * (`dist/core/lisa-owned-hash-ledger.json`). A host may still have an older
 * package installed whose ledger lives inside the compiled module
 * (`dist/core/lisa-owned-hash-ledger.js`). The guard reads whichever exists,
 * and the refusal it gives a tracked file ("Kept yours") depends on that read.
 * @module tests/unit/hooks/block-managed-file-edits-ledger-fallback
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

const GUARD = path.resolve(
  __dirname,
  "../../../plugins/src/base/hooks/block-managed-file-edits.sh"
);
const BASH = "/bin/bash";
const TRACKED = "scripts/classify-maestro-failures.mjs";
const PACKAGE = "node_modules/@codyswann/lisa";
const TRACKED_VERDICT = "Kept yours";
const UNTRACKED_VERDICT = "Out of date";

let project: string;

/**
 * The guard's refusal text for a write to one managed file.
 * @param filePath - Project-relative target
 * @returns The guard's stderr
 */
function refusalFor(filePath: string): string {
  try {
    boundedExecFileSync({
      label: "block-managed-file-edits.sh",
      command: BASH,
      args: [GUARD],
      input: JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: filePath },
      }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: project },
      stdio: "pipe",
    });
    return "";
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? "");
  }
}

/**
 * Writes one file under the fixture's installed package.
 * @param relative - Path inside the package
 * @param body - File contents
 */
function packageFile(relative: string, body: string): void {
  const target = path.join(project, PACKAGE, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, body);
}

beforeEach(() => {
  project = mkdtempSync(path.join(tmpdir(), "lisa-guard-ledger-"));
  packageFile(`all/copy-overwrite/${TRACKED}`, "x");
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe("block-managed-file-edits ledger lookup", () => {
  it("reads the JSON ledger a current package ships", () => {
    packageFile(
      "dist/core/lisa-owned-hash-ledger.json",
      JSON.stringify({ LISA_OWNED_HASH_LEDGER: { [TRACKED]: [] } })
    );
    expect(refusalFor(TRACKED)).toContain(TRACKED_VERDICT);
  });

  it("falls back to an older package's compiled .js ledger", () => {
    packageFile(
      "dist/core/lisa-owned-hash-ledger.js",
      `export const LISA_OWNED_HASH_LEDGER = Object.freeze({\n  "${TRACKED}": [],\n});\n`
    );
    expect(refusalFor(TRACKED)).toContain(TRACKED_VERDICT);
  });

  it("treats a file neither ledger names as untracked", () => {
    packageFile(
      "dist/core/lisa-owned-hash-ledger.js",
      'export const LISA_OWNED_HASH_LEDGER = Object.freeze({\n  "scripts/other.mjs": [],\n});\n'
    );
    expect(refusalFor(TRACKED)).toContain(UNTRACKED_VERDICT);
  });

  it("treats a package with no ledger at all as tracking nothing", () => {
    expect(refusalFor(TRACKED)).toContain(UNTRACKED_VERDICT);
  });
});

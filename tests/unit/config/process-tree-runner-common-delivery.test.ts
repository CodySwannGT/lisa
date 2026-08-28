/**
 * Common-template and generated-evidence controls for the gate supervisor.
 *
 * The executable is not an agent plugin variant: every supported harness gets
 * the same `all/copy-overwrite` file. Its current bytes must also be present in
 * both generated inventories before the fix can ship.
 * @module tests/unit/config/process-tree-runner-common-delivery
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { HARNESS_VALUES } from "../../../src/core/config.js";
import { LISA_OWNED_HASH_LEDGER } from "../../../src/core/lisa-owned-hash-ledger.js";
import { UPSTREAM_EVIDENCE_MANIFEST } from "../../../src/core/upstream-evidence-manifest.js";

/** Common source shipped into every supported project's scripts directory. */
const SOURCE = "all/copy-overwrite/scripts/lib/process-tree-runner.mjs";

/** Installed destination governed by the append-only Lisa-owned hash ledger. */
const DESTINATION = "scripts/lib/process-tree-runner.mjs";

/**
 * Gate runner that resolves the supervisor beside itself after installation.
 */
const GATE_RUNNER = "all/copy-overwrite/scripts/lisa-run-gates.mjs";

/**
 * Compute one SHA-256 digest in the generated inventory format.
 * @param file - Repository-relative file to digest.
 * @returns Lowercase hexadecimal SHA-256 digest.
 */
function digest(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

describe("one supervisor serves every coding-agent harness", () => {
  it("keeps the full harness roster behind the common source", () => {
    expect(HARNESS_VALUES).toEqual([
      "claude",
      "codex",
      "cursor",
      "agy",
      "copilot",
      "opencode",
      "fleet",
    ]);
    expect(SOURCE).toMatch(/^all\/copy-overwrite\//u);
    expect(path.basename(SOURCE)).toBe("process-tree-runner.mjs");
  });

  it("makes the installed gate runner resolve that exact sibling", () => {
    const source = readFileSync(GATE_RUNNER, "utf8");

    expect(source).toContain('new URL("./lib/process-tree-runner.mjs"');
    expect(source).not.toMatch(
      /lisa-(claude|codex|cursor|agy|copilot|opencode)/u
    );
  });

  it("binds canonical bytes into both generated inventories", () => {
    const sourceDigest = digest(SOURCE);

    expect(LISA_OWNED_HASH_LEDGER[DESTINATION]).toContain(sourceDigest);
    expect(UPSTREAM_EVIDENCE_MANIFEST[SOURCE]).toBe(sourceDigest);
  });
});

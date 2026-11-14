/**
 * Source-text guards that travel with `docs/nightly-e2e-gate.md` — the
 * specification the reusable workflow and the shipped guard implement.
 *
 * Split out of `nightly-e2e-health-workflow.test.ts`, which proves the WIRING.
 * The document's prose is reviewed, not pinned; what stays here are the
 * guards on the code and workflow files the document describes.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const GUARD_REL =
  "typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs";

/**
 * Reads a repo-relative file.
 *
 * @param rel - Path relative to the repository root
 * @returns The file contents
 */
const read = (rel: string): string =>
  fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

describe("the contract document and its proof stay together", () => {
  it("keeps doctor discovery, graph, bounded IO, proof, and remediation in budgeted leaf modules", () => {
    const entry = read("src/cli/doctor-nightly-e2e-guard.ts");
    const scanner = read("src/cli/doctor-nightly-e2e-guard-scan.ts");
    expect(`${entry}\n${scanner}`).not.toMatch(
      /eslint-disable[^\n]*(?:max-lines|complexity|immutable-data)/u
    );
    for (const leaf of [
      "src/cli/doctor-nightly-e2e-guard-graph.ts",
      "src/cli/doctor-nightly-e2e-guard-io.ts",
      "src/cli/doctor-nightly-e2e-guard-proof.ts",
      "src/cli/doctor-nightly-e2e-guard-remediation.ts",
    ]) {
      expect(read(leaf)).toContain("@module cli/doctor-nightly-e2e-guard");
    }
  });

  it("row 26: guard and caller agree on the completeness rule", () => {
    expect(read(GUARD_REL)).toContain("incomplete_run");
    // The platform picker is the surface that produced the false green, so the
    // warning belongs where the operator chooses the value.
    expect(
      read("expo/create-only/.github/workflows/maestro-e2e.yml")
    ).toContain("NARROWING THIS DOES NOT CLEAR THE NIGHTLY GATE");
  });
});

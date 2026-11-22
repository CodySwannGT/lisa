/** Applicability of test fixtures when project types share task aliases. */
import { cpSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { installedShippedTaskProofs } from "../../../src/controls/shipped-task-proofs.js";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import { useOwnedTempDirs } from "../../helpers/owned-temp-dirs.js";

const temporaryDirectory = useOwnedTempDirs();
const PROOFS = ".lisa/controls/proofs";
const TEST_GATES = [
  "coverage-adequacy",
  "test-correctness",
  "test-integration",
];

describe("runner-specific proof patches", () => {
  it.each([
    ["typescript", TEST_GATES],
    ["nestjs", TEST_GATES],
    ["expo", []],
  ] as const)(
    "binds only the compatible test pairs for %s",
    async (stack, expected) => {
      const host = temporaryDirectory("lisa-shipped-proof-runner-");
      const manifest = await new PackageLisaStrategy().planPackageJson(
        { name: "proof-runner-fixture", version: "0.0.0" },
        [stack],
        process.cwd()
      );
      const scripts = manifest.scripts as Readonly<Record<string, string>>;
      cpSync(
        path.join("typescript/create-only", PROOFS),
        path.join(host, PROOFS),
        { recursive: true }
      );

      const pairs = await installedShippedTaskProofs(
        host,
        ["typescript", stack],
        scripts
      );

      expect(scripts["test:cov:unit"]).toBe(
        "$npm_execpath run test:cov:unit:lisa"
      );
      expect(
        pairs.map(pair => pair.gate).filter(gate => TEST_GATES.includes(gate))
      ).toEqual(expected);
    }
  );
});

/** Applicability of test fixtures when project types share task aliases. */
import { cpSync, mkdirSync } from "node:fs";
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
    ["typescript", false, TEST_GATES],
    ["nestjs", false, TEST_GATES],
    ["expo", true, TEST_GATES],
    ["expo", false, ["test-correctness", "test-integration"]],
  ] as const)(
    "binds only the compatible test pairs for %s with src/app=%s",
    async (stack, expoSourceRoot, expected) => {
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

      if (stack === "expo") {
        cpSync(path.join("expo/create-only", PROOFS), path.join(host, PROOFS), {
          recursive: true,
        });
      }

      if (expoSourceRoot)
        mkdirSync(path.join(host, "src", "app"), { recursive: true });

      const pairs = await installedShippedTaskProofs(
        host,
        ["typescript", stack],
        scripts
      );

      expect(scripts["test:cov:unit"]).toBe(
        "$npm_execpath run test:cov:unit:lisa"
      );
      const testPairs = pairs.filter(pair => TEST_GATES.includes(pair.gate));
      expect(testPairs.map(pair => pair.gate)).toEqual(expected);
      const prefix = stack === "expo" ? "lisa-expo-" : "lisa-typescript-";
      expect(
        testPairs.map(({ proof }) => path.basename(proof.violation))
      ).toEqual(expected.map(gate => `${prefix}${gate}.violation.patch`));
    }
  );
});

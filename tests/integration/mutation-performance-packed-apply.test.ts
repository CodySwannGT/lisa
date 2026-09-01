/** Packed exact-head apply and stack-parity entrypoint for hosted Stage 1. */
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  EXPECTED_STACKS,
  verifyPreparedManifest,
} from "../../scripts/mutation-performance-measure.mjs";

describe("packed mutation measurement hosts", () => {
  it("pins all Stryker routes and Rails preservation", () => {
    expect(EXPECTED_STACKS).toEqual([
      "typescript",
      "nestjs",
      "cdk",
      "npm-package",
      "harper-fabric",
      "phaser",
      "expo",
      "rails",
    ]);
  });

  const packedApplyIt =
    process.env["LISA_MUTATION_PERFORMANCE_PACKED_APPLY"] === "1"
      ? it
      : it.skip;

  packedApplyIt(
    "applied an exact package twice without invoking GitHub repository creation",
    () => {
      const manifestPath = process.env["LISA_MUTATION_PREPARED_MANIFEST"];
      expect(manifestPath).toBeTruthy();
      const manifest = JSON.parse(readFileSync(manifestPath!, "utf8"));
      expect(verifyPreparedManifest(manifest).valid).toBe(true);
      expect(manifest.stacks.map((row: any) => row.stack)).toEqual(
        EXPECTED_STACKS
      );
      expect(
        manifest.stacks.every((row: any) => row.second_apply_idempotent)
      ).toBe(true);
      expect(
        manifest.stacks.find((row: any) => row.stack === "rails")
          .stryker_present
      ).toBe(false);
      expect(
        existsSync(path.join(path.dirname(manifestPath!), "gh-called"))
      ).toBe(false);
    }
  );
});

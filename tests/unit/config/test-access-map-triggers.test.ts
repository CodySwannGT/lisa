/**
 * Unit tests for what scripts/lib/test-access-map.mjs decides beyond the map
 * itself (CodySwannGT/lisa#4611): the project's full-rerun triggers, and
 * whether this project wants a map recorded at all.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  accessMapWanted,
  configuredTriggers,
} from "../../../scripts/lib/test-access-map.mjs";

const CONFIG = ".lisa.config.json";

describe("configuredTriggers", () => {
  it("keeps globs, makes in-repo paths relative and drops outside ones", () => {
    const root = path.join(os.tmpdir(), "host");
    expect(
      configuredTriggers(root, {
        forceRerunTriggers: ["**/package.json/**", "fixtures/**"],
        setupFiles: [
          path.join(root, "tests", "setup.ts"),
          path.join(root, "node_modules", "@codyswann", "lisa", "setup.mjs"),
          path.join(os.tmpdir(), "elsewhere.ts"),
        ],
        globalSetup: path.join(root, "tests", "global.ts"),
      })
    ).toEqual([
      "**/package.json/**",
      "fixtures/**",
      "tests/global.ts",
      "tests/setup.ts",
    ]);
  });

  it("returns nothing for a config with none of the three keys", () => {
    expect(configuredTriggers("/repo", {})).toEqual([]);
  });
});

describe("accessMapWanted", () => {
  it("follows the effective pushGate.affectedTests, stack defaults included", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "lisa-access-map-wanted-")
    );
    try {
      expect(accessMapWanted(root)).toBe(false);
      fs.writeFileSync(path.join(root, "tsconfig.json"), "{}");
      expect(accessMapWanted(root)).toBe(true);
      fs.writeFileSync(
        path.join(root, CONFIG),
        JSON.stringify({ pushGate: { affectedTests: false } })
      );
      expect(accessMapWanted(root)).toBe(false);
      fs.writeFileSync(
        path.join(root, CONFIG),
        JSON.stringify({ pushGate: null })
      );
      expect(accessMapWanted(root)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

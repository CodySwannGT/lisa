/**
 * Expo's standalone ESLint factory stays retired (CodySwannGT/lisa#4947).
 *
 * `expo/copy-overwrite/eslint.expo.ts` was a copy of the Expo ESLint factory
 * that nothing loads: hosts load `@codyswann/lisa/eslint/expo`. It also
 * required ESLint plugins no Expo host is given, so it broke the promise that
 * a file Lisa ships into a host resolves every import it makes. Three things
 * keep that fixed:
 *
 * - Lisa ships no such file, in any Expo lane.
 * - `expo/deletions.json` removes it from a host that still has it, and the
 *   reason is written down (`legacy:`), so the runtime gate that refuses
 *   unclassified deletions lets this one through on upgrade.
 * - No shipped file names a package its stack does not supply. That is the
 *   existing "ships no file naming a package its templates do not supply"
 *   check in `runtime-dependency-ownership.test.ts`, which covers every stack
 *   and both lanes; it is not repeated here.
 * @module tests/unit/config/expo-eslint-factory-retired
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import type { DeletionsConfig } from "../../../src/core/config.js";
import {
  basisAuthorisesDeletion,
  resolveDeletionBasis,
} from "../../../src/core/deletion-basis.js";

const REPO_ROOT = process.cwd();
const RETIRED = "eslint.expo.ts";
const EXPO_LANES = ["copy-overwrite", "create-only"] as const;

/**
 * Expo's deletion manifest, as Lisa reads it on apply.
 * @returns The parsed manifest
 */
function expoDeletions(): DeletionsConfig {
  return JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "expo", "deletions.json"), "utf8")
  ) as DeletionsConfig;
}

describe("Expo's standalone ESLint factory", () => {
  it.each(EXPO_LANES)("is not shipped in expo/%s", lane => {
    expect(fs.existsSync(path.join(REPO_ROOT, "expo", lane, RETIRED))).toBe(
      false
    );
  });

  it("is removed from a host that still has it, and not kept", () => {
    const deletions = expoDeletions();

    expect(deletions.paths).toContain(RETIRED);
    expect(deletions.keep ?? []).not.toContain(RETIRED);
  });

  it("is removed on the strength of a written legacy reason that cites #4947", () => {
    const basis = resolveDeletionBasis(expoDeletions(), RETIRED);

    expect(basis.kind).toBe("legacy");
    expect(basis.reason).toContain("CodySwannGT/lisa#4947");
    expect(basisAuthorisesDeletion(basis)).toBe(true);
  });
});

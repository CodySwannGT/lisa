/**
 * The shared-runtime fixture's patched floors match the declared ones.
 *
 * The shipped templates declare `vite: ^8.3.3` (GHSA-587h-7wmj-h5pm), so an
 * installed 8.3.2 is the vulnerable release and the packed-host suite must
 * refuse it rather than certify it.
 */
import { describe, expect, it } from "vitest";

import { assertPatchedFloors } from "../../fixtures/shared-runtime-hosts/assertions.js";

/**
 * A fully patched install, with one tool overridden.
 * @param overrides - Versions to replace
 * @returns Installed versions by package name
 */
const installed = (
  overrides: Readonly<Record<string, string>> = {}
): Readonly<Record<string, string>> => ({
  vitest: "4.1.11",
  "@vitest/coverage-v8": "4.1.11",
  vite: "8.3.3",
  ...overrides,
});

describe("shared-runtime patched floors", () => {
  it("accepts the declared floors", () => {
    expect(() => assertPatchedFloors(installed())).not.toThrow();
  });

  it("refuses an installed vite 8.3.2, below the declared ^8.3.3", () => {
    expect(() => assertPatchedFloors(installed({ vite: "8.3.2" }))).toThrow();
  });

  it("refuses a vitest below its declared floor", () => {
    expect(() =>
      assertPatchedFloors(installed({ vitest: "4.1.10" }))
    ).toThrow();
  });
});

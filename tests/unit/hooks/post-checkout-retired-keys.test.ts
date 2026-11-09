/**
 * The post-checkout bootstrap names the retired Lisa stack plugin keys in a
 * shell `case` arm, because the hook cannot import TypeScript. This pins that
 * copy to the source of truth, RETIRED_STACK_PLUGIN_KEYS (#4645).
 * @module tests/unit/hooks/post-checkout-retired-keys
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RETIRED_STACK_PLUGIN_KEYS } from "../../../src/core/retired-plugin-keys.js";

const HOOK_PATH = path.resolve("typescript/copy-contents/.husky/post-checkout");

describe("post-checkout retired-key list", () => {
  it("names exactly the keys in RETIRED_STACK_PLUGIN_KEYS, each with its lisa-<key> successor", () => {
    const hook = readFileSync(HOOK_PATH, "utf-8");
    const arm = hook
      .split("\n")
      .map(line => line.trim())
      .find(line => /^[a-z-]+@lisa( \| [a-z-]+@lisa)*\)$/.test(line));
    const hookKeys = (arm ?? "")
      .slice(0, -1)
      .split(" | ")
      .sort((a, b) => a.localeCompare(b));

    expect(hookKeys).toEqual(
      [...RETIRED_STACK_PLUGIN_KEYS.keys()].sort((a, b) => a.localeCompare(b))
    );
    // The hook prints the successor as `lisa-$_p`; that only holds while
    // every successor is the key with a `lisa-` prefix.
    for (const [key, { successor }] of RETIRED_STACK_PLUGIN_KEYS) {
      expect(successor).toBe(`lisa-${key}`);
    }
  });
});

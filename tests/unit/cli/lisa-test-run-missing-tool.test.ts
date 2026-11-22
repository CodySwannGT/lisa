/**
 * A payload whose runner is not installed fails with the tool's name and its
 * install step, not a bare `spawn ENOENT` (CodySwannGT/lisa#4932).
 * @module tests/unit/cli/lisa-test-run-missing-tool
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";

import { missingToolMessage } from "../../../src/cli/lisa-test-run-missing-tool.js";

/**
 * The error Node raises for an executable that does not exist.
 * @param command - Executable name
 * @returns The real spawn error
 */
async function spawnError(command: string): Promise<unknown> {
  const child = spawn(command, [], { stdio: "ignore" });
  const [error] = (await once(child, "error")) as [unknown];
  return error;
}

describe("missingToolMessage", () => {
  it("names Maestro and how to install it", async () => {
    const message = missingToolMessage(
      await spawnError("maestro-not-installed-4932")
    );
    expect(message).toContain("`maestro-not-installed-4932` is not installed");
    expect(missingToolMessage({ code: "ENOENT", path: "maestro" })).toContain(
      "https://docs.maestro.dev"
    );
  });

  it("leaves every other failure to the caller", () => {
    expect(missingToolMessage(new Error("boom"))).toBeUndefined();
    expect(missingToolMessage({ code: "EACCES", path: "maestro" })).toBe(
      undefined
    );
    expect(missingToolMessage(undefined)).toBeUndefined();
  });
});

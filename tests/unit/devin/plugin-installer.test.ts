/**
 * Tests for the Devin plugin installer (CodySwannGT/lisa#4427). The `devin`
 * CLI is replaced by an explicitly injected runner; these tests prove the
 * argv Lisa sends and how it reads success and failure, not Devin itself
 * (the real install is exercised by the Validation Journey on #4427).
 * @module tests/unit/devin/plugin-installer
 */
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectDevin,
  installDevinPlugin,
  type DevinRunner,
} from "../../../src/devin/plugin-installer.js";

const VARIANT = "lisa-devin";
const PROBE_FAILURE = "devin: boom";

/**
 * Recording stand-in for the `devin` CLI.
 * @param fail - Whether every call rejects
 * @returns The runner and the argv lists it received
 */
const fakeDevin = (
  fail = false
): { readonly run: DevinRunner; readonly calls: string[][] } => {
  const calls: string[][] = [];
  const run: DevinRunner = async args => {
    calls.push([...args]);
    if (fail) throw new Error(PROBE_FAILURE);
  };
  return { run, calls };
};

describe("devin plugin installer", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "devin-plugins-"));
  });

  afterEach(async () => {
    await fs.remove(root);
  });

  it("detects the CLI from a successful --version probe", async () => {
    const devin = fakeDevin();
    expect(await detectDevin(devin.run)).toEqual({
      available: true,
      error: undefined,
    });
    expect(devin.calls).toEqual([["--version"]]);
  });

  it("reports the CLI absent, without an error, only when it is not installed", async () => {
    const missing: DevinRunner = async () => {
      throw Object.assign(new Error("spawn devin ENOENT"), { code: "ENOENT" });
    };
    expect(await detectDevin(missing)).toEqual({
      available: false,
      error: undefined,
    });
  });

  it("reports any other probe failure instead of treating it as absent", async () => {
    expect(await detectDevin(fakeDevin(true).run)).toEqual({
      available: false,
      error: PROBE_FAILURE,
    });
  });

  it("installs the variant locally and non-interactively", async () => {
    await fs.outputJson(
      path.join(root, VARIANT, ".devin-plugin", "plugin.json"),
      { name: "lisa" }
    );
    const devin = fakeDevin();

    const result = await installDevinPlugin(root, VARIANT, devin.run);

    expect(result.installed).toBe(true);
    expect(devin.calls).toEqual([
      ["plugins", "install", "--local", "-y", path.join(root, VARIANT)],
    ]);
  });

  it("does not call devin when the variant was never built", async () => {
    const devin = fakeDevin();
    const result = await installDevinPlugin(root, VARIANT, devin.run);

    expect(result.installed).toBe(false);
    expect(result.error).toMatch(/build:plugins/);
    expect(devin.calls).toEqual([]);
  });

  it("surfaces an install failure instead of reporting success", async () => {
    await fs.outputJson(
      path.join(root, VARIANT, ".devin-plugin", "plugin.json"),
      { name: "lisa" }
    );
    const result = await installDevinPlugin(root, VARIANT, fakeDevin(true).run);

    expect(result.installed).toBe(false);
    expect(result.error).toBe(PROBE_FAILURE);
  });
});

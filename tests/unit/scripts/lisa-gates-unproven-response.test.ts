/**
 * Tests the one setting that decides what a presence-gated CI job does when it
 * can prove nothing.
 *
 * `gates.unproven` is a RESERVED sibling of `gates.runner`, not a gate id.
 * Reading it as a gate id was the state before #2929: a project that set it
 * got a blocking "not a gate Lisa knows" from `validate` and no enforcement,
 * which is the worst of both — the setting refused and the hole left open.
 *
 * The value's allowlist is checked here as well as in the workflow, because
 * the workflow's copy answers for a single CI run and this one answers for
 * `validate`, the pre-push hook, and every other caller of `readGates`.
 * @module tests/unit/scripts/lisa-gates-unproven-response
 */

import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_UNPROVEN,
  readGates,
  UNPROVEN_RESPONSES,
  validateGates,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

describe("gates.unproven", () => {
  let workdir = "";

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "gates-unproven-"));
  });

  afterEach(async () => {
    await fs.remove(workdir);
  });

  /**
   * Writes a `.lisa.config.json` into the fixture project.
   * @param gates The gates block to write.
   */
  const write = async (gates: unknown): Promise<void> => {
    await fs.writeJson(path.join(workdir, ".lisa.config.json"), { gates });
  };

  it("permits exactly warn and fail", () => {
    expect([...UNPROVEN_RESPONSES]).toEqual(["warn", "fail"]);
  });

  it("defaults to warn, so a version bump reddens nobody", () => {
    expect(DEFAULT_UNPROVEN).toBe("warn");
    expect(readGates(workdir).unproven).toBe("warn");
  });

  it("defaults to warn when the config declares gates but not this one", async () => {
    await write({ runner: "bun run", "code-style": { push: "required" } });

    expect(readGates(workdir).unproven).toBe("warn");
  });

  it("reads a declared response", async () => {
    await write({ unproven: "fail" });

    expect(readGates(workdir).unproven).toBe("fail");
  });

  it("does not leave it in the gates block to be read as a gate id", async () => {
    // The whole defect: `unproven` reaching `validateGates` produces
    // `gates."unproven" is not a gate Lisa knows`, a BLOCKING problem, so
    // setting the control breaks `validate` for the project that set it.
    await write({ unproven: "fail" });

    const { gates } = readGates(workdir);

    expect(Object.hasOwn(gates, "unproven")).toBe(false);
    expect(validateGates(gates)).toEqual([]);
  });

  it("refuses an unrecognised response instead of defaulting to warn", async () => {
    // Allowlist, never denylist: falling through to the permissive default is
    // how a typo silently turns enforcement off for a project that asked for
    // it.
    await write({ unproven: "fial" });

    expect(() => readGates(workdir)).toThrow(/unproven/);
    expect(() => readGates(workdir)).toThrow(/warn/);
  });

  it("refuses a non-string response", async () => {
    // `RegExp.prototype.test` coerces, so `true` would pass a pattern check
    // written without a type check first — the bug `isRunner` documents.
    await write({ unproven: true });

    expect(() => readGates(workdir)).toThrow(/unproven/);
  });
});

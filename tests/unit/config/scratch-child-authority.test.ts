/** Same-uid swap proof for the per-suite direct-child cleanup primitive. */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { removeAuthorizedScratchChild } from "../../../src/configs/vitest/scratch-authority.js";
import { scratchPathIdentity } from "../../../src/configs/vitest/scratch-owner.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("per-suite scratch child authority", () => {
  it("does not delete a same-uid replacement swapped after child inspection", () => {
    const base = fs.mkdtempSync(path.join(tmpdir(), "child-authority-"));
    const parent = path.join(base, "owned-root");
    const child = path.join(parent, "fixture-child");
    const outside = path.join(base, "outside-target");
    const holding = path.join(base, "original-child");
    temporaryDirectories.push(base);
    fs.mkdirSync(child, { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "outside-payload.txt"), "keep", "utf8");
    const parentIdentity = scratchPathIdentity(parent);
    let swapped = false;
    const swap = (candidate: string): void => {
      if (!swapped && candidate === child) {
        swapped = true;
        fs.renameSync(child, holding);
        fs.renameSync(outside, child);
      }
    };

    let failure: unknown;
    try {
      removeAuthorizedScratchChild({
        parent: parentIdentity,
        basename: path.basename(child),
        afterIdentityCheck: swap,
      });
    } catch (error) {
      failure = error;
    }
    expect(swapped).toBe(true);
    expect(String(failure)).toMatch(/identity changed/iu);
    expect(
      fs.readFileSync(path.join(child, "outside-payload.txt"), "utf8")
    ).toBe("keep");
  });
});

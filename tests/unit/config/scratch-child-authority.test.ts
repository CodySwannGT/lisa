/** Same-uid swap proof for the per-suite direct-child cleanup primitive. */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  removeAuthorizedScratchChild,
  removeAuthorizedScratchChildren,
} from "../../../src/configs/vitest/scratch-authority.js";
import { scratchPathIdentity } from "../../../src/configs/vitest/scratch-owner.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("per-suite scratch child authority", () => {
  it("cleans many authorized children through one bound cleanup dispatch", () => {
    const base = fs.mkdtempSync(path.join(tmpdir(), "child-batch-"));
    const parent = path.join(base, "owned-root");
    temporaryDirectories.push(base);
    fs.mkdirSync(parent);
    const basenames = Array.from(
      { length: 64 },
      (_, index) => `fixture-${String(index)}`
    );
    for (const basename of basenames) {
      fs.mkdirSync(path.join(parent, basename));
      fs.writeFileSync(
        path.join(parent, basename, "payload.txt"),
        "owned",
        "utf8"
      );
    }
    let dispatches = 0;

    removeAuthorizedScratchChildren({
      parent: scratchPathIdentity(parent),
      basenames,
      beforeBoundCleanup: () => {
        dispatches += 1;
      },
    });

    expect(dispatches).toBe(1);
    expect(fs.readdirSync(parent)).toEqual([]);
  });

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

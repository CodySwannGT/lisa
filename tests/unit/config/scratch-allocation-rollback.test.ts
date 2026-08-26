/** Regression proof that owner-marker persistence is part of allocation. */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  SCRATCH_NAMESPACE,
  createRunRoot,
} from "../../../src/configs/vitest/scratch.js";
import { withScratchAuthorityTestRoot } from "../../../src/configs/vitest/scratch-authority.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("scratch root allocation transaction", () => {
  it("authority-cleans a new root when its owner marker cannot persist", () => {
    const base = fs.mkdtempSync(path.join(tmpdir(), "allocation-rollback-"));
    const namespace = path.join(base, SCRATCH_NAMESPACE);
    temporaryDirectories.push(base);
    fs.mkdirSync(namespace, { mode: 0o700 });

    expect(() =>
      withScratchAuthorityTestRoot(base, () =>
        createRunRoot({
          writeOwnerRecord: () => {
            throw new Error("injected owner marker failure");
          },
        })
      )
    ).toThrow(/injected owner marker failure/iu);
    expect(fs.readdirSync(namespace)).toEqual([]);
  });
});

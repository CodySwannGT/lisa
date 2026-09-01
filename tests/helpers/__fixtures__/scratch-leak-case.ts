/** Child fixture used to prove the same suite rejects its own temp leak. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const prefix = process.env["LISA_SCRATCH_LEAK_PREFIX"] ?? "leaked-fixture-";
const count = Number(process.env["LISA_SCRATCH_LEAK_COUNT"] ?? "1");

describe("scratch leak fixture", () => {
  it("leaves direct children for the suite guard to judge", () => {
    const leaked = Array.from({ length: count }, () => {
      const directory = mkdtempSync(path.join(tmpdir(), prefix));
      writeFileSync(
        path.join(directory, "payload.txt"),
        "owned by fixture",
        "utf8"
      );
      return directory;
    });
    expect(new Set(leaked.map(directory => path.dirname(directory)))).toEqual(
      new Set([tmpdir()])
    );
  });
});

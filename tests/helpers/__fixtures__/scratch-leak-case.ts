/** Child fixture used to prove the same suite rejects its own temp leak. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const prefix = process.env["LISA_SCRATCH_LEAK_PREFIX"] ?? "leaked-fixture-";

describe("scratch leak fixture", () => {
  it("leaves one direct child for the suite guard to judge", () => {
    const leaked = mkdtempSync(path.join(tmpdir(), prefix));
    writeFileSync(path.join(leaked, "payload.txt"), "owned by fixture", "utf8");
    expect(path.dirname(leaked)).toBe(tmpdir());
  });
});

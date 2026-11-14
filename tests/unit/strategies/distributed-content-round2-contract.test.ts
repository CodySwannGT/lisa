/**
 * Regression contract for the upstream distributed-content findings in #1622.
 *
 * The skill and guide prose those findings corrected is not pinned (#4867).
 * What stays is a source-text guard on the OpenCode installer, which must keep
 * copying bundled skills verbatim so the corrected content reaches OpenCode.
 * @module tests/unit/strategies/distributed-content-round2-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

describe("OpenCode distribution", () => {
  it("continues to copy the corrected bundled skills verbatim", () => {
    const installer = read("src/opencode/skills-installer.ts");

    expect(installer).toMatch(/Copy one bundled skill folder verbatim/);
    expect(installer).toContain("await copyFile(srcPath, destPath)");
  });
});

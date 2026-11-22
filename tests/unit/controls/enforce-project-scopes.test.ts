/** Detect project types in the folder whose gate is reported. @module */
import { describe, expect, it } from "vitest";

import { supportedControlScopes } from "../../../src/controls/shipped-parts.js";
import { buildControlAuditFixture } from "../../helpers/control-audit-fixtures.js";

describe("enforce report project types", () => {
  it("detects a supported child without assigning its type to other scopes", async () => {
    const fixture = buildControlAuditFixture("F-none", {
      extraFiles: {
        "api/package.json": JSON.stringify({
          devDependencies: { typescript: "*" },
        }),
        "api/tsconfig.json": "{}\n",
        "api/index.ts": "export const value = 1;\n",
        "other/README.md": "# Notes\n",
      },
    });
    try {
      const scopes = await supportedControlScopes(fixture.repoPath, [
        ".",
        "api",
        "other",
        "api",
      ]);
      expect([...scopes]).toEqual(["api"]);
    } finally {
      fixture.cleanup();
    }
  });
});

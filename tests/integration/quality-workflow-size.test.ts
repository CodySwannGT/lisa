/** GitHub rejects an oversized workflow before it can run any checks. */
import { statSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("quality workflow loading", () => {
  it("fits GitHub's 500 KB workflow source limit", () => {
    expect(statSync(".github/workflows/quality.yml").size).toBeLessThan(
      500_000
    );
  });
});

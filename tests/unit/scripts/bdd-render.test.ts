/**
 * The generated Markdown must survive author-supplied text.
 *
 * The burndown and matrix are generated files nobody re-reads line by line,
 * so a table that silently shifts its columns misreports the Ticket and
 * Expires cells forever.
 */
import { describe, expect, it } from "vitest";

import {
  HEALTHY_FILES,
  HEALTHY_MAP,
  HOME_FEATURE_FILE,
  HOME_ID,
  RATIFIED,
  WEB,
  featureSource,
  makeProject,
  runGateWrite,
} from "./bdd/support";

describe("author text cannot break the generated tables", () => {
  it("escapes a pipe in a waiver reason", () => {
    const root = makeProject({
      map: {
        ...HEALTHY_MAP,
        mappings: [],
        coverageFloor: { [WEB]: 0 },
        platformWaivers: [
          {
            scenario: HOME_ID,
            platforms: [WEB],
            reason: "the runner pipes stdout | stderr and cannot decide it",
            owner: "o@example.test",
            ticket: "TUN-1",
            recordedAt: "2026-08-01",
            expiresAt: "2099-01-01",
          },
        ],
      },
      features: {
        [HOME_FEATURE_FILE]: featureSource("Home", [
          { id: HOME_ID, tags: [WEB, RATIFIED] },
        ]),
      },
      files: HEALTHY_FILES,
    });
    const burndown = runGateWrite(root);
    const row = burndown
      .split("\n")
      .find(line => line.includes("stdout")) as string;
    expect(row).toContain("stdout \\| stderr");
    // Seven columns means the Ticket and Expires cells still line up.
    expect(row.split(/(?<!\\)\|/).length - 2).toBe(7);
  });
});

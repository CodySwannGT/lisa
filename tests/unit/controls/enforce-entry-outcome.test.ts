/**
 * What a register entry's enforcement points add up to: one outcome for the
 * entry, and never "nothing to enforce" for a check a requirement needs
 * that nothing runs (CodySwannGT/lisa#4994).
 */
import { describe, expect, it } from "vitest";

import {
  COMMIT,
  DEPLOY,
  EXTERNAL,
  MERGE,
  NOTHING,
  TASK,
  entry,
  judge,
  protect,
} from "./support/enforce-points-samples.js";

describe("what an entry's points add up to", () => {
  it("is blocked when one point is wired and another is blocked", async () => {
    const judged = await judge(entry([COMMIT, MERGE]), {
      protect: protect("blocked"),
    });

    expect(judged.outcome).toBe("blocked");
    expect(judged.points.map(point => point.state)).toEqual([
      "wired",
      "blocked",
    ]);
  });

  it("is wired when one point is wired and another could not be checked", async () => {
    const judged = await judge(entry([COMMIT, DEPLOY]));

    expect(judged.outcome).toBe("wired");
    expect(judged.reason).toContain(
      "Not checked by the enforce step: pre-deploy:production"
    );
  });

  it("is blocked when a declared command runs only where nothing Lisa installs starts it", async () => {
    const judged = await judge(entry([DEPLOY]));

    expect(judged.outcome).toBe("blocked");
    expect(judged.reason).toContain("scripts/lisa-run-gates.mjs");
  });

  it("has nothing to enforce when a shipped check runs only where Lisa's project type runs it", async () => {
    expect((await judge(entry([DEPLOY], TASK))).outcome).toBe(NOTHING);
  });

  it("is blocked, sending the operator to the configure step, when a check a requirement needs has no moment", async () => {
    const judged = await judge(entry([]));

    expect(judged.outcome).toBe("blocked");
    expect(judged.reason).toContain("no moment to run at");
    expect(judged.reason).toContain(
      "run the configure step and choose when this check has to pass"
    );
  });

  it("has nothing to enforce when a check with no moment serves no requirement a check can refuse a change for", async () => {
    const judged = await judge(entry([]), { gateCriteria: [] });

    expect(judged.outcome).toBe(NOTHING);
  });

  it("is blocked when a check another system reports is declared only where nothing was checked", async () => {
    const judged = await judge(
      entry([{ ...MERGE, level: "optional" }], EXTERNAL)
    );

    expect(judged.points[0]?.state).toBe("not-checked");
    expect(judged.outcome).toBe("blocked");
    expect(judged.reason).toContain("Another system reports this check");
    expect(judged.reason).toContain("run the configure step");
    expect(judged.reason).not.toContain("a Lisa project type ships");
  });

  it("does not say Lisa ships a check another system reports, even where no requirement needs it", async () => {
    const judged = await judge(
      entry([{ ...MERGE, level: "optional" }], EXTERNAL),
      { gateCriteria: [] }
    );

    expect(judged.outcome).toBe(NOTHING);
    expect(judged.reason).not.toContain("a Lisa project type ships");
  });
});

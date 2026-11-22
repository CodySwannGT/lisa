/**
 * What a register entry's enforcement points add up to: one outcome for the
 * entry, and never "nothing to enforce" for a check a requirement needs
 * that nothing runs (CodySwannGT/lisa#4994).
 */
import { describe, expect, it } from "vitest";

import { CUSTOM_PREFIX } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { HOST_GATE_PREFIX } from "../../../src/controls/enforce-entry-outcome.js";
import type {
  ControlRegisterEntry,
  EnforcementPoint,
  MeasuringMechanism,
} from "../../../src/controls/register-types.js";
import {
  COMMAND,
  COMMIT,
  DEPLOY,
  EDIT,
  EXTERNAL,
  MERGE,
  NOTHING,
  TASK,
  entry,
  judge,
  protect,
} from "./support/enforce-points-samples.js";

/** What a reason says of a check Lisa ships and runs itself. */
const SHIPPED_BY = "what a Lisa project type ships";
const SHIPPED = "a Lisa project type ships";

/**
 * A register entry of a gate the repository invented.
 * @param points - Its enforcement points
 * @param mechanism - What measures it
 * @returns The entry
 */
function hostEntry(
  points: readonly EnforcementPoint[],
  mechanism: MeasuringMechanism
): ControlRegisterEntry {
  return {
    ...entry(points, mechanism),
    gate: "x-lint-check",
    id: "x-lint-check@.",
  };
}

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
    const judged = await judge(entry([DEPLOY], TASK));

    expect(judged.outcome).toBe(NOTHING);
    expect(judged.reason).toContain(SHIPPED);
  });

  it("blocks a registry task that has no supported project type to run it", async () => {
    const judged = await judge(entry([{ ...MERGE, level: "optional" }], TASK), {
      hasSupportedProjectType: false,
    });

    expect(judged.outcome).toBe("blocked");
    expect(judged.reason).toContain("nothing Lisa ships runs it");
    expect(judged.reason).toContain(
      "run the configure step and choose when this check has to pass"
    );
  });

  it.each([[["SI7"]], [[]]])(
    "makes no claim of its own when the declaration gives it no moment to run at (requirements a check can refuse a change for: %j)",
    async gateCriteria => {
      const judged = await judge(entry([]), { gateCriteria });

      expect(judged.outcome).toBe(NOTHING);
      expect(judged.reason).toContain("no moment to run at");
      expect(judged.reason).toContain("does not count as a check");
    }
  );

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
    expect(judged.reason).not.toContain(SHIPPED);
  });
});

describe("a check Lisa ships, declared where the enforce step cannot look", () => {
  const OPTIONAL_MERGE: EnforcementPoint = { ...MERGE, level: "optional" };
  const SESSION: EnforcementPoint = {
    moment: "session-start",
    level: "required",
    location: "coding-agent",
  };
  const NIGHTLY: EnforcementPoint = {
    moment: "continuous:nightly",
    level: "required",
    location: "scheduled-run",
  };
  const UNCHECKED: readonly (readonly [string, EnforcementPoint])[] = [
    ["on a proposed change, where it is optional", OPTIONAL_MERGE],
    ["after an agent's edit, with no agent named", EDIT],
    ["before a deployment", DEPLOY],
    ["at the start of an agent's session", SESSION],
    ["on a schedule", NIGHTLY],
  ];

  it("writes the prefix of a repository's own gate the way the gate registry does", () => {
    expect(HOST_GATE_PREFIX).toBe(CUSTOM_PREFIX);
  });

  it.each(UNCHECKED)(
    "is blocked for a task the repository declares under a gate of its own, %s",
    async (_where, point) => {
      const judged = await judge(hostEntry([point], TASK), { carriers: [] });

      expect(judged.points.map(each => each.state)).toEqual(["not-checked"]);
      expect(judged.outcome).toBe("blocked");
      expect(judged.reason).toContain("npm run lint");
      expect(judged.reason).toContain(point.moment);
      expect(judged.reason).toContain("run the configure step");
      expect(judged.reason).not.toContain(SHIPPED);
    }
  );

  it("does not say Lisa ships a repository's own task, even where no requirement needs it", async () => {
    const judged = await judge(hostEntry([OPTIONAL_MERGE], TASK), {
      gateCriteria: [],
    });

    expect(judged.outcome).toBe(NOTHING);
    expect(judged.reason).toContain("npm run lint");
    expect(judged.reason).not.toContain(SHIPPED);
  });

  it.each([
    ["an interceptor", { kind: "interceptor" }],
    ["a built-in job", { kind: "built-in" }],
  ] as const)(
    "has nothing to enforce for %s, whatever the gate is called",
    async (_name, mechanism) => {
      const judged = await judge(hostEntry([OPTIONAL_MERGE], mechanism));

      expect(judged.outcome).toBe(NOTHING);
      expect(judged.reason).toContain(SHIPPED);
    }
  );

  it("has nothing to enforce for a task under one of Lisa's own gates", async () => {
    const judged = await judge(entry([OPTIONAL_MERGE], TASK));

    expect(judged.outcome).toBe(NOTHING);
    expect(judged.reason).toContain(SHIPPED);
  });

  it("is blocked when nothing is declared that measures a check a requirement needs", async () => {
    const judged = await judge(entry([OPTIONAL_MERGE], { kind: "none" }));

    expect(judged.outcome).toBe("blocked");
    expect(judged.reason).toContain("Nothing is declared that measures");
  });

  it("goes by every moment, not the first: a repository's own task beside a check Lisa ships is run by what Lisa ships", async () => {
    const judged = await judge(
      hostEntry(
        [
          { ...OPTIONAL_MERGE, measuring_mechanism: TASK },
          { ...DEPLOY, measuring_mechanism: { kind: "built-in" } },
        ],
        TASK
      )
    );

    expect(judged.outcome).toBe(NOTHING);
    expect(judged.reason).toContain(
      `runs at ${DEPLOY.moment} through ${SHIPPED_BY}`
    );
    expect(judged.reason).toContain(
      `Not checked by the enforce step: ${OPTIONAL_MERGE.moment}`
    );
  });

  it("goes by every moment, not the first: a declared command later in the list is still blocked", async () => {
    const judged = await judge(
      hostEntry(
        [
          { ...OPTIONAL_MERGE, measuring_mechanism: EXTERNAL },
          { ...DEPLOY, measuring_mechanism: COMMAND },
        ],
        EXTERNAL
      )
    );

    expect(judged.outcome).toBe("blocked");
    expect(judged.reason).toContain("scripts/lisa-run-gates.mjs");
    expect(judged.reason).toContain(`declared at ${DEPLOY.moment}`);
  });
});

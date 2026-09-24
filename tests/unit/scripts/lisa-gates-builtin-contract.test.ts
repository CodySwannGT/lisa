/** Resolver ownership and runner reporting for facade-owned checks. */
import { describe, expect, it, vi } from "vitest";

import { resolveMoment } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  provenFloor,
  runGates,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { PULL_REQUEST } from "./lisa-gates-fixtures.js";

describe("built-in facade ownership", () => {
  it.each([["credential-leakage", "commit"]])(
    "keeps the real %s hook check enabled after delegation",
    (id, moment) => {
      const gates = { [id]: { [moment]: "required" } };
      const result = runGates({
        gates,
        moment,
        scripts: {},
        exec: () => {
          throw new Error("A delegated gate must not execute a task");
        },
        out: () => {},
        priorKills: [],
        recordKill: () => false,
        interrupted: () => null,
      });
      expect(result.skipped).toMatchObject([{ id, mode: "builtin" }]);
      expect(provenFloor({ gates, moment, result })).not.toContain(id);
    }
  );

  it.each([
    ["dependency-vulnerability", "push"],
    ["static-security", PULL_REQUEST],
    ["credential-leakage", PULL_REQUEST],
    ["license-compliance", PULL_REQUEST],
    ["journey-coverage", PULL_REQUEST],
    ["state-classification", PULL_REQUEST],
    ["e2e-browser", PULL_REQUEST],
    ["artifact-freshness", "commit"],
  ])("does not delegate %s to a fallback that may skip", (id, moment) => {
    const [gate] = resolveMoment({
      gates: { [id]: { [moment]: "required" } },
      moment,
      scripts: {},
    });
    expect(gate?.mode).toBe("run");
  });

  // The CI audit fallback fails when the audit yields no advisory data, so it
  // may own a mode-only declaration. Without the flag the gate fell through to
  // the registry's descriptive `security:audit` task, which Lisa does not ship
  // (#3359, regressed by #4144).
  it("keeps a mode-only dependency-vulnerability declaration on the built-in audit", () => {
    const [gate] = resolveMoment({
      gates: { "dependency-vulnerability": { [PULL_REQUEST]: "required" } },
      moment: PULL_REQUEST,
      runner: "bun run",
      scripts: {},
    });
    expect(gate).toMatchObject({
      id: "dependency-vulnerability",
      level: "required",
      mode: "builtin",
      task: null,
      command: null,
    });
  });

  it("reports facade delegation without claiming a local pass or failure", () => {
    const exec = vi.fn(() => ({ code: 0, output: "" }));
    const result = runGates({
      gates: { "learnings-budget": { [PULL_REQUEST]: "required" } },
      moment: PULL_REQUEST,
      scripts: {},
      exec,
      out: () => {},
      priorKills: [],
      recordKill: () => false,
      interrupted: () => null,
    });
    expect(exec).not.toHaveBeenCalled();
    expect(result.blocked).toBe(false);
    expect(result.passed).toEqual([]);
    expect(result.unprovable).toEqual([]);
    expect(result.skipped).toMatchObject([
      {
        id: "learnings-budget",
        mode: "builtin",
        detail: expect.stringContaining("facade"),
      },
    ]);
  });
});

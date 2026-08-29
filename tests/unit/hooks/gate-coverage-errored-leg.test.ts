/**
 * Coverage reports what the run PROVED, not what the project DECLARED.
 *
 * The `--coverage` file was written before a single gate executed, and it named
 * every declared floor property regardless of what then happened to it. The
 * hook that reads it stands its own built-in step down against every name in
 * there, so "declared" was being consumed as "proved".
 *
 * `runGates` sets `blocked` only when a REQUIRED gate goes unproved, so an
 * OPTIONAL gate that ran and errored left the runner exiting 0 with that gate
 * already listed as covered. The hook saw exit 0 plus a matching line, printed
 * "Covered by the type-correctness gate; the built-in type check stands down",
 * and allowed the push. The property was proved at NEITHER layer and the exit
 * code was success — a declared gate becoming a quieter way of turning a check
 * off than declaring it `off`, which is the one thing this subsystem exists to
 * refuse.
 *
 * Every outcome asserted here comes back from the real `runGates`. This file
 * imports a `.mjs` module with no declaration file, so TypeScript types that
 * import `any` and would not catch a hand-written `{ id, state }` literal
 * compiling against a shape production never emits. A test that passes on a
 * fictional input proves nothing, which is the defect this file exists to
 * close — not one to reproduce inside its own remedy.
 * @module tests/unit/hooks/gate-coverage-errored-leg
 */

import { afterAll, describe, expect, it } from "vitest";

import {
  cleanupStagedDirs,
  covers,
  HOOKS,
  runRunner,
} from "../../helpers/gate-coverage-harness.js";

import {
  EXIT,
  provenFloor,
  runGates,
  STATE,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";

const TYPES = "type-correctness";
const COVERAGE = "coverage-adequacy";
const AUDIT = "dependency-vulnerability";
const INTEGRATION = "test-integration";
const PUSH = "push";

/** The task-runner prefix the resolved commands are built with. */
const RUNNER_PREFIX = "npm run";

/** A transcript nothing in the classifier recognises, so nothing was measured. */
const UNRECOGNISED = "the widget exploded, and took the build with it";

/** A transcript that really does report a coverage floor being missed. */
const REAL_SHORTFALL =
  "ERROR: Coverage for statements (85.12%) does not meet global threshold (86%)";

/** A package script that exits zero, and one that does not. */
const SCRIPTS = {
  passes: 'node -e "process.exit(0)"',
  errors: 'node -e "process.exit(1)"',
};

afterAll(cleanupStagedDirs);

/**
 * Run gates through the REAL runner and hand back what it produced.
 * @param gates - The `gates` block to run
 * @param answers - Exit answers keyed by resolved command; default is a pass
 * @returns What `runGates` produced, unmodified
 */
function realRun(
  gates: Record<string, unknown>,
  answers: Record<string, { code: number | null; output: string }> = {}
): { results: { id: string; state: string }[]; blocked: boolean } {
  return runGates({
    gates,
    moment: PUSH,
    runner: RUNNER_PREFIX,
    exec: (command: string) => answers[command] ?? { code: 0, output: "" },
    out: () => {},
  });
}

describe("a leg that errored cannot stand a built-in step down", () => {
  it("drops an optional gate the runner reported UNPROVABLE", () => {
    const gates = {
      [TYPES]: { [PUSH]: { level: "optional", run: "typecheck" } },
    };
    const result = realRun(gates, {
      "npm run typecheck": { code: 1, output: UNRECOGNISED },
    });

    // The state is read off the real run, not asserted into existence: if the
    // runner ever stops classifying this as UNPROVABLE, this test says so.
    expect(result.results.map(entry => entry.state)).toEqual([
      STATE.UNPROVABLE,
    ]);
    expect(result.blocked).toBe(false);
    expect(provenFloor({ gates, moment: PUSH, result })).toEqual([]);
  });

  it("drops an optional gate the runner reported FAILED", () => {
    const gates = {
      [COVERAGE]: { [PUSH]: { level: "optional", run: "test:cov" } },
    };
    const result = realRun(gates, {
      "npm run test:cov": { code: 1, output: REAL_SHORTFALL },
    });

    expect(result.results.map(entry => entry.state)).toEqual([STATE.FAILED]);
    expect(result.blocked).toBe(false);
    expect(provenFloor({ gates, moment: PUSH, result })).toEqual([]);
  });

  it("drops an optional gate the runner reported KILLED", () => {
    const gates = {
      [TYPES]: { [PUSH]: { level: "optional", run: "typecheck" } },
    };
    const result = realRun(gates, {
      "npm run typecheck": { code: null, output: "" },
    });

    expect(result.results.map(entry => entry.state)).toEqual([STATE.KILLED]);
    expect(provenFloor({ gates, moment: PUSH, result })).toEqual([]);
  });

  it("drops a costly gate the runner never ran behind a blocker", () => {
    // A genuine NOT_RUN: gates resolve alphabetically, so the required
    // dependency-vulnerability leg fails first and the costly test-integration
    // leg is queued behind it with its verdict UNKNOWN.
    const gates = {
      [AUDIT]: { [PUSH]: { level: "required", run: "audit" } },
      [INTEGRATION]: { [PUSH]: { level: "optional", run: "test:int" } },
    };
    const result = realRun(gates, {
      "npm run audit": { code: 1, output: UNRECOGNISED },
    });

    const states = Object.fromEntries(
      result.results.map(entry => [entry.id, entry.state])
    );
    expect(states[INTEGRATION]).toBe(STATE.NOT_RUN);
    expect(provenFloor({ gates, moment: PUSH, result })).toEqual([]);
  });

  it("keeps a gate whose leg ran and passed", () => {
    // The other half of the contract. A fix that dropped this row would retire
    // the handover itself rather than the defect.
    const gates = {
      [TYPES]: { [PUSH]: { level: "required", run: "typecheck" } },
    };
    const result = realRun(gates);

    expect(result.results.map(entry => entry.state)).toEqual([STATE.PASSED]);
    expect(provenFloor({ gates, moment: PUSH, result })).toEqual([TYPES]);
  });

  it("keeps a gate declared off, which never ran by decision", () => {
    // `off` is a decision on the record, and the built-in standing down IS that
    // decision taking effect. An off gate never reaches `resolveMoment`, so the
    // real run reports no outcome for it — and an absent outcome must not be
    // mistaken for an unproved one.
    const gates = { [TYPES]: { [PUSH]: "off" } };
    const result = realRun(gates);

    expect(result.results).toEqual([]);
    expect(provenFloor({ gates, moment: PUSH, result })).toEqual([TYPES]);
  });

  it("covers nothing when there is no run to report", () => {
    expect(
      provenFloor({ gates: { [TYPES]: { [PUSH]: "off" } }, moment: PUSH })
    ).toEqual([]);
  });

  it("has a decision recorded for every state the runner can report", () => {
    // Drift guard. `UNPROVED_STATES` is a closed list inside the runner, so a
    // seventh state added upstream would silently default to "covered" — the
    // failure direction this whole change exists to remove. The four dropped
    // states are each exercised by a real run above; PASSED and SKIPPED are the
    // only two deliberately kept.
    expect(new Set(Object.values(STATE))).toEqual(
      new Set([
        STATE.PASSED,
        STATE.SKIPPED,
        STATE.FAILED,
        STATE.UNPROVABLE,
        STATE.KILLED,
        STATE.NOT_RUN,
      ])
    );
  });
});

describe("the runner and the hook agree about an errored leg", () => {
  const hook = HOOKS.find(entry => entry.moment === "push")?.file ?? "";

  it("finds a pre-push hook to read the coverage with", () => {
    expect(hook).not.toBe("");
  });

  it("leaves an errored optional gate out of the file it writes", () => {
    // End to end, and the whole defect in one assertion: the run is NOT
    // blocked (the gate is optional), so the hook is about to decide off the
    // coverage file alone.
    const { status, covered } = runRunner(
      { [TYPES]: { [PUSH]: { level: "optional", run: "errors" } } },
      PUSH,
      true,
      { errors: SCRIPTS.errors }
    );

    expect(status).toBe(EXIT.PROVED);
    expect(covered).not.toContain(TYPES);
    expect(covers(hook, covered, TYPES)).toBe(false);
  });

  it("still stands the step down when that same gate passes", () => {
    const { status, covered } = runRunner(
      { [TYPES]: { [PUSH]: { level: "optional", run: "passes" } } },
      PUSH,
      true,
      { passes: SCRIPTS.passes }
    );

    expect(status).toBe(EXIT.PROVED);
    expect(covered).toContain(TYPES);
    expect(covers(hook, covered, TYPES)).toBe(true);
  });
});

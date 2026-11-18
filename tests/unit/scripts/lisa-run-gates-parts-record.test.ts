/**
 * What a run with parts leaves behind for the things that read it afterwards.
 *
 * Three readers act on a run without seeing its transcript: the hook that
 * stands a built-in check down against the coverage file, whatever reads the
 * evidence envelope, and an operator reading the tally. Each has to be able
 * to tell that one folder went unproved while another passed.
 * @module tests/unit/scripts/lisa-run-gates-parts-record
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  evidenceDocument,
  provenFloor,
  runGates,
  STATE,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import {
  COMMIT,
  type GateRun,
  PUSH,
  RUNNER,
  sink,
  STYLE,
} from "./lisa-run-gates-fixtures.js";
import {
  API,
  API_ARGV,
  type ArgvExecutor,
  partGates,
  type PartsRepository,
  partsRepository,
  runParts,
  WEB,
  WEB_ARGV,
} from "./lisa-run-gates-parts-fixtures.js";

/** `code-style` is one of the checks the commit hook proves on its own. */
const STYLE_PARTS = partGates(
  [
    { scope: API, command: API_ARGV },
    { scope: WEB, command: WEB_ARGV },
  ],
  "required",
  STYLE
);

/** A gate whose command is a whole test suite: expensive to run. */
const TESTS = "test-correctness";

const OBSERVED_AT = "2026-11-17T00:00:00.000Z";

/**
 * An executor that fails in one folder and passes everywhere else.
 * @param failing - The folder whose command exits 1, or null for none
 * @returns The executor
 */
const failingIn =
  (failing: string | null): ArgvExecutor =>
  (_argv, context) => ({
    code: failing !== null && context.cwd.endsWith(failing) ? 1 : 0,
    output: null,
  });

describe("what a run with parts records", () => {
  let repository: PartsRepository;

  beforeEach(() => {
    repository = partsRepository();
  });

  afterEach(() => {
    repository.cleanup();
  });

  it("stands the built-in check down only when every part passed", () => {
    // A change inside both folders, so both parts run and between them they
    // reach all of it: what is left to decide is whether they passed.
    const touching = ["api/main.py", "web/index.ts"];
    const proved = runParts({
      execArgv: failingIn(null),
      gates: STYLE_PARTS,
      root: repository.root,
      touching,
    });
    const oneFailed = runParts({
      execArgv: failingIn(WEB),
      gates: STYLE_PARTS,
      root: repository.root,
      touching,
    });
    const floorAfter = (result: GateRun): string[] =>
      provenFloor({ gates: STYLE_PARTS, moment: COMMIT, result });

    expect(floorAfter(proved.result)).toEqual([STYLE]);
    // The last part to run is the one that failed here; the first passed. A
    // gate is proved by all of its parts or it is not proved.
    expect(floorAfter(oneFailed.result)).toEqual([]);
  });

  it("does not stand it down on passing parts alone, when the change is not known", () => {
    // Both parts ran and passed. Nothing says those two folders are all the
    // change touches, so the caller keeps its own check.
    const { result } = runParts({
      execArgv: failingIn(null),
      gates: STYLE_PARTS,
      root: repository.root,
    });

    expect(result.passed.map(entry => entry.scope)).toEqual([API, WEB]);
    expect(provenFloor({ gates: STYLE_PARTS, moment: COMMIT, result })).toEqual(
      []
    );
  });

  it("records one evidence row per part, each naming its folder", () => {
    const { result } = runParts({
      execArgv: failingIn(API),
      gates: STYLE_PARTS,
      root: repository.root,
    });
    const rows = evidenceDocument({
      gates: STYLE_PARTS,
      moment: COMMIT,
      observedAt: OBSERVED_AT,
      result,
      runner: RUNNER,
      verdict: "blocked",
    }).gates as Array<Record<string, unknown>>;

    expect(rows).toEqual([
      expect.objectContaining({ gate: STYLE, scope: API, status: "fail" }),
      expect.objectContaining({ gate: STYLE, scope: WEB, status: "pass" }),
    ]);
  });

  it("leaves the evidence row of a gate with no parts as it was", () => {
    const gates = { [STYLE]: { [COMMIT]: "required" } };
    const result = runGates({
      exec: () => 0,
      gates,
      moment: COMMIT,
      out: () => {},
      runner: RUNNER,
    }) as GateRun;
    const rows = evidenceDocument({
      gates,
      moment: COMMIT,
      observedAt: OBSERVED_AT,
      result,
      runner: RUNNER,
      verdict: "proved",
    }).gates as Array<Record<string, unknown>>;

    expect(rows.map(row => Object.keys(row))).toEqual([
      ["gate", "status", "level", "label"],
    ]);
  });

  it("says which folder stopped the expensive parts queued behind it", () => {
    const { lines, out } = sink();
    const execArgv = vi.fn<ArgvExecutor>(failingIn(API));
    const result = runGates({
      exec: () => 0,
      execArgv,
      gates: {
        [TESTS]: {
          [PUSH]: "required",
          parts: [
            { scope: API, command: API_ARGV },
            { scope: WEB, command: WEB_ARGV },
          ],
        },
      },
      moment: PUSH,
      out,
      priorKills: [],
      recordKill: () => true,
      root: repository.root,
      runner: RUNNER,
    }) as GateRun;
    const transcript = lines.join("\n");

    // A test suite is too expensive to run for information alone once the
    // push is already blocked, so the second folder's is not started.
    expect(execArgv).toHaveBeenCalledTimes(1);
    expect(result.notRun).toHaveLength(1);
    expect(result.blockedBy).toBe(TESTS);
    expect(transcript).toContain(
      `never ran; ${TESTS} in ${API} failed first and this gate is too expensive`
    );
    expect(transcript).toContain(
      `never ran, verdict not established: ${TESTS} in ${WEB}`
    );
    expect(transcript).toContain(
      `${TESTS} in ${API} failed first and stopped them.`
    );
  });

  it("names the folder of a part an interrupted run never reached", () => {
    const { lines, out } = sink();
    const execArgv = vi.fn<ArgvExecutor>(() => 0);
    const result = runGates({
      exec: () => 0,
      execArgv,
      gates: STYLE_PARTS,
      interrupted: () => "the run that started it (pid 4242) exited",
      moment: COMMIT,
      out,
      priorKills: [],
      root: repository.root,
      runner: RUNNER,
    }) as GateRun;

    expect(execArgv).not.toHaveBeenCalled();
    expect(result.notRun.map(row => row.state)).toEqual([
      STATE.NOT_RUN,
      STATE.NOT_RUN,
    ]);
    expect(lines.join("\n")).toContain(
      `never ran, verdict not established: ${STYLE} in ${API}, ${STYLE} in ${WEB}`
    );
  });
});

/**
 * The gate runner on a gate that declares `parts`.
 *
 * Each part is one argument list started in the part's own folder. It is
 * never joined into text a shell would read, and it is judged by the same
 * rules as every other gate: exit 0 is not proof, a kill is not a failure, and
 * a failure says which failure it was.
 *
 * The executor is injected here, so nothing is started. Starting a real
 * process is `lisa-run-gates-parts-spawn.test.ts`.
 * @module tests/unit/controls/lisa-run-gates-parts
 */
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DIAGNOSIS } from "../../../all/copy-overwrite/scripts/lib/gate-failure-diagnosis.mjs";
import { STATE } from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { COMMIT, STYLE } from "../scripts/lisa-run-gates-fixtures.js";
import {
  API,
  API_ARGV,
  type ArgvAnswer,
  type ArgvExecutor,
  LINT,
  partGates,
  partLine,
  partRow,
  type PartsRepository,
  partsRepository,
  runParts,
  WEB,
  WEB_ARGV,
} from "./support/lisa-run-gates-parts-fixtures.js";

const API_PART = { scope: API, command: API_ARGV };
const WEB_PART = { scope: WEB, command: WEB_ARGV };
const BOTH = partGates([API_PART, WEB_PART]);

const API_NAME = `${LINT} in ${API}`;
const WEB_NAME = `${LINT} in ${WEB}`;

/** vitest, `--passWithNoTests`, no test files present. */
const ZERO_TESTS = "No test files found, exiting with code 0";

/** How this project's own linter prints a measured failure. */
const LINT_SHAPE = "✖ lint problems";

/** Output no shipped classifier recognises. */
const UNRECOGNISED = "something this runner has never seen\n";

/**
 * An executor answering by the folder it was started in.
 * @param answers - What to answer in each folder; anything unlisted passes
 * @returns The executor, recording every call
 */
function answering(
  answers: Record<string, ArgvAnswer> = {}
): ReturnType<typeof vi.fn<ArgvExecutor>> {
  return vi.fn<ArgvExecutor>((_argv, context) => {
    const answer = answers[path.basename(context.cwd)];
    return answer === undefined ? { code: 0, output: "" } : answer;
  });
}

describe("a gate with parts in the gate runner", () => {
  let repository: PartsRepository;

  beforeEach(() => {
    repository = partsRepository();
  });

  afterEach(() => {
    repository.cleanup();
  });

  it("starts each part's argument list as declared, in its own folder", () => {
    const execArgv = answering();
    const exec = vi.fn<(command: string) => number>(() => 0);

    runParts({ exec, execArgv, gates: BOTH, root: repository.root });

    expect(execArgv.mock.calls.map(([argv]) => argv)).toEqual([
      API_ARGV,
      WEB_ARGV,
    ]);
    expect(execArgv.mock.calls.map(([, context]) => context.cwd)).toEqual([
      path.join(repository.root, API),
      path.join(repository.root, WEB),
    ]);
    // A part is never handed to the executor that takes one command line.
    expect(exec).not.toHaveBeenCalled();
  });

  it("starts a part scoped to the whole repository at its root", () => {
    const execArgv = answering();

    runParts({
      execArgv,
      gates: partGates([{ scope: ".", command: API_ARGV }]),
      root: repository.root,
    });

    expect(execArgv.mock.calls[0]?.[1].cwd).toBe(repository.root);
  });

  it("prints one line per part, named by gate and folder", () => {
    const run = runParts({
      execArgv: answering(),
      gates: BOTH,
      root: repository.root,
    });

    expect(partLine(run, API_NAME)).toContain("PASSED");
    expect(partLine(run, API_NAME)).toContain(JSON.stringify(API_ARGV));
    expect(partLine(run, WEB_NAME)).toContain("PASSED");
    expect(partLine(run, WEB_NAME)).toContain(JSON.stringify(WEB_ARGV));
    expect(run.result.total).toBe(2);
    expect(run.result.passed.map(row => row.scope)).toEqual([API, WEB]);
    expect(run.result.blocked).toBe(false);
  });

  it("says which folder failed and still reports the one that passed", () => {
    const run = runParts({
      execArgv: answering({ [API]: { code: 1, output: null } }),
      gates: BOTH,
      root: repository.root,
    });

    expect(partRow(run, API).state).toBe(STATE.FAILED);
    expect(partRow(run, API).code).toBe(1);
    expect(partRow(run, WEB).state).toBe(STATE.PASSED);
    expect(partLine(run, API_NAME)).toContain("FAILED");
    expect(run.transcript).toContain(`required gate FAILED: ${API_NAME} — `);
    expect(run.transcript).not.toContain(`FAILED: ${WEB_NAME}`);
    expect(run.result.blocked).toBe(true);
    expect(run.result.blockedBy).toBe(LINT);
  });

  it("does not block on an optional part that fails, and still says so", () => {
    const run = runParts({
      execArgv: answering({ [WEB]: { code: 2, output: null } }),
      gates: partGates([API_PART, WEB_PART], "optional"),
      root: repository.root,
    });

    expect(run.result.blocked).toBe(false);
    expect(run.transcript).toContain(`optional gate FAILED: ${WEB_NAME}`);
  });
});

describe("a part is judged the way every gate is", () => {
  let repository: PartsRepository;

  beforeEach(() => {
    repository = partsRepository();
  });

  afterEach(() => {
    repository.cleanup();
  });

  it("reports a part that exited 0 having run no tests as not proved", () => {
    const run = runParts({
      execArgv: answering({ [API]: { code: 0, output: ZERO_TESTS } }),
      gates: BOTH,
      root: repository.root,
    });
    const row = partRow(run, API);

    expect(row.state).toBe(STATE.UNPROVABLE);
    expect(row.diagnosis).toBe(DIAGNOSIS.NO_TESTS_RAN);
    expect(run.result.passed.map(entry => entry.scope)).toEqual([WEB]);
    expect(run.transcript).toContain(`gate NOT PROVED: ${API_NAME}`);
    expect(run.result.blocked).toBe(true);
  });

  it("reports a part whose command was killed as killed, not failed", () => {
    const run = runParts({
      execArgv: answering({ [WEB]: { code: null, output: null } }),
      gates: BOTH,
      root: repository.root,
    });

    expect(partRow(run, WEB).state).toBe(STATE.KILLED);
    expect(run.result.killed.map(row => row.scope)).toEqual([WEB]);
    expect(run.transcript).toContain(`KILLED: ${WEB_NAME}`);
    expect(run.result.blocked).toBe(true);
  });

  it("reads a part's declared failure shape before calling it unknown", () => {
    const declared = partGates([
      API_PART,
      { ...WEB_PART, proof: { failure_shape: [LINT_SHAPE] } },
    ]);
    const output = `${UNRECOGNISED}${LINT_SHAPE} in 3 files\n`;
    const run = runParts({
      execArgv: answering({
        [API]: { code: 1, output },
        [WEB]: { code: 1, output },
      }),
      gates: declared,
      root: repository.root,
    });

    // Same output, same exit code: only the part that declared the shape may
    // call it a measured failure.
    expect(partRow(run, WEB).state).toBe(STATE.FAILED);
    expect(partRow(run, WEB).diagnosis).toBe(DIAGNOSIS.DECLARED_FAILURE);
    expect(partRow(run, API).state).toBe(STATE.UNPROVABLE);
    expect(partRow(run, API).diagnosis).toBe(DIAGNOSIS.UNDIAGNOSED);
  });

  it("reports a part whose program could not be started as not proved", () => {
    const reason = 'the program "go" was not found';
    const run = runParts({
      execArgv: answering({
        [API]: { code: null, output: null, notStarted: reason },
      }),
      gates: BOTH,
      root: repository.root,
    });
    const row = partRow(run, API);

    expect(row.state).toBe(STATE.UNPROVABLE);
    expect(row.code).toBeNull();
    expect(partLine(run, API_NAME)).toContain(reason);
    expect(run.result.passed.map(entry => entry.scope)).toEqual([WEB]);
    expect(run.result.killed).toEqual([]);
    expect(run.result.blocked).toBe(true);
  });
});

describe("parts beside gates that have none", () => {
  let repository: PartsRepository;

  beforeEach(() => {
    repository = partsRepository();
  });

  afterEach(() => {
    repository.cleanup();
  });

  it("runs a gate with no parts through the command-line executor", () => {
    const exec = vi.fn<(command: string) => number>(() => 0);
    const execArgv = answering();
    const run = runParts({
      exec,
      execArgv,
      gates: { ...BOTH, [STYLE]: { [COMMIT]: "required" } },
      root: repository.root,
    });

    expect(exec.mock.calls.map(([command]) => command)).toEqual([
      "bun run lint",
    ]);
    expect(execArgv).toHaveBeenCalledTimes(2);
    expect(run.result.total).toBe(3);
    expect(run.transcript).toContain("Each part of a gate is counted");
  });

  it("starts one argument list once for two gates naming it in one folder", () => {
    const execArgv = answering();
    const other = "x-vet";
    const run = runParts({
      execArgv,
      gates: {
        ...partGates([API_PART]),
        ...partGates(
          [API_PART, { scope: WEB, command: API_ARGV }],
          "required",
          other
        ),
      },
      root: repository.root,
    });

    // `x-lint in api` and `x-vet in api` are one command in one folder; the
    // same list in `web` is a different check.
    expect(execArgv).toHaveBeenCalledTimes(2);
    expect(partLine(run, `${other} in ${API}`)).toContain(
      `(proved by the ${API_NAME} run)`
    );
    expect(run.result.passed).toHaveLength(3);
  });
});

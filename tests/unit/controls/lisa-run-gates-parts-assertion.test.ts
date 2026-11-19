/**
 * Only an argument list ever reaches the call that starts a process.
 *
 * Validation already refuses a part whose command is one string. This is the
 * second check, in the runner itself: whatever the resolver hands over, a
 * command that is not a list of text is reported against its part and nothing
 * is started — because a string would have to be split by something, and
 * whatever splits it is a shell or an imitation of one.
 *
 * The call that starts a process is replaced here so each case can state that
 * it was never reached, and so the options it is given can be read.
 * @module tests/unit/controls/lisa-run-gates-parts-assertion
 */
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COMMIT,
  type GateRun,
  RUNNER,
  sink,
} from "../scripts/lisa-run-gates-fixtures.js";
import {
  API,
  type ArgvExecutor,
  LINT,
  type PartsRepository,
  partsRepository,
} from "./support/lisa-run-gates-parts-fixtures.js";

const { boundedSpawnSync, resolveMoment } = vi.hoisted(() => ({
  boundedSpawnSync: vi.fn(),
  resolveMoment: vi.fn(),
}));

vi.mock(
  "../../../all/copy-overwrite/scripts/lib/bounded-spawn.mjs",
  async importActual => ({
    ...(await importActual<object>()),
    boundedSpawnSync,
  })
);

vi.mock(
  "../../../all/copy-overwrite/scripts/lisa-gates.mjs",
  async importActual => ({
    ...(await importActual<object>()),
    resolveMoment,
  })
);

const NODE = process.execPath;

/** A command written the way validation refuses: one string. */
const ONE_STRING = "sh -c 'touch pwned'";

/** Commands that are not a list of text naming a program. */
const NOT_ARGUMENT_LISTS: ReadonlyArray<readonly [string, unknown]> = [
  ["one string", ONE_STRING],
  ["nothing", undefined],
  ["null", null],
  ["an empty list", []],
  ["a blank program", ["  ", "--version"]],
  ["a number among the arguments", ["node", 3]],
  ["a NUL character in an argument", ["node", "a\0b"]],
  ["an object", { 0: "node", length: 1 }],
];

/**
 * A resolved entry for one part, as the resolver would hand it over.
 * @param argv - What the entry carries as its argument list
 * @returns The entry
 */
const forgedPart = (argv: unknown): Record<string, unknown> => ({
  id: LINT,
  level: "required",
  mode: "run",
  awaits: null,
  postedBy: null,
  declared: null,
  task: null,
  command: null,
  label: LINT,
  work: null,
  alias: null,
  evidence: null,
  callerChain: null,
  failureShape: null,
  mayRewrite: false,
  costly: false,
  scope: API,
  argv,
});

/**
 * The error Node attaches to a child it killed at its deadline.
 * @returns The error, carrying Node's timeout code
 */
const killedError = (): Error =>
  Object.assign(new Error("spawnSync ETIMEDOUT"), { code: "ETIMEDOUT" });

describe("only an argument list reaches the call that starts a process", () => {
  let repository: PartsRepository;
  let api: string;

  beforeEach(() => {
    repository = partsRepository();
    api = path.join(repository.root, API);
    boundedSpawnSync.mockReset();
    resolveMoment.mockReset();
  });

  afterEach(() => {
    repository.cleanup();
  });

  it.each(NOT_ARGUMENT_LISTS)(
    "the shipped executor refuses %s before starting anything",
    async (_label, command) => {
      const { spawnArgv } =
        await import("../../../all/copy-overwrite/scripts/lisa-run-gates.mjs");

      expect(() => spawnArgv(command as never, { cwd: api })).toThrow(
        TypeError
      );
      expect(boundedSpawnSync).not.toHaveBeenCalled();
    }
  );

  it.each(["win32", "linux"])(
    "refuses one string on %s too",
    async platform => {
      const { spawnArgv } =
        await import("../../../all/copy-overwrite/scripts/lisa-run-gates.mjs");

      expect(() =>
        spawnArgv(ONE_STRING as never, { cwd: api, platform })
      ).toThrow(TypeError);
      expect(boundedSpawnSync).not.toHaveBeenCalled();
    }
  );

  it.each(NOT_ARGUMENT_LISTS)(
    "the runner reports a part carrying %s and starts nothing",
    async (_label, command) => {
      const { runGates, STATE } =
        await import("../../../all/copy-overwrite/scripts/lisa-run-gates.mjs");
      resolveMoment.mockReturnValue([forgedPart(command)]);
      const { lines, out } = sink();

      // The executor the runner ships, so "nothing was started" is a claim
      // about the real call and not about a stand-in.
      const result = runGates({
        exec: () => 0,
        gates: {},
        moment: COMMIT,
        out,
        priorKills: [],
        root: repository.root,
        runner: RUNNER,
      }) as GateRun;

      expect(boundedSpawnSync).not.toHaveBeenCalled();
      expect(result.results[0]?.state).toBe(STATE.UNPROVABLE);
      expect(result.passed).toEqual([]);
      expect(result.blocked).toBe(true);
      expect(lines.join("\n")).toContain(`${LINT} in ${API}`);
    }
  );

  it("does not hand a forged command to an injected executor either", async () => {
    const { runGates } =
      await import("../../../all/copy-overwrite/scripts/lisa-run-gates.mjs");
    resolveMoment.mockReturnValue([forgedPart(ONE_STRING)]);
    const execArgv = vi.fn<ArgvExecutor>(() => 0);

    runGates({
      exec: () => 0,
      execArgv,
      gates: {},
      moment: COMMIT,
      out: () => {},
      priorKills: [],
      root: repository.root,
      runner: RUNNER,
    });

    expect(execArgv).not.toHaveBeenCalled();
  });
});

describe.skipIf(process.platform === "win32")(
  "how the shipped executor starts a part",
  () => {
    let repository: PartsRepository;
    let api: string;

    beforeEach(() => {
      repository = partsRepository();
      api = path.join(repository.root, API);
      boundedSpawnSync.mockReset();
    });

    afterEach(() => {
      repository.cleanup();
    });

    it("starts the argument list through the supervisor, with no shell, in the part's folder", async () => {
      boundedSpawnSync.mockReturnValue({
        status: 0,
        output: [null, null, null, "ok"],
        error: undefined,
      });
      const { spawnArgv } =
        await import("../../../all/copy-overwrite/scripts/lisa-run-gates.mjs");
      const argv = [NODE, "--version", "; touch pwned"];

      expect(spawnArgv(argv, { cwd: api })).toEqual({ code: 0, output: "ok" });

      expect(boundedSpawnSync).toHaveBeenCalledTimes(1);
      const [executable, args, options] = boundedSpawnSync.mock.calls[0] as [
        string,
        string[],
        Record<string, unknown>,
      ];
      expect(executable).toBe(process.execPath);
      expect(args[0]).toContain("process-tree-runner.mjs");
      expect(args).toContain("--direct-argv");
      // Everything after the separator is the declared list, item for item.
      expect(args.slice(args.indexOf("--") + 1)).toEqual(argv);
      expect(options.shell).toBe(false);
      expect(options.cwd).toBe(api);
      // The runner's own environment, as every other gate command gets.
      expect(options.env).toBeUndefined();
      expect(typeof options.timeout).toBe("number");
    });

    it("answers with no verdict when the command is killed at its deadline", async () => {
      boundedSpawnSync.mockImplementation(() => {
        throw killedError();
      });
      const { spawnArgv } =
        await import("../../../all/copy-overwrite/scripts/lisa-run-gates.mjs");

      expect(spawnArgv([NODE, "--version"], { cwd: api })).toEqual({
        code: null,
        output: null,
      });
    });

    it("does not swallow a fault it cannot name", async () => {
      boundedSpawnSync.mockImplementation(() => {
        throw new Error("the module itself is broken");
      });
      const { spawnArgv } =
        await import("../../../all/copy-overwrite/scripts/lisa-run-gates.mjs");

      expect(() => spawnArgv([NODE, "--version"], { cwd: api })).toThrow(
        "the module itself is broken"
      );
    });

    it("refuses to start in a folder that is not there", async () => {
      const { spawnArgv } =
        await import("../../../all/copy-overwrite/scripts/lisa-run-gates.mjs");

      const answer = spawnArgv([NODE, "--version"], {
        cwd: path.join(repository.root, "gone"),
      }) as { code: number | null; notStarted?: string };

      expect(answer.code).toBeNull();
      expect(answer.notStarted).toContain("does not exist");
      expect(boundedSpawnSync).not.toHaveBeenCalled();
    });
  }
);

/**
 * The gate runner's verdicts in a repository with no `package.json`
 * (CodySwannGT/lisa#4987).
 *
 * Two claims, and the second matters as much as the first:
 *
 * - A part's command runs and its exit status decides the result. No manifest
 *   is needed, and the task runner is never asked for anything.
 * - A gate with no parts has no way to run there. It is reported as not
 *   proved — at `required`, where it stops the commit, and at `optional`,
 *   where it does not stop anything but is still not a pass.
 *
 * The executors are injected, so nothing is started here. The real command
 * line on the real fixture is `tests/integration/controls-no-manifest-runner`.
 * @module tests/unit/scripts/lisa-run-gates-no-manifest
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  provenFloor,
  runGates,
  STATE,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { projectScripts } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  type ControlAuditFixture,
  buildFNone,
} from "../../helpers/control-audit-fixtures.js";
import { type GateRun, sink } from "./lisa-run-gates-fixtures.js";
import { type ArgvExecutor } from "../controls/support/lisa-run-gates-parts-fixtures.js";

const COMMIT = "commit";
const PUSH = "push";
const STYLE = "code-style";
const HISTORY = "introduced-history-credential-leakage";
const LEAKAGE = "credential-leakage";
const LEVELS = ["required", "optional"] as const;

/** What the declared linter prints when it measured a failure. */
const LINT_SHAPE = "Found 1 error";
const RUFF = ["ruff", "check", "."];

/** What starting a task runner's command line answers with. */
type TaskRunner = (
  command: string
) => number | null | { code: number | null; output: string | null };

/** What `npm run` says in a folder with no `package.json`. */
const NPM_NO_MANIFEST = {
  code: 254,
  output: "npm error enoent Could not read package.json\n",
};

/** A level written either way a project may write it. */
const SPELLINGS: ReadonlyArray<
  readonly [string, (level: string) => string | { level: string }]
> = [
  ["a bare level", level => level],
  ["an object with a level", level => ({ level })],
];

/** The states in which a gate was not proved. */
const NOT_PROVED = [STATE.FAILED, STATE.UNPROVABLE, STATE.KILLED];

/**
 * A gates block declaring one part that covers the whole repository.
 * @param level - The gate's level at commit
 * @returns The gates block
 */
function onePart(level: string): Record<string, unknown> {
  return {
    [STYLE]: {
      [COMMIT]: level,
      parts: [
        { scope: ".", command: RUFF, proof: { failure_shape: [LINT_SHAPE] } },
      ],
    },
  };
}

describe("the gate runner in a repository with no package.json", () => {
  let fixture: ControlAuditFixture;

  beforeAll(() => {
    fixture = buildFNone();
  });

  afterAll(() => {
    fixture.cleanup();
  });

  /**
   * Run a gates block in F-none, with the manifest read from the fixture.
   * @param options - Run inputs
   * @param options.gates - The gates block
   * @param options.moment - The moment to run
   * @param options.exec - What the task runner's command line answers
   * @param options.execArgv - What a part's command answers
   * @param options.builtins - Whether the caller has checks of its own
   * @returns The run and the lines it printed
   */
  function run(options: {
    readonly gates: Record<string, unknown>;
    readonly moment?: string;
    readonly exec?: TaskRunner;
    readonly execArgv?: ArgvExecutor;
    readonly builtins?: boolean;
  }): { result: GateRun; transcript: string } {
    const { lines, out } = sink();
    const result = runGates({
      exec: options.exec ?? (() => 0),
      execArgv: options.execArgv ?? (() => ({ code: 0, output: "" })),
      gates: options.gates,
      moment: options.moment ?? COMMIT,
      out,
      priorKills: [],
      recordKill: () => true,
      root: fixture.repoPath,
      scripts: projectScripts(fixture.repoPath),
      ...(options.builtins === undefined ? {} : { builtins: options.builtins }),
    }) as GateRun;
    return { result, transcript: lines.join("\n") };
  }

  describe("a declared part", () => {
    it("is started in its folder and proved by a zero exit", () => {
      const execArgv = vi.fn<ArgvExecutor>(() => ({ code: 0, output: "" }));
      const exec = vi.fn<(command: string) => number>(() => 0);

      const { result } = run({ exec, execArgv, gates: onePart("required") });

      expect(execArgv).toHaveBeenCalledTimes(1);
      expect(execArgv.mock.calls[0]?.[0]).toEqual(RUFF);
      expect(execArgv.mock.calls[0]?.[1].cwd).toBe(fixture.repoPath);
      expect(result.passed.map(entry => entry.id)).toEqual([STYLE]);
      expect(result.blocked).toBe(false);
      // No part is ever handed to the task runner, so no manifest is needed.
      expect(exec).not.toHaveBeenCalled();
    });

    it("is failed by a non-zero exit, and that stops the commit", () => {
      const { result, transcript } = run({
        execArgv: () => ({ code: 1, output: `${LINT_SHAPE}.\n` }),
        gates: onePart("required"),
      });

      expect(result.results.map(entry => entry.state)).toEqual([STATE.FAILED]);
      expect(result.results[0]?.code).toBe(1);
      expect(result.passed).toEqual([]);
      expect(result.blocked).toBe(true);
      expect(result.blockedBy).toBe(STYLE);
      expect(transcript).toContain(`required gate FAILED: ${STYLE} in .`);
    });

    it("is not proved by a non-zero exit nobody can read, and that stops the commit too", () => {
      const { result } = run({
        execArgv: () => ({ code: 3, output: "boom\n" }),
        gates: onePart("required"),
      });

      expect(NOT_PROVED).toContain(result.results[0]?.state);
      expect(result.passed).toEqual([]);
      expect(result.blocked).toBe(true);
    });

    it("reports an optional failure without stopping the commit", () => {
      const { result, transcript } = run({
        execArgv: () => ({ code: 1, output: `${LINT_SHAPE}.\n` }),
        gates: onePart("optional"),
      });

      expect(result.results.map(entry => entry.state)).toEqual([STATE.FAILED]);
      expect(result.passed).toEqual([]);
      expect(result.blocked).toBe(false);
      expect(transcript).toContain(`optional gate FAILED: ${STYLE} in .`);
    });
  });

  describe.each(LEVELS)("a %s gate with no parts and no run", level => {
    it.each(SPELLINGS)(
      "is not proved at commit or at push, declared as %s",
      (_name, spell) => {
        for (const moment of [COMMIT, PUSH]) {
          const exec = vi.fn<TaskRunner>(() => NPM_NO_MANIFEST);

          const { result, transcript } = run({
            exec,
            gates: { [STYLE]: { [moment]: spell(level) } },
            moment,
          });

          // Today's behaviour, kept: the task runner is asked, and it has no
          // manifest to read.
          expect(exec.mock.calls.map(([command]) => command)).toEqual([
            "npm run lint",
          ]);
          expect(result.total).toBe(1);
          expect(result.passed).toEqual([]);
          expect(result.skipped).toEqual([]);
          expect(result.unprovable.map(entry => entry.id)).toEqual([STYLE]);
          expect(result.blocked).toBe(level === "required");
          expect(transcript).toContain(`${level} gate NOT PROVED: ${STYLE}`);
        }
      }
    );

    it("is never a property the hook may stand a check down for", () => {
      const gates = { [STYLE]: { [COMMIT]: level } };
      const { result } = run({ exec: () => NPM_NO_MANIFEST, gates });

      expect(provenFloor({ gates, moment: COMMIT, result })).toEqual([]);
    });
  });

  describe("a gate that leaves the check to the caller's built-in", () => {
    it("is left to that built-in when the caller has one, as before", () => {
      const { result } = run({
        gates: { [HISTORY]: { [PUSH]: "required" } },
        moment: PUSH,
      });

      expect(result.results.map(entry => entry.state)).toEqual([STATE.SKIPPED]);
      expect(result.blocked).toBe(false);
    });

    it.each(LEVELS)(
      "is not proved at %s when the caller has no built-in checks",
      level => {
        const { result, transcript } = run({
          builtins: false,
          gates: { [HISTORY]: { [PUSH]: level } },
          moment: PUSH,
        });

        expect(result.results.map(entry => entry.state)).toEqual([
          STATE.UNPROVABLE,
        ]);
        expect(result.passed).toEqual([]);
        expect(result.skipped).toEqual([]);
        expect(result.blocked).toBe(level === "required");
        expect(transcript).toContain(`${level} gate NOT PROVED: ${HISTORY}`);
        expect(transcript).toContain("no built-in checks");
        // A gate id longer than its column still ends before the reason starts.
        expect(transcript).toContain(
          `UNPROVABLE ${level} ${HISTORY} left to a check built in to the caller`
        );
      }
    );

    it("is not proved either where a manifest exists and has no such script", () => {
      const { lines, out } = sink();
      const result = runGates({
        builtins: false,
        exec: () => 0,
        gates: { [LEAKAGE]: { [COMMIT]: "required" } },
        moment: COMMIT,
        out,
        priorKills: [],
        recordKill: () => true,
        root: fixture.repoPath,
        scripts: {},
      }) as GateRun;

      expect(result.results.map(entry => entry.state)).toEqual([
        STATE.UNPROVABLE,
      ]);
      expect(result.blocked).toBe(true);
      expect(lines.join("\n")).toContain("no built-in checks");
    });

    it("leaves every other kind of gate alone when the caller has none", () => {
      const execArgv = vi.fn<ArgvExecutor>(() => ({ code: 0, output: "" }));

      const { result } = run({
        builtins: false,
        execArgv,
        gates: onePart("required"),
      });

      expect(result.passed.map(entry => entry.id)).toEqual([STYLE]);
      expect(result.blocked).toBe(false);
    });
  });
});

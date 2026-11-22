/**
 * A part's command, started for real.
 *
 * Everything here starts a process, because the claims are about what a
 * process receives: every argument exactly as written, with nothing between
 * the declaration and the program to read `;` or `$(…)` as an instruction; the
 * part's own folder as its working directory; and the runner's environment.
 * A program that cannot be found is named and is never a pass.
 * @module tests/unit/controls/lisa-run-gates-parts-spawn
 */
import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DIAGNOSIS } from "../../../all/copy-overwrite/scripts/lib/gate-failure-diagnosis.mjs";
import {
  runGates,
  spawnArgv,
  STATE,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { COMMIT, RUNNER, sink } from "../scripts/lisa-run-gates-fixtures.js";
import {
  API,
  type ArgvAnswer,
  LINT,
  partGates,
  type PartsGateRun,
  type PartsRepository,
  partsRepository,
  WEB,
} from "./support/lisa-run-gates-parts-fixtures.js";

const NODE = process.execPath;

/** Prints the arguments the program received, as JSON. */
const PRINT_ARGUMENTS =
  "process.stdout.write(JSON.stringify(process.argv.slice(1)))";

/** Writes the arguments the program received to `received.json`. */
const SAVE_ARGUMENTS =
  "require('node:fs').writeFileSync('received.json', JSON.stringify(process.argv.slice(1)))";

/** The file a program leaves to say which folder it was started in. */
const STARTED_IN = "started-in";

/** Writes the folder the program was started in to that file. */
const SAVE_FOLDER = `require('node:fs').writeFileSync('${STARTED_IN}', process.cwd())`;

/** A program named by a path from the part's own folder. */
const LOCAL_PROGRAM = "./check.sh";

/** A program these cases put on PATH themselves. */
const PROBE = "lisa-part-probe";

/** A part executor's answer in its object form. */
type Answer = Exclude<ArgvAnswer, number | null>;

/** Everything a shell would act on, each as one argument. */
const SHELL_SYNTAX = [
  "; touch pwned",
  "$(touch pwned-substitution)",
  "`touch pwned-backtick`",
  "&& touch pwned-and",
  "| tee pwned-pipe",
  "> pwned-redirect",
  "*",
  "$HOME",
  "two words",
  "'quoted'",
];

/** A program name nothing on this machine answers to. */
const MISSING_PROGRAM = "lisa-no-such-program-4986";

/** vitest, `--passWithNoTests`, no test files present. */
const ZERO_TESTS = "No test files found, exiting with code 0";

/** One real run of a gates block at commit, through the shipped executor. */
interface RealRun {
  readonly result: PartsGateRun;
  readonly transcript: string;
}

/**
 * Run a gates block at commit with the executor the runner ships.
 * @param gates - The gates block
 * @param root - The repository root
 * @returns The run and what it printed
 */
function runForReal(gates: Record<string, unknown>, root: string): RealRun {
  const { lines, out } = sink();
  const result = runGates({
    exec: () => 0,
    gates,
    moment: COMMIT,
    out,
    priorKills: [],
    recordKill: () => true,
    root,
    runner: RUNNER,
  }) as RealRun["result"];
  return { result, transcript: lines.join("\n") };
}

describe.skipIf(process.platform === "win32")(
  "a part's command is started directly",
  () => {
    let repository: PartsRepository;
    let api: string;

    beforeEach(() => {
      repository = partsRepository();
      api = path.join(repository.root, API);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      repository.cleanup();
    });

    it("hands the program every argument exactly as written", () => {
      const answer = spawnArgv([NODE, "-e", PRINT_ARGUMENTS, ...SHELL_SYNTAX], {
        cwd: api,
      }) as Answer;

      expect(answer.code).toBe(0);
      expect(JSON.parse(answer.output ?? "null")).toEqual(SHELL_SYNTAX);
    });

    it("creates nothing a shell would have created from those arguments", () => {
      spawnArgv([NODE, "-e", PRINT_ARGUMENTS, ...SHELL_SYNTAX], { cwd: api });

      expect(readdirSync(api)).toEqual([]);
      expect(
        readdirSync(repository.root).sort((left, right) =>
          left.localeCompare(right)
        )
      ).toEqual([API, WEB]);
    });

    it("starts the program in the part's folder and nowhere else", () => {
      const { result } = runForReal(
        partGates([{ scope: API, command: [NODE, "-e", SAVE_FOLDER] }]),
        repository.root
      );

      expect(result.passed.map(row => row.scope)).toEqual([API]);
      expect(readFileSync(path.join(api, STARTED_IN), "utf8")).toBe(api);
      expect(existsSync(path.join(repository.root, STARTED_IN))).toBe(false);
      expect(existsSync(path.join(repository.root, WEB, STARTED_IN))).toBe(
        false
      );
    });

    it("gives the program the runner's own environment", () => {
      vi.stubEnv("LISA_PART_MARKER", "inherited");

      const answer = spawnArgv(
        [NODE, "-e", "process.stdout.write(process.env.LISA_PART_MARKER)"],
        { cwd: api }
      ) as Answer;

      expect(answer).toEqual({ code: 0, output: "inherited" });
    });

    it("keeps the program's own exit code and what it printed", () => {
      const answer = spawnArgv(
        [NODE, "-e", "console.log('3 problems'); process.exit(3)"],
        { cwd: api }
      ) as Answer;

      expect(answer.code).toBe(3);
      expect(answer.output).toContain("3 problems");
    });

    it("keeps the exit code when capture is switched off", () => {
      vi.stubEnv("LISA_GATES_CAPTURE", "0");

      expect(spawnArgv([NODE, "-e", "process.exit(4)"], { cwd: api })).toEqual({
        code: 4,
        output: null,
      });
    });

    it("finds a program named by a path from the part's folder", () => {
      const script = path.join(api, LOCAL_PROGRAM);
      writeFileSync(script, "#!/bin/sh\necho checked\nexit 5\n");
      chmodSync(script, 0o755);

      const answer = spawnArgv([LOCAL_PROGRAM], { cwd: api }) as Answer;

      expect(answer.code).toBe(5);
      expect(answer.output).toContain("checked");
    });

    it("finds a program by name on PATH", () => {
      const tools = path.join(repository.root, WEB);
      writeFileSync(path.join(tools, PROBE), "#!/bin/sh\nexit 6\n");
      chmodSync(path.join(tools, PROBE), 0o755);
      vi.stubEnv("PATH", `${tools}${path.delimiter}${process.env.PATH ?? ""}`);

      expect(spawnArgv([PROBE], { cwd: api })).toMatchObject({
        code: 6,
      });
    });

    it("names a program that is not on PATH instead of starting anything", () => {
      const answer = spawnArgv([MISSING_PROGRAM, "--version"], {
        cwd: api,
      }) as Answer;

      expect(answer.code).toBeNull();
      expect(answer.notStarted).toContain(`"${MISSING_PROGRAM}"`);
      expect(answer.notStarted).toContain("was not found");
    });

    it("names a file that is there but may not be run", () => {
      writeFileSync(path.join(api, LOCAL_PROGRAM), "#!/bin/sh\nexit 0\n");

      const answer = spawnArgv([LOCAL_PROGRAM], { cwd: api }) as Answer;

      expect(answer.code).toBeNull();
      expect(answer.notStarted).toContain(`"${LOCAL_PROGRAM}"`);
      expect(answer.notStarted).toContain("may not be run");
    });

    it("names a path with no file behind it as not found", () => {
      const answer = spawnArgv([LOCAL_PROGRAM], { cwd: api }) as Answer;

      expect(answer.code).toBeNull();
      expect(answer.notStarted).toContain(`"${LOCAL_PROGRAM}" was not found`);
    });

    it("treats an argument spelt like one of the supervisor's options as an argument", () => {
      const lookalikes = [
        "--",
        "--timeout-ms=1",
        "--direct-argv",
        "--watch-pid=1",
        "--capture-fd=9",
      ];
      writeFileSync(path.join(api, "print.cjs"), `${PRINT_ARGUMENTS}\n`);

      const answer = spawnArgv([NODE, "print.cjs", ...lookalikes], {
        cwd: api,
      }) as Answer;

      expect(answer.code).toBe(0);
      // The script's own path first, as Node reports it, then every argument.
      expect(JSON.parse(answer.output ?? "null")).toEqual([
        path.join(api, "print.cjs"),
        ...lookalikes,
      ]);
    });

    it("never reports a part whose program is missing as passed", () => {
      const { result, transcript } = runForReal(
        partGates([{ scope: API, command: [MISSING_PROGRAM] }]),
        repository.root
      );

      expect(result.passed).toEqual([]);
      expect(result.results[0]?.state).toBe(STATE.UNPROVABLE);
      expect(result.blocked).toBe(true);
      expect(transcript).toContain(`gate NOT PROVED: ${LINT} in ${API}`);
      expect(transcript).toContain(`"${MISSING_PROGRAM}" was not found`);
    });

    it("reports a real command that exits 0 having run no tests as not proved", () => {
      const { result } = runForReal(
        partGates([
          {
            scope: API,
            command: [NODE, "-e", `console.log(${JSON.stringify(ZERO_TESTS)})`],
          },
        ]),
        repository.root
      );

      expect(result.passed).toEqual([]);
      expect(result.results[0]?.state).toBe(STATE.UNPROVABLE);
      expect(result.results[0]?.diagnosis).toBe(DIAGNOSIS.NO_TESTS_RAN);
      expect(result.blocked).toBe(true);
    });
  }
);

describe("a part's command where the process supervisor has no direct mode", () => {
  let repository: PartsRepository;
  let api: string;

  beforeEach(() => {
    repository = partsRepository();
    api = path.join(repository.root, API);
  });

  afterEach(() => {
    repository.cleanup();
  });

  it("is still started directly, in the part's folder, with every argument as written", () => {
    const answer = spawnArgv([NODE, "-e", SAVE_ARGUMENTS, ...SHELL_SYNTAX], {
      cwd: api,
      platform: "win32",
    });

    expect(answer).toEqual({ code: 0, output: null });
    expect(
      JSON.parse(readFileSync(path.join(api, "received.json"), "utf8"))
    ).toEqual(SHELL_SYNTAX);
    expect(readdirSync(api)).toEqual(["received.json"]);
  });

  it("names a program that could not be started", () => {
    const answer = spawnArgv([MISSING_PROGRAM], {
      cwd: api,
      platform: "win32",
    }) as Answer;

    expect(answer.code).toBeNull();
    expect(answer.notStarted).toContain(`"${MISSING_PROGRAM}"`);
  });
});

/**
 * What the paired-proof runner needs from the gate runner
 * (CodySwannGT/lisa#4995).
 *
 * A proof plants a change and runs the same command the gate runs, so it has
 * to start that command the way the gate does and read its answer by the
 * gate's own rules. Three things the gate runner did not offer before: a time
 * limit shorter than its own ceiling, a start that shows nothing while it
 * runs, and its judgement of an answer as something another module can ask
 * for. Nothing here changes what a gate does when none of the three is asked
 * for.
 * @module tests/unit/scripts/lisa-run-gates-parts-proof
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DIAGNOSIS } from "../../../all/copy-overwrite/scripts/lib/gate-failure-diagnosis.mjs";
import {
  judgePart,
  partDirectory,
  spawnArgv,
  STATE,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import {
  API,
  type ArgvAnswer,
  LINT,
  partGates,
  partRow,
  type PartsRepository,
  partsRepository,
  runParts,
} from "./lisa-run-gates-parts-fixtures.js";

const NODE = process.execPath;

const RUNNER_URL = pathToFileURL(
  path.resolve(
    __dirname,
    "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs"
  )
).href;

/** A part executor's answer in its object form, with the proof's extra key. */
type Answer = Exclude<ArgvAnswer, number | null> & {
  readonly timedOut?: boolean;
};

/** Prints a line, then stays alive for a minute. */
const PRINT_THEN_HANG = "console.log('started'); setTimeout(() => {}, 60000)";

/** Leaves a file behind two seconds after it starts, unless it was stopped. */
const LATE_FILE =
  "setTimeout(() => require('node:fs').writeFileSync('late', ''), 2000)";

/** Why a command that was never started was not. */
const NOT_FOUND = "the program was not found";

/** What a failing check prints. */
const FAILURE_LINE = "Found 1 error";

/** A program that prints the failure line and exits 1. */
const FAILS = [NODE, "-e", `console.log('${FAILURE_LINE}'); process.exit(1)`];

/**
 * Start a part's command from a separate process and keep what that process
 * wrote to its own output, which is where a command's live output would go.
 * @param options - Passed to `spawnArgv` beside the folder
 * @param cwd - The folder to start the command in
 * @returns The separate process's output and the answer it was given
 */
function startedElsewhere(
  options: Record<string, unknown>,
  cwd: string
): { readonly shown: string; readonly answer: Answer } {
  const script = [
    `import { spawnArgv } from ${JSON.stringify(RUNNER_URL)};`,
    `const answer = spawnArgv(${JSON.stringify([NODE, "-e", "console.log('live line')"])}, ${JSON.stringify({ ...options, cwd })});`,
    "process.stderr.write(JSON.stringify(answer));",
  ].join("\n");
  const child = spawnSync(NODE, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    timeout: 30_000,
  });
  return { shown: child.stdout, answer: JSON.parse(child.stderr) as Answer };
}

describe.skipIf(process.platform === "win32")(
  "a part's command started for a proof",
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

    it("is stopped at its time limit, and says that is what happened", () => {
      const answer = spawnArgv([NODE, "-e", PRINT_THEN_HANG], {
        cwd: api,
        timeoutMs: 500,
      }) as Answer;

      expect(answer.code).toBeNull();
      expect(answer.timedOut).toBe(true);
      expect(answer.output).toContain("started");
    });

    it("leaves nothing of a stopped command running", async () => {
      spawnArgv([NODE, "-e", LATE_FILE], { cwd: api, timeoutMs: 300 });

      await new Promise(resolve => setTimeout(resolve, 2500));

      expect(existsSync(path.join(api, "late"))).toBe(false);
    });

    it("says nothing about a time limit when the command finished inside it", () => {
      const answer = spawnArgv([NODE, "-e", "console.log('done')"], {
        cwd: api,
        timeoutMs: 20_000,
      }) as Answer;

      expect(answer).toEqual({ code: 0, output: "done\n" });
    });

    it.each([0, -1, 1.5, 1_800_001, "500", Number.NaN])(
      "refuses the time limit %j before starting anything",
      timeoutMs => {
        expect(() =>
          spawnArgv(
            [NODE, "-e", "require('node:fs').writeFileSync('ran','')"],
            {
              cwd: api,
              // Text is not a limit, and the declaration says so. A caller with
              // no types can still pass it, which is the case being checked.
              timeoutMs: timeoutMs as number,
            }
          )
        ).toThrow(TypeError);
        expect(existsSync(path.join(api, "ran"))).toBe(false);
      }
    );

    it("shows the command's output as it runs unless asked not to", () => {
      const loud = startedElsewhere({}, api);
      const quiet = startedElsewhere({ quiet: true }, api);

      expect(loud.shown).toContain("live line");
      expect(quiet.shown).toBe("");
      expect(quiet.answer).toEqual({ code: 0, output: "live line\n" });
    });

    it("keeps a quiet command's output even where capture is switched off", () => {
      vi.stubEnv("LISA_GATES_CAPTURE", "0");

      expect(spawnArgv(FAILS, { cwd: api, quiet: true })).toEqual({
        code: 1,
        output: `${FAILURE_LINE}\n`,
      });
    });

    it("gives a quiet command nothing to read", () => {
      const answer = spawnArgv(
        [
          NODE,
          "-e",
          "console.log(require('node:fs').readFileSync(0, 'utf8').length)",
        ],
        { cwd: api, quiet: true, timeoutMs: 20_000 }
      ) as Answer;

      expect(answer).toEqual({ code: 0, output: "0\n" });
    });
  }
);

describe("a part's command started for a proof where there is no supervisor", () => {
  let repository: PartsRepository;
  let api: string;

  beforeEach(() => {
    repository = partsRepository();
    api = path.join(repository.root, API);
  });

  afterEach(() => {
    repository.cleanup();
  });

  it("is still stopped at its time limit", () => {
    const answer = spawnArgv([NODE, "-e", PRINT_THEN_HANG], {
      cwd: api,
      platform: "win32",
      timeoutMs: 500,
    }) as Answer;

    expect(answer).toEqual({ code: null, output: null, timedOut: true });
  });

  it("keeps a quiet command's output", () => {
    expect(
      spawnArgv(FAILS, { cwd: api, platform: "win32", quiet: true })
    ).toEqual({ code: 1, output: `${FAILURE_LINE}\n` });
  });
});

describe("the gate runner's judgement of a part's answer", () => {
  const declared = [{ gate: LINT, shape: [FAILURE_LINE] }];

  it("is a pass for exit 0", () => {
    expect(
      judgePart(FAILS, { code: 0, output: "ok\n" }, declared)
    ).toMatchObject({ state: STATE.PASSED, code: 0, diagnosis: null });
  });

  it("is a measured failure when the output carries the declared failure text", () => {
    expect(
      judgePart(FAILS, { code: 1, output: `${FAILURE_LINE}\n` }, declared)
    ).toMatchObject({
      state: STATE.FAILED,
      code: 1,
      diagnosis: DIAGNOSIS.DECLARED_FAILURE,
    });
  });

  it("is not a measurement when the output carries none of it", () => {
    expect(
      judgePart(FAILS, { code: 1, output: "config file not found\n" }, declared)
    ).toMatchObject({
      state: STATE.UNPROVABLE,
      diagnosis: DIAGNOSIS.UNDIAGNOSED,
    });
  });

  it("is not a pass for exit 0 from a run that says it ran no tests", () => {
    expect(
      judgePart(
        FAILS,
        { code: 0, output: "No test files found, exiting with code 0\n" },
        declared
      )
    ).toMatchObject({ state: STATE.UNPROVABLE, code: 0 });
  });

  it("is a kill, not a failure, for a command stopped by a signal", () => {
    expect(
      judgePart(
        FAILS,
        { code: null, output: null, signal: "SIGKILL" },
        declared
      )
    ).toMatchObject({ state: STATE.KILLED, code: null });
  });

  it("is not a measurement for a command that never started", () => {
    const outcome = judgePart(
      FAILS,
      { code: null, output: null, notStarted: NOT_FOUND },
      declared
    );

    expect(outcome.state).toBe(STATE.UNPROVABLE);
    expect(outcome.detail).toContain(NOT_FOUND);
  });

  it("is the judgement a gate's own run reaches for the same answer", () => {
    const repository = partsRepository();
    const answers: readonly ArgvAnswer[] = [
      { code: 0, output: "ok\n" },
      { code: 1, output: `${FAILURE_LINE}\n` },
      { code: 1, output: "config file not found\n" },
      { code: null, output: null, notStarted: NOT_FOUND },
    ];

    try {
      for (const answer of answers) {
        const run = runParts({
          execArgv: () => answer,
          gates: partGates([
            {
              scope: API,
              command: FAILS,
              proof: { failure_shape: [FAILURE_LINE] },
            },
          ]),
          root: repository.root,
        });
        const row = partRow(run, API);
        const judged = judgePart(
          FAILS,
          answer,
          declared,
          path.join(repository.root, API)
        );

        expect({ state: judged.state, detail: judged.detail }).toEqual({
          state: row.state,
          detail: row.detail,
        });
      }
    } finally {
      repository.cleanup();
    }
  });
});

describe("the folder a part's command starts in", () => {
  let repository: PartsRepository;

  beforeEach(() => {
    repository = partsRepository();
  });

  afterEach(() => {
    repository.cleanup();
  });

  it("is the part's folder inside the repository", () => {
    expect(partDirectory(repository.root, API)).toEqual({
      directory: path.join(repository.root, API),
    });
    expect(partDirectory(repository.root, ".")).toEqual({
      directory: repository.root,
    });
  });

  it("is refused when the folder leads outside the repository", () => {
    expect(partDirectory(repository.root, "..")).toEqual({
      problem: 'the folder ".." leads outside this repository',
    });
  });

  it("is refused when the folder is not there", () => {
    expect(partDirectory(repository.root, "missing")).toEqual({
      problem: 'the folder "missing" does not exist in this repository',
    });
  });

  it("is what the runner's own source says it exports", () => {
    const source = readFileSync(new URL(RUNNER_URL), "utf8");

    expect(source).toContain("export function partDirectory(");
    expect(source).toContain("export function judgePart(");
  });
});

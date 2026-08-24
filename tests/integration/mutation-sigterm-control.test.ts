/**
 * The faithful control for the SIGTERM that kills the mutation gate's weakened
 * run on hosted CI (CodySwannGT/lisa#2991).
 *
 * ## What is already settled, so nothing here re-derives it
 *
 * **`143` is a delivered SIGTERM, by construction.** Stryker's
 * `unexpected-exit-handler` installs a handler for `SIGTERM` and calls
 * `process.exit(128 + signalNumber)` itself, so the exit code is not a Stryker
 * verdict, not a shell artefact, and not something to infer from arithmetic. A
 * signal was delivered. Every explanation that does not involve one is
 * eliminated at the source.
 *
 * **`maxBuffer` overflow does not produce `143` on macOS.** The faithful
 * control — the real weakened whole-list arm under Node's default 1 MiB cap —
 * was run there and returned `ENOBUFS`, `status: 1`, 1,053,539 bytes, with the
 * tail mid-`[NoCoverage]` burst. The overflow is real, at the real scale, at
 * the predicted moment, and it is the wrong number.
 *
 * ## The one control that had not been run
 *
 * **Both of those ran on macOS. The failure was observed on `ubuntu-latest`.**
 * Whether Node's overflow kill lands before or after Stryker's own exit is a
 * race, and it may draw differently there. This file is that control, on that
 * platform, and it is the reason this is a measurement rather than a fifth
 * guess — four plausible stories have already been wrong or unproven on this
 * failure (a coverage regression, a sandbox load failure, local contention, and
 * `maxBuffer`), and a fifth guess is worth less than the measurement.
 *
 * ## Two arms, because two questions are open
 *
 * | arm | `maxBuffer` | the question it answers |
 * |---|---|---|
 * | faithful | 1 MiB — Node's default, the value in force when the failure was seen | does the overflow draw `143` on Linux where it drew `1` on macOS? |
 * | current | 256 MiB — {@link MAX_GATE_OUTPUT_BYTES}, what ships today | with the overflow removed, does something on the runner still send a signal? |
 *
 * The second arm is what makes a null result informative. CodySwannGT/lisa#2962
 * raised the cap, so the overflow can no longer occur on current code — which
 * removes the symptom's most likely trigger **without establishing that it was
 * the trigger.** If the faithful arm draws `1` and the current arm draws a
 * signal anyway, `maxBuffer` is dead and the sender is something else on the
 * runner.
 *
 * ## This asserts almost nothing, deliberately
 *
 * A control that asserted the answer would be a guess wearing a test's clothes.
 * What is asserted is that the measurement is VALID — that the weakened arm was
 * really configured, really ran, and really produced a draw to read. The draw
 * itself is printed, in full, and the workflow keeps the untruncated log as an
 * artifact: `lisa-mutation.mjs` keeps only a 256 KiB tail, which would discard
 * an early resource warning, and an early resource warning is exactly what a
 * runner-side reaper leaves behind.
 *
 * ## Running it
 *
 * ```sh
 * LISA_MUTATION_SIGTERM_CONTROL=1 bun run test \
 *   tests/integration/mutation-sigterm-control.test.ts
 * ```
 *
 * Off by default: the weakened pass measures ~7.0 min per arm (nightly
 * `32641083727`), so this is a short job rather than a 55-minute one, but it is
 * still two whole-list Stryker runs and no pull request should pay for them.
 * `.github/workflows/mutation-sigterm-control.yml` dispatches it on
 * `ubuntu-latest`, which is the only platform whose answer counts.
 * @module tests/integration/mutation-sigterm-control
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import type { GateRun } from "../helpers/gate-capture.js";
import {
  captureGateRun,
  MAX_GATE_OUTPUT_BYTES,
} from "../helpers/gate-capture.js";
import {
  weakenedSuites,
  WITHHELD_GUARDS,
} from "../helpers/mutation-gate-arms.js";

const ROOT = path.resolve(__dirname, "..", "..");
const STRYKER = path.join(ROOT, "node_modules", ".bin", "stryker");

/**
 * Whether the control runs. Off on every path but the dispatch workflow.
 */
const CONTROL_ENABLED = process.env["LISA_MUTATION_SIGTERM_CONTROL"] === "1";

/**
 * Node's default `maxBuffer` for `execFileSync`, in bytes.
 *
 * The value in force when the `143` was observed, restated here rather than
 * imported because the point of the faithful arm is to reproduce the ORIGINAL
 * conditions. If Node's default ever moves, this control must not move with it.
 */
const NODE_DEFAULT_MAX_BUFFER = 1024 * 1024;

/**
 * Deadline for one arm, in ms.
 *
 * The weakened pass measured 7.0, 8.1 and 7.5 min on three scheduled samples.
 * 20 min is 2.47x the worst of them — the same multiple
 * `mutation-gate-bite`'s `WEAKENED_DEADLINE_MS` carries, and for the same
 * reason: a tight multiple on a contended box is a flake generator, not a
 * detector.
 *
 * It matters here in one extra way. A deadline kill arrives as `ETIMEDOUT`,
 * which `gate-capture` names ahead of the status — so an arm killed by THIS
 * harness can never be misread as the runner-side signal the control is
 * hunting for.
 */
const ARM_DEADLINE_MS = 1_200_000;

/** Vitest's backstop, a minute past the child's own bound. */
const ARM_BUDGET_MS = ARM_DEADLINE_MS + 60_000;

/** The committed gate configuration — the one that guards pull requests. */
const committed = JSON.parse(
  fs.readFileSync(path.join(ROOT, "stryker.conf.json"), "utf8")
) as Record<string, unknown>;

/** One arm's measured draw, as it will be read off a CI log. */
interface Draw {
  readonly arm: string;
  readonly maxBuffer: number;
  readonly status: number | null;
  readonly killedBy: string | undefined;
  readonly bytes: number;
  readonly elapsedMs: number;
  readonly tail: readonly string[];
}

/**
 * Run the weakened whole-list arm under a chosen capture bound.
 *
 * The Stryker config is the COMMITTED one with reporting and the sandbox path
 * overridden and `thresholds` untouched — the same rule
 * `mutation-gate-bite` runs under, for the same reason: an arm judged against a
 * number invented for the occasion measures a gate that does not exist.
 * @param arm - Names the arm in the report
 * @param maxBuffer - The capture bound to run it under
 * @param tempDirName - Sandbox directory, so two arms cannot collide
 * @returns What came back
 */
const runArm = (
  arm: string,
  maxBuffer: number,
  tempDirName: string
): { readonly run: GateRun; readonly draw: Draw } => {
  const confPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "lisa-sigterm-control-")),
    "stryker.conf.json"
  );
  const startedAt = Date.now();

  fs.writeFileSync(
    confPath,
    JSON.stringify({
      ...committed,
      reporters: ["clear-text"],
      clearTextReporter: { maxTestsToLog: 0, logTests: false, maxSurvived: 0 },
      tempDirName,
    })
  );

  try {
    const run = captureGateRun({
      label: arm,
      command: STRYKER,
      args: ["run", confPath],
      cwd: ROOT,
      env: { ...process.env, LISA_MUTATION_SUITES: weakenedSuites().join(",") },
      maxBuffer,
      timeoutMs: ARM_DEADLINE_MS,
    });
    return {
      run,
      draw: {
        arm,
        maxBuffer,
        status: run.status,
        killedBy: run.killedBy,
        bytes: run.output.length,
        elapsedMs: Date.now() - startedAt,
        tail: run.output.split("\n").slice(-40),
      },
    };
  } finally {
    // The sandbox is a full second copy of the tree, and one left behind costs
    // the next lint 1191 parse errors. `cleanTempDir: "always"` covers the
    // cases where Stryker gets to run its own teardown; this covers the ones
    // where it does not, which — given what this control is hunting — is the
    // outcome it is most likely to produce.
    fs.rmSync(path.join(ROOT, tempDirName), { recursive: true, force: true });
  }
};

/**
 * Write a draw where both a human and a later reader of the CI log can find it.
 *
 * The full transcript goes to a file the workflow uploads; only the tail is
 * printed, because printing a megabyte into a job log is how the interesting
 * first lines get scrolled away.
 * @param draw - The measured draw
 * @param output - The arm's full captured output
 */
const record = (draw: Draw, output: string): void => {
  const dir = process.env["LISA_SIGTERM_CONTROL_OUT"];
  if (dir !== undefined && dir.length > 0) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${draw.arm}.log`), output);
    fs.writeFileSync(
      path.join(dir, `${draw.arm}.json`),
      `${JSON.stringify({ ...draw, tail: undefined }, null, 2)}\n`
    );
  }
  console.log(
    [
      `=== sigterm control: ${draw.arm} ===`,
      `maxBuffer   ${draw.maxBuffer}`,
      `status      ${String(draw.status)}`,
      `killedBy    ${draw.killedBy ?? "(none — the arm reached a verdict)"}`,
      `bytes       ${draw.bytes}`,
      `elapsedMs   ${draw.elapsedMs}`,
      "--- tail ---",
      ...draw.tail,
      `=== end ${draw.arm} ===`,
    ].join("\n")
  );
};

/**
 * Require that an arm measured the thing it was supposed to measure.
 *
 * This is the whole assertion budget of the file. A control that also asserted
 * WHICH draw came back would be the fifth guess this issue exists to refuse.
 * @param draw - The measured draw
 */
const assertMeasurementIsValid = (draw: Draw): void => {
  expect(
    draw.bytes,
    `the ${draw.arm} arm produced no output at all, so there is no draw to read — Stryker did not start, and nothing here is evidence about a signal`
  ).toBeGreaterThan(0);
  expect(
    draw.killedBy ?? "",
    `the ${draw.arm} arm was killed by THIS harness at its own ${ARM_DEADLINE_MS}-ms deadline, not by whatever the control is hunting; the draw is an artefact of our own kill`
  ).not.toContain("ETIMEDOUT");
};

describe("the SIGTERM control for the weakened mutation arm", () => {
  it("withholds guards that are really on the mutate list", () => {
    // Ungated on purpose, and cheap. The two arms below run only on the
    // dispatch workflow, so this is the case that notices when the roster they
    // depend on has gone stale — a guard leaving `stryker.conf.json` would
    // otherwise make the "weakened" arm identical to the intact one, and the
    // control would measure the wrong experiment in silence.
    const mutate = committed["mutate"] as readonly string[];
    for (const guard of WITHHELD_GUARDS) expect(mutate).toContain(guard);
    expect(weakenedSuites().length).toBeGreaterThan(0);
  });

  it.runIf(CONTROL_ENABLED)(
    "records the draw under Node's default 1 MiB maxBuffer",
    { timeout: ARM_BUDGET_MS },
    () => {
      const { run, draw } = runArm(
        "faithful-1MiB",
        NODE_DEFAULT_MAX_BUFFER,
        ".stryker-tmp/sigterm-faithful"
      );
      record(draw, run.output);
      assertMeasurementIsValid(draw);
    }
  );

  it.runIf(CONTROL_ENABLED)(
    "records the draw under the 256 MiB cap that ships today",
    { timeout: ARM_BUDGET_MS },
    () => {
      const { run, draw } = runArm(
        "current-256MiB",
        MAX_GATE_OUTPUT_BYTES,
        ".stryker-tmp/sigterm-current"
      );
      record(draw, run.output);
      assertMeasurementIsValid(draw);
    }
  );
});

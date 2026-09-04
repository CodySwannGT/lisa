/**
 * Contract tests for the Android emulator FATAL SCAN on the Maestro native
 * e2e reusable workflow.
 *
 * `reactivecircus/android-emulator-runner` launches the emulator BACKGROUNDED
 * inside one `sh -c "… &"`, so a `FATAL | Not enough space to create userdata
 * partition.` cannot fail the step. The action then polls a process that
 * already exited for its whole boot timeout, and the run reads — ten minutes
 * later — as a generic boot timeout with a missing report file, naming a
 * symptom that points at the suite rather than the cause.
 *
 * Two properties are pinned here, and the second is the one that matters.
 *
 * 1. STRUCTURE — the scan exists, runs IMMEDIATELY after the emulator action,
 *    and reads the SAME path the `emulator-options` redirect writes. Those two
 *    halves are one mechanism: a scan pointed at a path nothing writes is a
 *    check that always passes, so they are asserted to agree rather than
 *    asserted to each exist.
 *
 * 2. FAIL-CLOSED BEHAVIOUR — an absent or empty log must FAIL, and must say
 *    something different from a clean run. This is the whole reason the file
 *    executes the script instead of reading it. The capture mechanism is
 *    coupled to a pinned third-party action's internal command composition,
 *    so it can break silently on a SHA bump; a scan that read a missing file
 *    as "no FATAL" would be a gate that had stopped gating while still
 *    reporting green — the exact defect class the scan exists to close.
 *
 * A test that only proves a FATAL in a fixture log is detected would be
 * satisfied by a scan that never runs at all. The missing-log and empty-log
 * cases are the controls that make the positive case mean something.
 * @module tests/integration/maestro-native-fatal-surface
 */
import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boundedExecFileSync } from "../helpers/io-latency-budget.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REUSABLE_YML = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "maestro-native-e2e.yml"
);

/**
 * Absolute interpreter path, never a PATH lookup — same reason as the disk
 * preflight harness: the interpreter running an extracted script must not be
 * resolvable from a writable directory.
 */
const BASH = "/bin/bash";

/**
 * The exact line the emulator emits when it cannot size its partition.
 * Hardcoded rather than read out of the workflow: a fixture derived from the
 * file under test asserts nothing about the file under test.
 */
const REAL_FATAL_LINE =
  "FATAL | Not enough space to create userdata partition.";

/** Shape of a single step inside a workflow job's `steps:` list. */
interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
}

/** Root shape of the parsed reusable workflow. */
interface ReusableWorkflow {
  jobs: Record<string, { steps?: WorkflowStep[] }>;
}

/** Outcome of one harness invocation of the scan script. */
interface HarnessResult {
  status: number;
  output: string;
}

describe("maestro-native-e2e android emulator FATAL scan", () => {
  let androidSteps: WorkflowStep[];
  let emulatorIndex: number;
  let scanIndex: number;
  let scan: WorkflowStep | undefined;
  let emulatorStep: WorkflowStep | undefined;
  let workDir: string;

  beforeAll(async () => {
    const workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as ReusableWorkflow;
    androidSteps = workflow.jobs.android?.steps ?? [];
    emulatorIndex = androidSteps.findIndex(step =>
      step.uses?.startsWith("reactivecircus/android-emulator-runner")
    );
    scanIndex = androidSteps.findIndex(step =>
      /surface an emulator fatal/i.test(step.name ?? "")
    );
    emulatorStep = androidSteps[emulatorIndex];
    scan = androidSteps[scanIndex];

    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-fatal-scan-"));
  });

  afterAll(async () => {
    if (workDir) {
      await fs.remove(workDir);
    }
  });

  /**
   * Executes the workflow step's own script against a fixture log.
   * @param log - Log contents, or undefined to leave the file absent.
   * @returns The script's exit status and its combined output.
   */
  const runScan = async (log: string | undefined): Promise<HarnessResult> => {
    const caseDir = await fs.mkdtemp(path.join(workDir, "case-"));
    const bodyPath = path.join(caseDir, "scan.sh");
    const logPath = path.join(caseDir, "android-emulator.log");

    await fs.writeFile(bodyPath, scan?.run ?? "");
    if (log !== undefined) {
      await fs.writeFile(logPath, log);
    }

    try {
      const stdout = boundedExecFileSync({
        label: "android emulator FATAL scan harness",
        command: BASH,
        args: [bodyPath],
        // Overrides the literal `${{ runner.temp }}` text the step's `env`
        // carries out of the YAML, which nothing expands outside a runner.
        env: { ...process.env, EMULATOR_LOG: logPath },
      });
      return { status: 0, output: stdout };
    } catch (error) {
      const failure = error as {
        status?: number;
        stdout?: string;
        stderr?: string;
      };
      return {
        status: failure.status ?? 1,
        output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
      };
    }
  };

  it("finds both steps it is asserting about", () => {
    // Guard for every assertion below. A renamed or deleted step would
    // otherwise make the ordering and wiring assertions vacuously true rather
    // than red, which is the failure mode this whole file exists to prevent.
    expect(emulatorIndex, "emulator action step not found").toBeGreaterThan(-1);
    expect(scanIndex, "FATAL scan step not found").toBeGreaterThan(-1);
    expect(scan?.run ?? "", "FATAL scan step has no script").not.toBe("");
  });

  it("runs immediately after the emulator action", () => {
    expect(scanIndex).toBe(emulatorIndex + 1);
  });

  it("still runs when the emulator action failed", () => {
    // The case it exists for is the one where the action ALREADY failed with a
    // boot timeout. A step with no condition would be skipped exactly then.
    expect(scan?.if ?? "").toMatch(/cancelled\(\)/u);
  });

  it("reads the same path the emulator-options redirect writes", () => {
    // The two halves are one mechanism. Wired independently, the scan would
    // read a file nothing writes and pass forever.
    const options = emulatorStep?.with?.["emulator-options"] ?? "";
    // Sliced rather than matched. The path is a `${{ runner.temp }}`
    // expression containing spaces, so a `\S+` cannot span it and a lazy
    // wildcard that can is a backtracking regex over workflow-sized input.
    const redirectMarker = " 2>&1";
    const beforeMarker = options.slice(0, options.lastIndexOf(redirectMarker));
    const redirectTarget = beforeMarker.includes("> ")
      ? beforeMarker.slice(beforeMarker.lastIndexOf("> ") + 2).trim()
      : undefined;
    const scanTarget = scan?.env?.EMULATOR_LOG;

    expect(redirectTarget, "no log redirect in emulator-options").toBeDefined();
    expect(scanTarget, "scan step reads no log path").toBeDefined();
    expect(scanTarget).toBe(redirectTarget);
  });

  it("uses a redirect rather than a pipe, so a trailing -accel off is safe", () => {
    // The action appends ` -accel off` to this string when Linux hardware
    // acceleration is off. After a redirect that is harmless — the shell
    // strips redirections wherever they appear. After `| tee <file>` it
    // becomes `tee <file> -accel off`, which GNU tee rejects, and the log is
    // never written. This is pinned because the pipe reads better and someone
    // will be tempted.
    const options = emulatorStep?.with?.["emulator-options"] ?? "";
    expect(options).not.toMatch(/\|\s*tee\b/u);
    expect(options).toContain(".log 2>&1");
  });

  it("fails naming the FATAL line when the emulator died", async () => {
    const result = await runScan(
      [
        "Ok: Disk space requirements to run avd: 'test' are met",
        REAL_FATAL_LINE,
      ].join("\n")
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(REAL_FATAL_LINE);
  });

  it("stays quiet when the emulator log carries no FATAL", async () => {
    const result = await runScan(
      ["emulator: Android emulator version 35.1.4", "boot completed"].join("\n")
    );

    expect(result.status).toBe(0);
  });

  it("FAILS when the log is missing, rather than reading absence as clean", async () => {
    // The control that gives the positive case meaning. A scan that never ran
    // would satisfy the FATAL test above by never being reached; it cannot
    // satisfy this one.
    const result = await runScan(undefined);

    expect(result.status).not.toBe(0);
  });

  it("FAILS when the log is present but empty", async () => {
    const result = await runScan("");

    expect(result.status).not.toBe(0);
  });

  it("says something different for 'could not tell' than for 'no FATAL'", async () => {
    // An operator must be able to distinguish a healthy emulator from a broken
    // capture mechanism. If both cases produced the same text, the fail-closed
    // behaviour would be correct and unreadable.
    const missing = await runScan(undefined);
    const empty = await runScan("");
    const died = await runScan(REAL_FATAL_LINE);

    for (const [label, result] of [
      ["missing log", missing],
      ["empty log", empty],
    ] as const) {
      expect(result.output, `${label} must say it could not tell`).toMatch(
        /Cannot tell whether the emulator died/u
      );
      expect(
        result.output,
        `${label} must not claim the emulator died`
      ).not.toMatch(/died at launch/u);
    }

    expect(died.output).toMatch(/died at launch/u);
    expect(died.output).not.toMatch(/Cannot tell whether the emulator died/u);
  });
});

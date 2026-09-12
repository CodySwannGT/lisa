/**
 * Contract tests for the Android emulator launch-FATAL WATCHDOG on the Maestro
 * native e2e reusable workflow.
 *
 * CodySwannGT/lisa#3853 made a launch FATAL nameable. It could not make it
 * PROMPT: `reactivecircus/android-emulator-runner` polls
 * `adb shell getprop sys.boot_completed` for its whole `emulator-boot-timeout`,
 * nothing runs between the FATAL and that timeout, and a step cannot fail while
 * another step is running. So the named cause still landed ten minutes after an
 * emulator that died in 0.2s (CodySwannGT/lisa#3872).
 *
 * The watchdog is a background poller armed BEFORE the emulator step. When the
 * scan step's own FATAL pattern matches the scan step's own log file, it
 * signals the process running the emulator action, the step fails at once, and
 * the existing `!cancelled()` scan step reports exactly as it always did.
 *
 * TWO ARMS, AND THE SECOND IS THE ONE THAT MATTERS.
 *
 * 1. It fires on a dead emulator — the arm a watchdog that always fired would
 *    also satisfy, which is why it proves nothing alone.
 * 2. It leaves a SLOW BUT HEALTHY boot alone. The trigger carries no notion of
 *    elapsed time at all, and this is the arm that says so. A watchdog that
 *    killed slow boots would convert a rare capacity failure into a common
 *    flake — a worse bug than the one it fixes.
 *
 * Plus the structural claim that keeps the two mechanisms from drifting apart:
 * the watchdog's pattern and log path are the SCAN's pattern and log path,
 * asserted equal rather than intended equal. That is what makes the watchdog
 * incapable of failing a run the scan would have called healthy — it can only
 * ever bring forward a verdict the scan would have reached anyway.
 *
 * The waits below are LIVENESS BOUNDS, not performance assertions. Nothing here
 * measures how fast the watchdog is, and no number taken from this machine is
 * committed as a threshold — a bound only has to be long enough that a working
 * watchdog is never reported broken.
 * @module tests/integration/maestro-native-fatal-watchdog
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boundedExecFileSync } from "../helpers/io-latency-budget.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REUSABLE_YML = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "maestro-native-e2e.yml"
);

/** Absolute interpreter path, never a PATH lookup. */
const BASH = "/bin/bash";

/** The pinned emulator action, named once so the three uses cannot drift. */
const EMULATOR_ACTION = "reactivecircus/android-emulator-runner";

/**
 * The exact line the emulator emits when it cannot size its partition.
 * Hardcoded rather than read out of the workflow: a fixture derived from the
 * file under test asserts nothing about the file under test.
 */
const REAL_FATAL_LINE =
  "FATAL | Not enough space to create userdata partition.";

/** Poll period the harness runs the watchdog at, in seconds. */
const HARNESS_POLL_SECONDS = "0.2";

/**
 * Liveness bound for "the watchdog acted", in milliseconds. Generous by
 * design: it is exceeded only by a watchdog that never acts at all.
 */
const ACTED_BOUND_MS = 20_000;

/**
 * How long the negative arm watches a healthy boot before concluding the
 * watchdog left it alone, in milliseconds. Many poll periods, so the watchdog
 * has had repeated opportunities to fire and has declined every one.
 */
const LEFT_ALONE_WINDOW_MS = 3_000;

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

/** One armed watchdog plus the process it is pointed at. */
interface Harness {
  dir: string;
  log: string;
  victim: ChildProcess;
  victimMarker: string;
}

/**
 * Extracts the `grep -E '<pattern>'` FATAL pattern from a step's script.
 * @param script - The step's `run:` body.
 * @returns The pattern, or undefined when the script greps for no such thing.
 */
const fatalPattern = (script: string): string | undefined =>
  /grep[^\n']*-E '([^']*FATAL[^']*)'/u.exec(script)?.[1];

/**
 * Waits until `predicate` holds or the bound elapses.
 * @param predicate - Condition to wait for.
 * @param boundMs - Liveness bound in milliseconds.
 * @returns Whether the predicate held before the bound elapsed.
 */
const waitUntil = async (
  predicate: () => boolean,
  boundMs: number
): Promise<boolean> => {
  const deadline = Date.now() + boundMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return predicate();
};

/**
 * Whether a pid is still alive.
 * @param pid - Process id to probe.
 * @returns True when the process exists.
 */
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("maestro-native-e2e android emulator launch-FATAL watchdog", () => {
  let androidSteps: WorkflowStep[];
  let emulatorIndex = -1;
  let preflightIndex = -1;
  let scanIndex = -1;
  let armIndex = -1;
  let reapIndex = -1;
  let arm: WorkflowStep | undefined;
  let reap: WorkflowStep | undefined;
  let scan: WorkflowStep | undefined;
  let emulatorStep: WorkflowStep | undefined;
  let workDir = "";
  const harnesses: Harness[] = [];

  beforeAll(async () => {
    const workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as ReusableWorkflow;
    androidSteps = workflow.jobs.android?.steps ?? [];
    const at = (pattern: RegExp): number =>
      androidSteps.findIndex(step => pattern.test(step.name ?? ""));

    emulatorIndex = androidSteps.findIndex(step =>
      step.uses?.startsWith(EMULATOR_ACTION)
    );
    preflightIndex = at(/reclaim runner disk/iu);
    scanIndex = at(/surface an emulator fatal/iu);
    armIndex = at(/arm the emulator launch-fatal watchdog/iu);
    reapIndex = at(/reap the emulator launch-fatal watchdog/iu);
    emulatorStep = androidSteps[emulatorIndex];
    scan = androidSteps[scanIndex];
    arm = androidSteps[armIndex];
    reap = androidSteps[reapIndex];

    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-fatal-watchdog-"));
  });

  afterEach(async () => {
    // Every harness leaves a real background process behind. Reap them here
    // rather than trusting the reap STEP, which is itself under test.
    for (const harness of harnesses.splice(0)) {
      harness.victim.kill("SIGKILL");
      const pidFile = path.join(harness.dir, "emulator-fatal-watchdog.pid");
      const pid = Number(await fs.readFile(pidFile, "utf-8").catch(() => "0"));
      if (pid > 0 && alive(pid)) process.kill(pid, "SIGKILL");
    }
  });

  afterAll(async () => {
    if (workDir) await fs.remove(workDir);
  });

  /**
   * Arms the workflow's own watchdog against a throwaway victim process.
   * @returns The armed harness.
   */
  const armWatchdog = async (): Promise<Harness> => {
    const dir = await fs.mkdtemp(path.join(workDir, "case-"));
    const victimMarker = `lisa-watchdog-victim-${path.basename(dir)}`;
    // A loop, not a bare `sleep`: `sh -c` execs a lone simple command and the
    // marker would vanish from the argv `pgrep -f` matches on.
    const victim = spawn(
      "/bin/sh",
      ["-c", `while :; do sleep 1; done # ${victimMarker}`],
      { stdio: "ignore" }
    );
    const harness: Harness = {
      dir,
      log: path.join(dir, "android-emulator.log"),
      victim,
      victimMarker,
    };
    const bodyPath = path.join(dir, "arm.sh");

    harnesses.push(harness);
    await fs.writeFile(bodyPath, arm?.run ?? "");
    boundedExecFileSync({
      label: "emulator launch-FATAL watchdog arm step",
      command: BASH,
      args: [bodyPath],
      // Overrides the literal `${{ }}` text the step's `env` carries out of
      // the YAML, which nothing expands outside a runner. The victim marker
      // stands in for the emulator action's process; the harness cannot spawn
      // a real one, and what is under test is that the watchdog signals
      // whatever `WATCHDOG_TARGET_PATTERN` names.
      env: {
        ...process.env,
        EMULATOR_LOG: harness.log,
        WATCHDOG_DIR: dir,
        WATCHDOG_MAX_SECONDS: "600",
        WATCHDOG_POLL_SECONDS: HARNESS_POLL_SECONDS,
        WATCHDOG_TARGET_PATTERN: victimMarker,
      },
    });
    return harness;
  };

  /**
   * Runs the reap step against a harness directory.
   * @param dir - The harness directory the watchdog wrote its state into.
   * @returns The reap step's combined output.
   */
  const runReap = async (dir: string): Promise<string> => {
    const bodyPath = path.join(dir, "reap.sh");
    await fs.writeFile(bodyPath, reap?.run ?? "");
    return boundedExecFileSync({
      label: "emulator launch-FATAL watchdog reap step",
      command: BASH,
      args: [bodyPath],
      env: { ...process.env, WATCHDOG_DIR: dir },
    });
  };

  it("finds every step it is asserting about", () => {
    // Guard for every assertion below. A renamed or deleted step would make
    // the ordering and wiring claims vacuously true rather than red.
    expect(emulatorIndex, "emulator action step not found").toBeGreaterThan(-1);
    expect(armIndex, "watchdog arm step not found").toBeGreaterThan(-1);
    expect(reapIndex, "watchdog reap step not found").toBeGreaterThan(-1);
    expect(arm?.run ?? "", "arm step has no script").not.toBe("");
    expect(reap?.run ?? "", "reap step has no script").not.toBe("");
  });

  it("arms before the emulator action, without displacing the disk preflight", () => {
    // The preflight MUST stay immediately before the emulator action, so the
    // watchdog goes ahead of it rather than between the two.
    expect(preflightIndex).toBe(emulatorIndex - 1);
    expect(armIndex).toBe(preflightIndex - 1);
  });

  it("reaps after the FATAL scan, on every outcome including cancellation", () => {
    // `always()`, because leaving a background process behind is owed even on
    // a cancelled run, and because an inert watchdog is worth saying out loud.
    expect(scanIndex).toBe(emulatorIndex + 1);
    expect(reapIndex).toBe(scanIndex + 1);
    expect(reap?.if ?? "").toMatch(/always\(\)/u);
  });

  it("watches the same log the redirect writes and the scan reads", () => {
    // Three wirings of one path. Any one of them drifting turns the watchdog
    // into a poller of a file nothing writes — a guard that never fires and
    // never says so.
    const options = emulatorStep?.with?.["emulator-options"] ?? "";
    const beforeMarker = options.slice(0, options.lastIndexOf(" 2>&1"));
    const redirectTarget = beforeMarker.includes("> ")
      ? beforeMarker.slice(beforeMarker.lastIndexOf("> ") + 2).trim()
      : undefined;

    expect(redirectTarget, "no log redirect in emulator-options").toBeDefined();
    expect(arm?.env?.EMULATOR_LOG).toBe(redirectTarget);
    expect(arm?.env?.EMULATOR_LOG).toBe(scan?.env?.EMULATOR_LOG);
  });

  it("fires on exactly the pattern the scan step fails on", () => {
    // The property that makes the watchdog safe: it can only bring forward a
    // verdict the scan would have reached. A watchdog matching more broadly
    // would fail runs the scan calls healthy, and the run would then disagree
    // with its own report.
    const scanPattern = fatalPattern(scan?.run ?? "");
    const armPattern = fatalPattern(arm?.run ?? "");

    expect(scanPattern, "scan step greps for no FATAL pattern").toBeDefined();
    expect(armPattern, "watchdog greps for no FATAL pattern").toBeDefined();
    expect(armPattern).toBe(scanPattern);
  });

  it("targets the pinned emulator action, and says the coupling out loud", () => {
    const target = arm?.env?.WATCHDOG_TARGET_PATTERN ?? "";
    const uses = emulatorStep?.uses ?? "";

    expect(target).toContain(EMULATOR_ACTION);
    expect(uses).toContain(EMULATOR_ACTION);
    expect(arm?.run ?? "").not.toBe("");
  });

  it("signals the emulator action when the emulator logs a FATAL", async () => {
    const harness = await armWatchdog();
    await fs.writeFile(
      harness.log,
      ["emulator: starting", REAL_FATAL_LINE, ""].join("\n")
    );

    const died = await waitUntil(
      () =>
        harness.victim.exitCode !== null || harness.victim.signalCode !== null,
      ACTED_BOUND_MS
    );

    expect(died, "watchdog never signalled the emulator action").toBe(true);
    expect(harness.victim.signalCode).toBe("SIGTERM");

    const output = await runReap(harness.dir);
    expect(output).toMatch(/did not pay the rest of the boot timeout/u);
    expect(output).not.toContain("::error");
  });

  it("LEAVES A SLOW BUT HEALTHY BOOT ALONE", async () => {
    // The control. A watchdog that always fired would pass the case above and
    // fail this one. The log arrives late and grows, exactly as a cold
    // runner's does, and carries no FATAL — so nothing may happen for as long
    // as anyone cares to watch.
    const harness = await armWatchdog();
    await new Promise(resolve => setTimeout(resolve, 500));
    await fs.writeFile(harness.log, "emulator: Android emulator version 35\n");
    await new Promise(resolve => setTimeout(resolve, 500));
    await fs.appendFile(harness.log, "emulator: still booting, slowly\n");

    const acted = await waitUntil(
      () =>
        harness.victim.exitCode !== null || harness.victim.signalCode !== null,
      LEFT_ALONE_WINDOW_MS
    );

    expect(acted, "watchdog killed a healthy boot").toBe(false);

    // And it produces nothing at all on the way past — no annotation, no
    // output, no second opinion about a run the scan is about to call fine.
    const output = await runReap(harness.dir);
    expect(output.trim()).toBe("");
  });

  it("does not fire on the word FATAL inside ordinary output", async () => {
    // Same pattern discipline as the scan: `FATAL` as its own word. Prose
    // that merely contains the letters is not an emulator death.
    const harness = await armWatchdog();
    await fs.writeFile(
      harness.log,
      ["emulator: NONFATAL: retrying", "emulator: no fatal errors", ""].join(
        "\n"
      )
    );

    const acted = await waitUntil(
      () =>
        harness.victim.exitCode !== null || harness.victim.signalCode !== null,
      LEFT_ALONE_WINDOW_MS
    );

    expect(acted, "watchdog fired on prose containing FATAL").toBe(false);
  });

  it("warns, without failing, when the watchdog never armed", async () => {
    // An inert latency guard costs latency, not correctness — the scan still
    // fails the run and still fails closed. Failing here would turn a
    // degraded optimisation into an outage on healthy runs. But it must be
    // VISIBLE: a guard that stopped guarding and said nothing is the defect
    // class this whole area exists to close.
    const dir = await fs.mkdtemp(path.join(workDir, "unarmed-"));
    const output = await runReap(dir);

    expect(output).toContain("::warning");
    expect(output).toMatch(/never armed/u);
  });

  it("warns when the watchdog died without recording why", async () => {
    const dir = await fs.mkdtemp(path.join(workDir, "vanished-"));
    // A pid that is certainly not running: our own child, already reaped.
    const corpse = spawn("/bin/sh", ["-c", "exit 0"], { stdio: "ignore" });
    await new Promise(resolve => corpse.on("exit", resolve));
    await fs.writeFile(
      path.join(dir, "emulator-fatal-watchdog.pid"),
      `${corpse.pid}\n`
    );

    const output = await runReap(dir);

    expect(output).toContain("::warning");
    expect(output).toMatch(/without saying why/u);
  });
});

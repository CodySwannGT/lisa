/**
 * A run that ends normally leaves nothing behind — proved, not assumed.
 *
 * CodySwannGT/lisa#2886 shipped the behaviour and nothing asserted it. The only
 * mechanism that removes a run's OWN root is an exit handler in
 * `src/configs/vitest/scratch-setup.ts`:
 *
 * ```ts
 * process.once("exit", () => { removeScratchDir(root); });
 * ```
 *
 * No committed test exercised it. `vitest-scratch-install.test.ts` asserts the
 * redirection and then cleans up by hand in its own `finally`, so it never
 * observes the handler at all.
 *
 * And the globalSetup `teardown` sweep cannot stand in. `isReclaimable`
 * (`src/configs/vitest/scratch.ts`) returns false for a root whose recorded pid
 * is still alive, and during teardown this process is by definition still
 * alive — so the sweep deliberately spares exactly the root this is about. The
 * clause the criterion turns on, "including when tests failed or timed out",
 * was untested in BOTH halves: the failing arm was plausible in fact and
 * demonstrated nowhere, and the timed-out arm was not exercised at all.
 *
 * So the instrument is a real child vitest, run to completion three times, one
 * arm per ending. The shape is copied from the SIGKILL end-to-end case in
 * `test-scratch-guard.test.ts`, which is the working precedent for "observe
 * another process's scratch space after it is gone".
 * @module tests/unit/config/scratch-run-root-teardown
 */
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  RUN_ROOT_PREFIX,
  SCRATCH_NAMESPACE,
  removeScratchDir,
} from "../../../src/configs/vitest/scratch.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

// Each case spawns a whole child vitest, which is the only honest way to watch
// a process's exit handler run.
useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const TEST_RUNNER = path.join(REPO_ROOT, "src/cli/lisa-test-run.ts");
const FIXTURE = path.join(
  REPO_ROOT,
  "tests",
  "helpers",
  "__fixtures__",
  "scratch-teardown-case.ts"
);
const SETUP_FILE = path.join(
  REPO_ROOT,
  "src",
  "configs",
  "vitest",
  "scratch-setup.ts"
);
const GLOBAL_SETUP = path.join(
  REPO_ROOT,
  "src",
  "configs",
  "vitest",
  "scratch-global-setup.ts"
);

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    removeScratchDir(directory);
  }
});

/** What one child vitest run left in the namespace it was given. */
interface ChildRun {
  /** Exit status the child reported. */
  readonly status: number | null;
  /** Run roots still present in the namespace after the child exited. */
  readonly leftBehind: readonly string[];
  /** Whether the child got far enough to allocate a namespace at all. */
  readonly namespaceExists: boolean;
  /** Child diagnostic retained when an arm does not reach its expected status. */
  readonly stderr: string;
}

/**
 * Make a temp directory this suite owns and will clean up.
 * @param prefix - Directory name prefix
 * @returns Absolute path of the new directory
 */
function ownedTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(dir);
  return dir;
}

/**
 * Write the throwaway vitest config the child runs under.
 *
 * It wires the REAL setup and globalSetup modules from source. Pointing at a
 * copy would prove a copy works, and the whole reason this suite exists is that
 * the shipped mechanism was believed to work and did not.
 * @param base - Directory to write the config into
 * @returns Absolute path of the config
 */
function writeChildConfig(base: string): string {
  const configPath = path.join(base, "vitest.teardown.config.ts");
  writeFileSync(
    configPath,
    `export default { test: { include: [${JSON.stringify(FIXTURE)}], ` +
      `setupFiles: [${JSON.stringify(SETUP_FILE)}], ` +
      `globalSetup: [${JSON.stringify(GLOBAL_SETUP)}], ` +
      `sequence: { setupFiles: "list", hooks: "stack" } } };\n`,
    "utf8"
  );
  return configPath;
}

/**
 * Run roots still sitting in a namespace.
 * @param namespace - Namespace directory to read
 * @returns Names of the run roots present, or none when the namespace is absent
 */
function runRootsIn(namespace: string): readonly string[] {
  if (!existsSync(namespace)) return [];
  return readdirSync(namespace).filter(entry =>
    entry.startsWith(RUN_ROOT_PREFIX)
  );
}

/**
 * Run the fixture suite in a child vitest and report what survived it.
 *
 * The child receives `TMPDIR` before Node loads Lisa, making `os.tmpdir()` the
 * only authority. That keeps the exercise inside a directory this test owns
 * without adding a Lisa-specific public redirect.
 * @param arm - Which ending the fixture should reach: pass, fail or timeout
 * @returns The child's status and the namespace contents afterwards
 */
function runChildSuite(arm: string): ChildRun {
  const base = ownedTempDir("teardown-arm-");
  const configPath = writeChildConfig(base);
  const namespace = path.join(base, SCRATCH_NAMESPACE);
  const child = boundedSpawnSync({
    label: `a child vitest run, ${arm} arm`,
    command: process.execPath,
    args: [
      "--import",
      "tsx",
      TEST_RUNNER,
      "--profile",
      "lisa",
      "--adapter",
      "vitest",
      "--",
      process.execPath,
      path.join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs"),
      "run",
      "--root",
      REPO_ROOT,
      "--config",
      configPath,
    ],
    baseMs: 30_000,
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CI: "1",
      LISA_SCRATCH_TEARDOWN_ARM: arm,
      LISA_TEST_SCRATCH_PREFIXES: JSON.stringify(["teardown-residue-"]),
      LISA_TEST_SCRATCH_SUITE: "lisa",
      TMPDIR: base,
      TMP: base,
      TEMP: base,
    },
  });
  return {
    status: child.status,
    stderr: child.stderr,
    namespaceExists: existsSync(namespace),
    leftBehind: runRootsIn(namespace),
  };
}

/**
 * Assert one arm allocated a run root and then removed it entirely.
 * @param run - What the child left behind
 * @param arm - The arm's name, for the diagnostic
 */
function expectNothingLeftBehind(run: ChildRun, arm: string): void {
  expect(
    run.namespaceExists,
    `the ${arm} child never created a namespace under its own scratch base, ` +
      "so this case measured a run that never redirected rather than one that " +
      "cleaned up. Check that the throwaway config still wires the setup file."
  ).toBe(true);
  expect(
    run.leftBehind,
    `the ${arm} child exited and left its run root behind. The handlers in ` +
      "src/configs/vitest/scratch-setup.ts are what remove it, and nothing " +
      "else will in time: the next run's sweep spares a root whose pid is " +
      "still alive, and by the time this one's pid is gone the root is " +
      "already residue in the shared directory."
  ).toEqual([]);
}

describe("a run that ends normally leaves nothing behind", () => {
  it("removes its run root after a green run", () => {
    const run = runChildSuite("pass");

    expect(
      run.status,
      `the passing arm did not pass, so this case proved nothing about a green run\n${run.stderr}`
    ).toBe(0);
    expectNothingLeftBehind(run, "passing");
  });

  it("removes its run root after tests failed", () => {
    // The criterion says "including when tests failed". A `process.once("exit")`
    // handler does fire on a non-zero exit, so this was plausible in fact —
    // and plausible is not demonstrated.
    const run = runChildSuite("fail");

    expect(
      run.status,
      "the failing arm passed, so it exercised the same path as the green arm"
    ).not.toBe(0);
    expectNothingLeftBehind(run, "failing");
  });

  it("reports a failed suite-root teardown instead of throwing out of it", () => {
    // Cleanup is best-effort by construction and must never decide how the
    // process ends. `removeSupervisedWorkerScope` validates the suite root
    // OUTSIDE its own try/catch, so a suite root that has gone missing throws
    // straight out of it -- and unguarded, that throw lands in a
    // `process.on("exit")` listener, where node turns it into an uncaught
    // exception and rewrites the status, or in a reaping-signal listener BEFORE
    // the re-raise, so the worker never dies of the signal the pool sent.
    //
    // The child's exit status cannot be the oracle for this arm. Removing the
    // suite owner marker is a real authority violation, so the supervisor and
    // the reaper both fail closed on it too -- correctly -- and the child exits
    // non-zero for their reasons regardless of what the worker does. What
    // distinguishes the two builds is whether the worker's teardown failure is
    // REPORTED (guarded) or escapes as an unhandled throw: this diagnostic is
    // absent from the unguarded build and present from the guarded one.
    const run = runChildSuite("suite-root-broken");

    expect(
      run.stderr,
      "the worker's teardown failure escaped instead of being caught and " +
        "reported, so it was free to rewrite this process's ending"
    ).toMatch(/lisa scratch worker teardown failed/u);
  });

  it("removes its run root after a test timed out", () => {
    // The other half of the same clause, and the half that was not exercised at
    // all. A timeout reaches the exit handler by a different route than an
    // assertion failure: vitest ends the case itself rather than the case
    // returning.
    const run = runChildSuite("timeout");

    expect(
      run.status,
      "the timeout arm passed, so the case did not time out and this proved " +
        "nothing about the timed-out ending"
    ).not.toBe(0);
    expectNothingLeftBehind(run, "timed-out");
  });
});

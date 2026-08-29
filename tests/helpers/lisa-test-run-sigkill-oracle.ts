/** Foreground-SIGKILL oracle bound to original root and process authority. */
import * as fs from "node:fs";
import * as path from "node:path";
import { expect, vi } from "vitest";
import { readScratchOwnerRecord } from "../../src/configs/vitest/scratch-owner.js";
import {
  exactProcessIsAlive,
  signalExactProcess,
  settleExactTestRuns,
  waitForExactProcessCleanup,
  type ExactCleanupAuthority,
  type ExactProcessIdentity,
} from "./lisa-test-run-exact-process-cleanup.js";
import {
  createGatedTestRunLaunch,
  type GatedWaitingRun,
} from "./lisa-test-run-gated-launch.js";
import { observeGatedTestRun } from "./lisa-test-run-gated-observer.js";
import {
  SCRATCH_NAMESPACE,
  temporaryTestRunDirectory,
} from "./lisa-test-run-process.js";
import { waitForExactStoppedReaper } from "./lisa-test-run-sigkill-state.js";
import { recoveryProcessAuthority } from "./lisa-test-run-sigkill-processes.js";

/** Mock callback that records every immutable authority publication. */
type AuthorityPublisher = ReturnType<
  typeof vi.fn<(authority: ExactCleanupAuthority) => void>
>;

/**
 * Read the latest immutable authority published by one gated invocation.
 * @param publish - Recording publication callback
 * @returns Latest authority, or undefined before the first publication
 */
function latestAuthority(
  publish: AuthorityPublisher
): ExactCleanupAuthority | undefined {
  return publish.mock.calls.at(-1)?.[0];
}

/** Immutable sibling root, owner, sentinel, and process control. */
interface SiblingRecoveryControl {
  readonly dev: number;
  readonly ino: number;
  readonly token: string;
  readonly sentinel: string;
  readonly processes: readonly ExactProcessIdentity[];
}

/**
 * Prove the materialized root owner matches the original wrapper authority.
 * @param run - Observed killed invocation
 * @param runAuthority - Immutable killed-run authority
 * @param wrapper - Original birth-bound wrapper
 */
function assertKilledRootAuthority(
  run: GatedWaitingRun,
  runAuthority: ExactCleanupAuthority,
  wrapper: ExactProcessIdentity
): void {
  const stat = fs.lstatSync(run.root);
  const owner = readScratchOwnerRecord(run.root);
  expect(runAuthority.run.rootIdentity).toEqual({
    ...owner.root,
    token: owner.token,
  });
  expect(owner.root).toEqual({
    canonicalPath: fs.realpathSync(run.root),
    dev: stat.dev,
    ino: stat.ino,
  });
  expect([owner.pid, owner.processBirthFingerprint]).toEqual([
    wrapper.pid,
    wrapper.birth,
  ]);
}

/**
 * Capture the sibling's immutable filesystem and process safety control.
 * @param sibling - Live sibling invocation
 * @param processes - Exact sibling process identities
 * @returns Pinned sibling facts and sentinel path
 */
function siblingRecoveryControl(
  sibling: GatedWaitingRun,
  processes: readonly ExactProcessIdentity[]
): SiblingRecoveryControl {
  const stat = fs.lstatSync(sibling.root);
  const owner = readScratchOwnerRecord(sibling.root);
  const sentinel = path.join(sibling.root, "live-sibling");
  fs.writeFileSync(sentinel, "live sibling before kill\n", "utf8");
  return {
    dev: stat.dev,
    ino: stat.ino,
    token: owner.token,
    sentinel,
    processes,
  };
}

/**
 * Prove cleanup did not alter the live sibling's identity or usability.
 * @param control - Pinned sibling identity, processes, and sentinel
 * @param siblingRoot - Exact sibling root
 * @param base - Shared test-owned platform temp root
 */
function assertSiblingRecovery(
  control: SiblingRecoveryControl,
  siblingRoot: string,
  base: string
): void {
  const after = fs.lstatSync(siblingRoot);
  expect(control.processes.every(exactProcessIsAlive)).toBe(true);
  expect([after.dev, after.ino]).toEqual([control.dev, control.ino]);
  expect(readScratchOwnerRecord(siblingRoot).token).toBe(control.token);
  expect(fs.readFileSync(control.sentinel, "utf8")).toBe(
    "live sibling before kill\n"
  );
  fs.writeFileSync(control.sentinel, "live sibling after kill\n", "utf8");
  expect(fs.readFileSync(control.sentinel, "utf8")).toBe(
    "live sibling after kill\n"
  );
  expect(fs.readdirSync(path.join(base, SCRATCH_NAMESPACE))).toEqual([
    path.basename(siblingRoot),
  ]);
}

/**
 * Refuse a mismatched birth, signal the exact wrapper, and await its exit.
 * @param run - Invocation whose wrapper is killed
 * @param runAuthority - Immutable killed-root authority
 * @param wrapper - Original exact wrapper identity
 * @param reaper - Prearmed exact recovery identity
 * @returns Terminal wrapper observation
 */
async function killExactWrapper(
  run: GatedWaitingRun,
  runAuthority: ExactCleanupAuthority,
  wrapper: ExactProcessIdentity,
  reaper: ExactProcessIdentity
): Promise<Awaited<GatedWaitingRun["terminal"]>> {
  const mismatch = { ...wrapper, birth: `${wrapper.birth}-mismatch` };
  assertKilledRootAuthority(run, runAuthority, wrapper);
  expect(exactProcessIsAlive(wrapper)).toBe(true);
  expect(exactProcessIsAlive(reaper)).toBe(true);
  expect(signalExactProcess(mismatch, "SIGKILL")).toEqual({ sent: false });
  expect(exactProcessIsAlive(wrapper)).toBe(true);
  expect(exactProcessIsAlive(reaper)).toBe(true);
  expect(signalExactProcess(wrapper, "SIGKILL")).toEqual({ sent: true });
  return run.terminal;
}

/**
 * Validate the stopped terminal state before releasing the production reaper.
 * @param run - Killed invocation with its root still present
 * @param runAuthority - Immutable root authority
 * @param killed - Exact wrapper, payload, and companion identities
 * @param reaper - Exact stopped production reaper
 * @param outcome - Wrapper terminal observation
 * @returns Cleanup observation timestamp
 */
async function releaseStoppedRecovery(
  run: GatedWaitingRun,
  runAuthority: ExactCleanupAuthority,
  killed: readonly ExactProcessIdentity[],
  reaper: ExactProcessIdentity,
  outcome: Awaited<GatedWaitingRun["terminal"]>
): Promise<number> {
  const terminalOwner = readScratchOwnerRecord(run.root);
  const deadline = outcome.at + 45_000;
  expect({ code: outcome.code, signal: outcome.signal }).toEqual({
    code: null,
    signal: "SIGKILL",
  });
  expect(fs.existsSync(run.root)).toBe(true);
  expect(exactProcessIsAlive(reaper)).toBe(true);
  expect({ ...terminalOwner.root, token: terminalOwner.token }).toEqual(
    runAuthority.run.rootIdentity
  );
  expect(signalExactProcess(reaper, "SIGCONT")).toEqual({ sent: true });
  return waitForExactProcessCleanup(run.root, killed, deadline);
}

/**
 * Execute identity-bound foreground-death and live-sibling assertions.
 * @param run - Invocation whose foreground wrapper is killed
 * @param sibling - Live sibling invocation that must remain usable
 * @param base - Shared test-owned platform temp root
 * @param runAuthority - Immutable killed-run authority
 * @param siblingAuthority - Immutable sibling authority
 */
async function assertForegroundSigkillRecovery(
  run: GatedWaitingRun,
  sibling: GatedWaitingRun,
  base: string,
  runAuthority: ExactCleanupAuthority,
  siblingAuthority: ExactCleanupAuthority
): Promise<void> {
  const processes = recoveryProcessAuthority(
    run,
    sibling,
    runAuthority,
    siblingAuthority
  );
  const siblingControl = siblingRecoveryControl(sibling, processes.sibling);
  const outcome = await killExactWrapper(
    run,
    runAuthority,
    processes.wrapper,
    processes.authority
  );
  await waitForExactStoppedReaper(processes.authority);
  const cleanupObservedAt = await releaseStoppedRecovery(
    run,
    runAuthority,
    processes.killed,
    processes.authority,
    outcome
  );
  expect(cleanupObservedAt).toBeLessThanOrEqual(outcome.at + 45_000);
  expect(fs.existsSync(run.root)).toBe(false);
  expect(exactProcessIsAlive(processes.authority)).toBe(false);
  assertSiblingRecovery(siblingControl, sibling.root, base);
}

/**
 * Prove foreground death is terminal before its prearmed reaper cleans.
 * @param register - Suite-local teardown registry
 */
export async function verifyForegroundSigkillRecovery(
  register: (directory: string) => void
): Promise<void> {
  const base = temporaryTestRunDirectory(
    "lisa-test-run-shared-kill-",
    register
  );
  const namespace = path.join(base, SCRATCH_NAMESPACE);
  const publishRun = vi.fn<(authority: ExactCleanupAuthority) => void>();
  const publishSibling = vi.fn<(authority: ExactCleanupAuthority) => void>();
  const primaryFailure = await (async (): Promise<unknown> => {
    try {
      const runLaunch = await createGatedTestRunLaunch(
        base,
        "killed-payload.json",
        publishRun,
        "pause-recovery-before-drain"
      );
      const run = await observeGatedTestRun(runLaunch, base, publishRun);
      const siblingLaunch = await createGatedTestRunLaunch(
        base,
        "sibling-payload.json",
        publishSibling
      );
      const sibling = await observeGatedTestRun(
        siblingLaunch,
        base,
        publishSibling
      );
      const runAuthority = latestAuthority(publishRun);
      const siblingAuthority = latestAuthority(publishSibling);
      if (runAuthority === undefined || siblingAuthority === undefined) {
        throw new Error("Both gated runs require published teardown authority");
      }
      await assertForegroundSigkillRecovery(
        run,
        sibling,
        base,
        runAuthority,
        siblingAuthority
      );
      return undefined;
    } catch (error) {
      return error;
    }
  })();
  await settleExactTestRuns(
    [latestAuthority(publishRun), latestAuthority(publishSibling)],
    primaryFailure,
    namespace
  );
}

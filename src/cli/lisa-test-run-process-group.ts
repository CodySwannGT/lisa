/** Birth-bound process-group draining shared by the supervisor and reaper. */
import { isProcessAlive } from "../configs/vitest/scratch.js";
import { processBirthFingerprint } from "../configs/vitest/scratch-owner.js";

/** Armed bootstrap leader and process-group identity. */
export interface TestRunTargetIntent {
  readonly pid: number;
  readonly pgid: number;
  readonly processBirthFingerprint: string;
}

/** Time allowed for each process-group drain phase. */
const DRAIN_GRACE_MS = 2_000;

/** Poll interval for bounded group drain. */
const DRAIN_POLL_MS = 25;

/**
 * Whether any member still occupies a process group.
 * @param pgid - Armed process-group identifier
 * @returns Whether the group still resolves
 */
function processGroupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Signal a group without turning an already-absent group into a failure.
 * @param pgid - Armed process-group identifier
 * @param signal - Signal to deliver
 */
function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH" && code !== "EPERM") throw error;
  }
}

/**
 * Wait without leaving a permanent timer handle.
 * @param milliseconds - Bounded poll delay
 * @returns Promise settled after the delay
 */
const delay = async (milliseconds: number): Promise<void> =>
  await new Promise(resolve => setTimeout(resolve, milliseconds));

/**
 * Drain only the group whose leader still has its armed process birth.
 * @param target - Armed leader and group identity
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- fail-closed birth and two-phase signal authority are one bounded decision
export async function drainTestRunTarget(
  target: TestRunTargetIntent | undefined
): Promise<void> {
  if (target === undefined) return;
  const observedBirth = processBirthFingerprint(target.pid);
  if (
    isProcessAlive(target.pid) &&
    observedBirth !== target.processBirthFingerprint
  ) {
    return;
  }
  if (!processGroupAlive(target.pgid)) return;
  const deadline = Date.now() + DRAIN_GRACE_MS;
  signalGroup(target.pgid, "SIGTERM");
  while (processGroupAlive(target.pgid) && Date.now() < deadline) {
    await delay(DRAIN_POLL_MS);
  }
  if (processGroupAlive(target.pgid)) {
    const killDeadline = Date.now() + DRAIN_GRACE_MS;
    signalGroup(target.pgid, "SIGKILL");
    while (processGroupAlive(target.pgid) && Date.now() < killDeadline) {
      await delay(DRAIN_POLL_MS);
    }
  }
  if (processGroupAlive(target.pgid)) {
    throw new Error("target process group survived bounded drain");
  }
}

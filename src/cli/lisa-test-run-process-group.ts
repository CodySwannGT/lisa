/** Birth-bound process-group draining shared by the supervisor and reaper. */
import { isProcessAlive } from "../configs/vitest/scratch.js";
import { processBirthFingerprint } from "../configs/vitest/scratch-owner.js";

/** Armed bootstrap leader and process-group identity. */
export interface TestRunTargetIntent {
  readonly pid: number;
  readonly pgid: number;
  readonly processBirthFingerprint: string;
}

/** Injectable probes used to deterministically prove fail-closed authority. */
export interface TestRunProcessGroupProbes {
  readonly isProcessAlive: (pid: number) => boolean;
  readonly processBirthFingerprint: (pid: number) => string | undefined;
  readonly processGroupAlive: (pgid: number) => boolean;
  readonly signalGroup: (pgid: number, signal: NodeJS.Signals) => void;
  readonly delay: (milliseconds: number) => Promise<void>;
}

/** Optional probe overrides for one drain attempt. */
export interface DrainTestRunTargetOptions {
  readonly probes?: Partial<TestRunProcessGroupProbes>;
}

/** Time allowed for each process-group drain phase. */
const DRAIN_GRACE_MS = 2_000;

/** Poll interval for bounded group drain. */
const DRAIN_POLL_MS = 25;

/** Attempts allowed when a live process has no readable birth fingerprint. */
const BIRTH_PROBE_ATTEMPTS = 4;

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

/** Real operating-system probes used outside deterministic unit controls. */
const DEFAULT_PROBES: TestRunProcessGroupProbes = {
  isProcessAlive,
  processBirthFingerprint,
  processGroupAlive,
  signalGroup,
  delay,
};

/**
 * Establish that a live leader is still the exact process originally armed.
 * @param target - Armed leader identity
 * @param probes - Operating-system probes
 * @param attempt - Current bounded unavailable-probe attempt
 * @returns Promise settled only when birth authority is established
 */
async function assertTargetBirthAuthority(
  target: TestRunTargetIntent,
  probes: TestRunProcessGroupProbes,
  attempt = 0
): Promise<void> {
  if (!probes.isProcessAlive(target.pid)) return;
  const observed = probes.processBirthFingerprint(target.pid);
  if (observed === target.processBirthFingerprint) return;
  if (observed !== undefined) {
    throw new Error(
      "target leader process-birth fingerprint changed; refusing group signal"
    );
  }
  if (attempt + 1 < BIRTH_PROBE_ATTEMPTS) {
    await probes.delay(DRAIN_POLL_MS);
    return await assertTargetBirthAuthority(target, probes, attempt + 1);
  }
  throw new Error(
    "target leader process-birth fingerprint remained unavailable"
  );
}

/**
 * Drain only the group whose leader still has its armed process birth.
 * @param target - Armed leader and group identity
 * @param options - Optional deterministic probe overrides
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- fail-closed birth and two-phase signal authority are one bounded decision
export async function drainTestRunTarget(
  target: TestRunTargetIntent | undefined,
  options: DrainTestRunTargetOptions = {}
): Promise<void> {
  if (target === undefined) return;
  const probes = { ...DEFAULT_PROBES, ...options.probes };
  await assertTargetBirthAuthority(target, probes);
  if (!probes.processGroupAlive(target.pgid)) return;
  const deadline = Date.now() + DRAIN_GRACE_MS;
  probes.signalGroup(target.pgid, "SIGTERM");
  while (probes.processGroupAlive(target.pgid) && Date.now() < deadline) {
    await probes.delay(DRAIN_POLL_MS);
  }
  if (probes.processGroupAlive(target.pgid)) {
    const killDeadline = Date.now() + DRAIN_GRACE_MS;
    probes.signalGroup(target.pgid, "SIGKILL");
    while (probes.processGroupAlive(target.pgid) && Date.now() < killDeadline) {
      await probes.delay(DRAIN_POLL_MS);
    }
  }
  if (probes.processGroupAlive(target.pgid)) {
    throw new Error("target process group survived bounded drain");
  }
}

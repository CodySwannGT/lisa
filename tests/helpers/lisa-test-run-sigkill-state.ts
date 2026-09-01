/** Exact prearmed-reaper discovery and stopped-state observation. */
import { boundedSpawnSync } from "./io-latency-budget.js";
import {
  exactProcessIsAlive,
  type ExactProcessIdentity,
} from "./lisa-test-run-exact-process-cleanup.js";
import { waitForTestRun } from "./lisa-test-run-process.js";

/**
 * Read one exact process's kernel state without widening authority.
 * @param identity - Original PID and birth fingerprint
 * @returns Kernel state only while the same process remains alive
 */
function exactProcessState(identity: ExactProcessIdentity): string | undefined {
  if (!exactProcessIsAlive(identity)) return undefined;
  const result = boundedSpawnSync({
    label: "prearmed reaper stopped-state observation",
    command: "/bin/ps",
    args: ["-p", String(identity.pid), "-o", "state="],
    baseMs: 2_000,
  });
  return exactProcessIsAlive(identity) ? result.stdout.trim() : undefined;
}

/**
 * Wait until the exact birth-bound reaper is stopped before releasing drain.
 * @param identity - Original reaper PID and birth
 */
export async function waitForExactStoppedReaper(
  identity: ExactProcessIdentity
): Promise<void> {
  await waitForTestRun(
    () => exactProcessState(identity)?.startsWith("T") === true,
    "exact prearmed reaper to pause before drain"
  );
}

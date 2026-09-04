/** Exact process-role resolution for foreground-SIGKILL test authority. */
import { expect } from "vitest";

import type {
  ExactCleanupAuthority,
  ExactProcessIdentity,
} from "./lisa-test-run-exact-process-cleanup.js";
import type { GatedWaitingRun } from "./lisa-test-run-gated-launch.js";

/** Exact killed and sibling process authority required by the SIGKILL oracle. */
export interface RecoveryProcessAuthority {
  readonly authority: ExactProcessIdentity;
  readonly wrapper: ExactProcessIdentity;
  readonly killed: readonly ExactProcessIdentity[];
  readonly sibling: readonly ExactProcessIdentity[];
}

/**
 * Assert that one complete capture has no missing or ambiguous identity.
 * @param authority - Published invocation authority
 * @param expectedPids - Exact PIDs that must have birth identities
 * @returns Original PID/birth identities
 */
function exactIdentities(
  authority: ExactCleanupAuthority,
  expectedPids: readonly number[]
): readonly ExactProcessIdentity[] {
  const capture = authority.capture ?? {
    identities: [],
    failures: [new Error("Run authority was not captured")],
  };
  expect(capture.failures).toEqual([]);
  expect(
    capture.identities
      .map(value => value.pid)
      .slice()
      .sort((left, right) => left - right)
  ).toEqual(expectedPids.slice().sort((left, right) => left - right));
  return capture.identities;
}

/**
 * Resolve all exact process roles before the foreground signal is attempted.
 * @param run - Invocation whose foreground wrapper will be killed
 * @param sibling - Live sibling invocation retained as a safety control
 * @param runAuthority - Immutable killed-run authority
 * @param siblingAuthority - Immutable sibling authority
 * @returns Exact wrapper, reaper, killed, and sibling identities
 */
export function recoveryProcessAuthority(
  run: GatedWaitingRun,
  sibling: GatedWaitingRun,
  runAuthority: ExactCleanupAuthority,
  siblingAuthority: ExactCleanupAuthority
): RecoveryProcessAuthority {
  const killedPids = [
    run.child.pid,
    run.payloadPid,
    ...run.companionPids,
  ].filter((pid): pid is number => pid !== undefined);
  const siblingPids = [
    sibling.child.pid,
    sibling.payloadPid,
    ...sibling.companionPids,
  ].filter((pid): pid is number => pid !== undefined);
  const killed = exactIdentities(runAuthority, killedPids);
  const authority = runAuthority.run.reaper;
  const wrapper = killed.find(value => value.pid === run.child.pid);
  expect(authority).toBeDefined();
  expect(wrapper).toBeDefined();
  return {
    authority: authority as ExactProcessIdentity,
    wrapper: wrapper as ExactProcessIdentity,
    killed,
    sibling: exactIdentities(siblingAuthority, siblingPids),
  };
}

/** Immutable PID-birth authority for real lisa-test-run fixtures. */
import { processBirthFingerprint } from "../../src/configs/vitest/scratch-owner.js";
import {
  sameExactProcess,
  sameExactRootIdentity,
} from "./lisa-test-run-authority-equality.js";
import { isProcessAlive } from "./lisa-test-run-process.js";

/** One process identity protected against PID reuse. */
export interface ExactProcessIdentity {
  readonly pid: number;
  readonly birth: string;
}

/** One bounded attempt to capture original process authority. */
export interface ExactProcessCapture {
  readonly identities: readonly ExactProcessIdentity[];
  readonly failures: readonly unknown[];
}

/** Process and filesystem facts published while one invocation starts. */
export interface ExactCleanupRun {
  readonly child: import("node:child_process").ChildProcess;
  readonly wrapper?: ExactProcessIdentity;
  readonly root?: string;
  readonly payloadPid?: number;
  readonly companionPids?: readonly number[];
  readonly reaper?: ExactProcessIdentity;
  readonly rootIdentity?: ExactScratchRootIdentity;
}

/** Token-bound root identity observed from one valid owner marker. */
export interface ExactScratchRootIdentity {
  readonly canonicalPath: string;
  readonly dev: number;
  readonly ino: number;
  readonly token: string;
}

/** Original identities that teardown is authorized to signal. */
export interface ExactCleanupAuthority {
  readonly run: ExactCleanupRun;
  readonly capture?: ExactProcessCapture;
}

/** New run facts that become knowable after the wrapper starts. */
export interface ExactCleanupRunIncrement {
  readonly wrapper?: ExactProcessIdentity;
  readonly root?: string;
  readonly payload?: ExactProcessIdentity;
  readonly companions?: readonly ExactProcessIdentity[];
  readonly reaper?: ExactProcessIdentity;
  readonly rootIdentity?: ExactScratchRootIdentity;
}

/** Internal result from one race-tolerant PID probe. */
interface IdentityCapture {
  readonly identity?: ExactProcessIdentity;
  readonly error?: unknown;
}

/** Kernel observation of one previously captured PID/birth identity. */
export type ExactProcessObservation =
  | "alive"
  | "absent"
  | "ambiguous"
  | "reused";

/**
 * Whether an error says the exact PID no longer exists.
 * @param error - Unknown signal or process-probe failure
 * @returns Whether the kernel reports an absent process
 */
export const processAbsent = (error: unknown): boolean =>
  error instanceof Error && (error as NodeJS.ErrnoException).code === "ESRCH";

/**
 * Observe one previously captured identity without authorizing its current PID.
 * @param identity - Original PID and birth fingerprint
 * @returns Exact liveness, reuse, or fail-closed ambiguity
 */
export function exactProcessObservation(
  identity: ExactProcessIdentity
): ExactProcessObservation {
  if (!isProcessAlive(identity.pid)) return "absent";
  const observed = processBirthFingerprint(identity.pid);
  if (observed === undefined)
    return isProcessAlive(identity.pid) ? "ambiguous" : "absent";
  return observed === identity.birth ? "alive" : "reused";
}

/**
 * Check one previously captured identity without authorizing its current PID.
 * @param identity - Original PID and birth fingerprint
 * @returns Whether that exact process is still alive
 */
export function exactProcessIsAlive(identity: ExactProcessIdentity): boolean {
  return exactProcessObservation(identity) === "alive";
}

/**
 * Capture one PID only while its birth authority is available.
 * @param pid - Process identifier whose current occupant is still trusted
 * @returns Exact PID/birth authority or a fail-closed capture error
 */
function captureProcessIdentity(pid: number): IdentityCapture {
  try {
    if (!isProcessAlive(pid)) return {};
    const birth = processBirthFingerprint(pid);
    if (birth !== undefined) return { identity: { pid, birth } };
    return isProcessAlive(pid)
      ? {
          error: new Error(
            `Missing process birth authority for live PID ${pid}`
          ),
        }
      : {};
  } catch (error) {
    return processAbsent(error) || !isProcessAlive(pid) ? {} : { error };
  }
}

/**
 * Capture original identities without substituting later PID occupants.
 * @param pids - PIDs whose ownership is currently certain
 * @returns Captured identities and fail-closed probe errors
 */
export function captureExactProcessIdentities(
  pids: readonly number[]
): ExactProcessCapture {
  const captured = pids.map(captureProcessIdentity);
  return {
    identities: captured.flatMap(value =>
      value.identity === undefined ? [] : [value.identity]
    ),
    failures: captured.flatMap(value =>
      value.error === undefined ? [] : [value.error]
    ),
  };
}

/**
 * Capture all identities currently known for one run.
 * @param run - Published invocation facts
 * @returns Immutable teardown authority
 */
export function captureExactCleanupAuthority(
  run: ExactCleanupRun
): ExactCleanupAuthority {
  const pid = run.child.pid;
  const capture = captureExactProcessIdentities(pid === undefined ? [] : [pid]);
  const wrapper = capture.identities[0];
  return {
    run: wrapper === undefined ? run : { ...run, wrapper },
    capture:
      pid === undefined
        ? {
            identities: [],
            failures: [new Error("Gated wrapper PID is unavailable")],
          }
        : capture,
  };
}

/**
 * Reject a second publication that changes an already-bound field.
 * @param label - Authority field named in a refusal
 * @param bound - Previously published value
 * @param proposed - Newly observed value
 * @param equal - Exact equality predicate for the field
 */
function demandUnchanged<T>(
  label: string,
  bound: T | undefined,
  proposed: T | undefined,
  equal: (left: T, right: T) => boolean = Object.is
): void {
  if (
    bound !== undefined &&
    proposed !== undefined &&
    !equal(bound, proposed)
  ) {
    throw new Error(`Published ${label} authority cannot change`);
  }
}

/**
 * Merge only newly published optional fields into one cleanup run.
 * @param run - Previously published run authority
 * @param increment - Newly validated authority increment
 * @param payloadPid - Validated payload PID
 * @param companionPids - Validated companion PID list
 * @returns Expanded run without replacing existing authority
 */
function mergedCleanupRun(
  run: ExactCleanupRun,
  increment: ExactCleanupRunIncrement,
  payloadPid: number | undefined,
  companionPids: readonly number[] | undefined
): ExactCleanupRun {
  return {
    ...run,
    ...(increment.root === undefined ? {} : { root: increment.root }),
    ...(increment.rootIdentity === undefined
      ? {}
      : { rootIdentity: increment.rootIdentity }),
    ...(increment.wrapper === undefined ? {} : { wrapper: increment.wrapper }),
    ...(payloadPid === undefined ? {} : { payloadPid }),
    ...(companionPids === undefined ? {} : { companionPids }),
    ...(increment.reaper === undefined ? {} : { reaper: increment.reaper }),
  };
}

/**
 * Publish new run facts without replacing any captured identity.
 * @param authority - Previously published authority
 * @param increment - Newly observed run facts
 * @returns Expanded immutable authority
 */
export function publishExactCleanupIncrement(
  authority: ExactCleanupAuthority,
  increment: ExactCleanupRunIncrement
): ExactCleanupAuthority {
  const payloadPid = increment.payload?.pid;
  const companionPids = increment.companions?.map(value => value.pid);
  const previous = authority.capture ?? { identities: [], failures: [] };
  const validated = [
    increment.wrapper,
    increment.payload,
    ...(increment.companions ?? []),
    increment.reaper,
  ].filter((value): value is ExactProcessIdentity => value !== undefined);
  const additions = validated.filter(
    (identity, index) =>
      previous.identities.every(original => original.pid !== identity.pid) &&
      validated.findIndex(candidate => candidate.pid === identity.pid) === index
  );
  const normalizedRun = mergedCleanupRun(
    authority.run,
    increment,
    payloadPid,
    companionPids
  );
  demandUnchanged("scratch root", authority.run.root, increment.root);
  demandUnchanged(
    "scratch root identity",
    authority.run.rootIdentity,
    increment.rootIdentity,
    sameExactRootIdentity
  );
  demandUnchanged(
    "wrapper",
    authority.run.wrapper,
    increment.wrapper,
    sameExactProcess
  );
  demandUnchanged("payload PID", authority.run.payloadPid, payloadPid);
  demandUnchanged(
    "companion PID list",
    authority.run.companionPids,
    companionPids,
    (left, right) =>
      left.length === right.length &&
      left.every((value, index) => value === right[index])
  );
  demandUnchanged(
    "reaper",
    authority.run.reaper,
    increment.reaper,
    sameExactProcess
  );
  for (const identity of validated) {
    const originals = [
      ...previous.identities,
      ...validated.filter(candidate => candidate !== identity),
    ].filter(original => original.pid === identity.pid);
    if (originals.some(original => original.birth !== identity.birth)) {
      throw new Error(
        `Published PID ${String(identity.pid)} birth authority cannot change`
      );
    }
  }
  return {
    run: normalizedRun,
    capture: {
      identities: [...previous.identities, ...additions],
      failures: previous.failures,
    },
  };
}

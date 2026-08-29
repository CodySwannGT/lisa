/** Progressive, fail-closed observation of one gated lisa-test-run launch. */
import * as fs from "node:fs";
import * as path from "node:path";

import { expect } from "vitest";

import { readScratchOwnerRecord } from "../../src/configs/vitest/scratch-owner.js";
import { ioLatencyBudgetMs } from "./io-latency-budget.js";
import {
  publishExactCleanupIncrement,
  type ExactCleanupAuthority,
  type ExactProcessIdentity,
} from "./lisa-test-run-exact-process-cleanup.js";
import {
  type GatedLaunch,
  type GatedWaitingRun,
  type PublishGatedAuthority,
} from "./lisa-test-run-gated-launch.js";
import {
  parseValidatedPayloadMarker,
  validatedInvocationSnapshot,
} from "./lisa-test-run-invocation-snapshot.js";
import { OPAQUE_CONTROL, SCRATCH_NAMESPACE } from "./lisa-test-run-process.js";

/** Deterministic failure phase exercised by authority-only teardown controls. */
export type GatedObservationFault =
  | "assert"
  | "extra-owned-process"
  | "forged-pid"
  | "json"
  | "mismatched-root"
  | "owner"
  | "ps";

/** Token-bound owner facts observed before any assertion may fail. */
interface ObservedRoot {
  readonly path: string;
  readonly canonicalPath: string;
  readonly dev: number;
  readonly ino: number;
  readonly token: string;
  readonly owner: ExactProcessIdentity;
}

/**
 * List the owned namespace without creating it.
 * @param base - Test-owned platform temp root
 * @returns Sorted namespace basenames
 */
function namespaceNames(base: string): readonly string[] {
  const namespace = path.join(base, SCRATCH_NAMESPACE);
  return fs.existsSync(namespace)
    ? fs
        .readdirSync(namespace)
        .toSorted((left, right) => left.localeCompare(right))
    : [];
}

/**
 * Publish a fully ready invocation and apply its deterministic failure controls.
 * @param launch - Registered gated launch
 * @param root - Validated root authority
 * @param publish - Immutable teardown-authority registry
 * @param fault - Optional deterministic readiness failure
 * @returns Fully observed waiting run
 */
function publishReadyRun(
  launch: GatedLaunch,
  root: ObservedRoot,
  publish: PublishGatedAuthority,
  fault?: GatedObservationFault
): GatedWaitingRun {
  if (fault === "owner") throw new Error("Injected owner validation failure");
  const marker = validatedMarker(launch, root, fault);
  const authority = publishInvocation(
    launch.authority,
    root,
    marker,
    publish,
    fault
  );
  if (fault === "assert") throw new Error("Injected assertion failure");
  return {
    child: launch.child,
    marker: launch.marker,
    root: root.path,
    payloadPid: authority.run.payloadPid as number,
    companionPids: authority.run.companionPids as readonly number[],
    terminal: launch.terminal,
  };
}

/**
 * Whether the parent-owned marker contains one complete JSON record.
 * @param marker - Parent-owned marker path
 * @returns Whether the marker appears complete
 */
function completeMarkerExists(marker: string): boolean {
  return (
    fs.existsSync(marker) &&
    fs.readFileSync(marker, "utf8").trim().endsWith("}")
  );
}

/**
 * Read the single new valid owner, or wait while it is not materialized.
 * @param launch - Pre-GO launch and namespace baseline
 * @param base - Test-owned platform temp root
 * @returns Validated owner/root identity or undefined before materialization
 */
function observedRoot(
  launch: GatedLaunch,
  base: string
): ObservedRoot | undefined {
  const additions = namespaceNames(base).filter(
    name => !launch.baseline.has(name)
  );
  if (additions.length !== 1) return undefined;
  const root = path.join(base, SCRATCH_NAMESPACE, additions[0] as string);
  try {
    const owner = readScratchOwnerRecord(root);
    const stat = fs.lstatSync(root);
    const canonicalPath = fs.realpathSync(root);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      owner.root.canonicalPath !== canonicalPath ||
      owner.root.dev !== stat.dev ||
      owner.root.ino !== stat.ino ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid <= 0 ||
      owner.processBirthFingerprint.length === 0
    ) {
      throw new Error(
        "Scratch owner is not bound to the observed root identity"
      );
    }
    return {
      path: root,
      canonicalPath,
      dev: stat.dev,
      ino: stat.ino,
      token: owner.token,
      owner: { pid: owner.pid, birth: owner.processBirthFingerprint },
    };
  } catch {
    return undefined;
  }
}

/**
 * Read and validate a complete marker before any marker-derived publication.
 * @param launch - Gated invocation containing the marker path
 * @param root - Validated owner/root identity
 * @param fault - Optional deterministic failure control
 * @returns Validated marker values
 */
function validatedMarker(
  launch: GatedLaunch,
  root: ObservedRoot,
  fault?: GatedObservationFault
): ReturnType<typeof parseValidatedPayloadMarker> {
  const text = fault === "json" ? "{" : fs.readFileSync(launch.marker, "utf8");
  const value = JSON.parse(text) as { readonly root?: unknown };
  const payloadRoot = typeof value.root === "string" ? value.root : "";
  const owner = readScratchOwnerRecord(payloadRoot);
  const stat = fs.lstatSync(payloadRoot);
  const canonicalPath = fs.realpathSync(payloadRoot);
  const expectedRoot =
    fault === "mismatched-root" ? `${payloadRoot}-mismatch` : payloadRoot;
  const marker = parseValidatedPayloadMarker(
    text,
    expectedRoot,
    OPAQUE_CONTROL,
    owner.processBirthFingerprint
  );
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    canonicalPath !== payloadRoot ||
    path.dirname(payloadRoot) !== root.path ||
    owner.pid !== marker.pid ||
    owner.root.canonicalPath !== payloadRoot ||
    owner.root.dev !== stat.dev ||
    owner.root.ino !== stat.ino ||
    owner.namespace.canonicalPath !== root.canonicalPath ||
    owner.namespace.dev !== root.dev ||
    owner.namespace.ino !== root.ino
  ) {
    throw new Error("Payload marker root is not owned by the observed run");
  }
  return fault === "forged-pid" ? { ...marker, pid: process.pid } : marker;
}

/**
 * Publish one fully validated invocation without accepting arbitrary PID arrays.
 * @param authority - Wrapper-only pre-GO authority
 * @param root - Exact token-bound root owner
 * @param marker - Validated payload marker
 * @param publish - Immutable suite-local authority registry
 * @param fault - Optional deterministic process-snapshot failure
 * @returns Complete published invocation authority
 */
function publishInvocation(
  authority: ExactCleanupAuthority,
  root: ObservedRoot,
  marker: ReturnType<typeof parseValidatedPayloadMarker>,
  publish: PublishGatedAuthority,
  fault?: GatedObservationFault
): ExactCleanupAuthority {
  const wrapper = authority.run.wrapper;
  if (wrapper === undefined)
    throw new Error("Gated wrapper authority is missing");
  if (fault === "ps") throw new Error("Injected process snapshot failure");
  const snapshot = validatedInvocationSnapshot(wrapper, root.owner, marker);
  const next = publishExactCleanupIncrement(authority, {
    wrapper: snapshot.wrapper,
    root: root.path,
    rootIdentity: {
      canonicalPath: root.canonicalPath,
      dev: root.dev,
      ino: root.ino,
      token: root.token,
    },
    payload: snapshot.payload,
    companions: snapshot.companions,
    reaper: snapshot.reaper,
  });
  publish(next);
  expect(next.capture?.failures).toEqual([]);
  return next;
}

/**
 * Release a registered launch and publish only a completely owned invocation.
 * @param launch - Handle registered before GO
 * @param base - Test-owned platform temp root
 * @param publish - Immutable teardown-authority registry
 * @param fault - Optional deterministic readiness failure
 * @returns Fully observed running wrapper
 */
export async function observeGatedTestRun(
  launch: GatedLaunch,
  base: string,
  publish: PublishGatedAuthority,
  fault?: GatedObservationFault
): Promise<GatedWaitingRun> {
  const deadline = Date.now() + ioLatencyBudgetMs(10_000);
  launch.child.stdin?.end("GO\n");
  while (Date.now() < deadline) {
    const root = observedRoot(launch, base);
    if (root !== undefined && completeMarkerExists(launch.marker)) {
      return publishReadyRun(launch, root, publish, fault);
    }
    if (launch.child.exitCode !== null || launch.child.signalCode !== null)
      break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(
    "Gated test run did not publish complete readiness authority"
  );
}

/** Failure-path and immutable-authority oracles for gated real invocations. */
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, vi } from "vitest";

import {
  captureExactProcessIdentities,
  exactProcessIsAlive,
  publishExactCleanupIncrement,
  settleExactTestRuns,
  signalExactProcess,
  type ExactCleanupAuthority,
  type ExactCleanupRunIncrement,
  type ExactProcessIdentity,
} from "./lisa-test-run-exact-process-cleanup.js";
import { createGatedTestRunLaunch } from "./lisa-test-run-gated-launch.js";
import {
  observeGatedTestRun,
  type GatedObservationFault,
} from "./lisa-test-run-gated-observer.js";
import {
  SCRATCH_NAMESPACE,
  temporaryTestRunDirectory,
} from "./lisa-test-run-process.js";
import { waitForExactStoppedReaper } from "./lisa-test-run-sigkill-state.js";

const EXTRA_OWNED_PROCESS_FAULT = "extra-owned-process" as const;
const UNPUBLISHED_READINESS_FAULTS: readonly GatedObservationFault[] = [
  EXTRA_OWNED_PROCESS_FAULT,
  "forged-pid",
  "json",
  "mismatched-root",
  "owner",
  "ps",
];

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

/**
 * Require a fully published exact process identity by PID.
 * @param authority - Immutable invocation authority
 * @param pid - Expected published process identifier
 * @param label - Process role named in a refusal
 * @returns Original PID/birth identity
 */
function identityFor(
  authority: ExactCleanupAuthority,
  pid: number | undefined,
  label: string
): ExactProcessIdentity {
  const identity = authority.capture?.identities.find(
    value => value.pid === pid
  );
  if (identity === undefined)
    throw new Error(`Missing ${label} process authority`);
  return identity;
}

/**
 * Return one otherwise-identical process identity with a changed birth.
 * @param identity - Original exact process identity
 * @returns Identity with only its birth changed
 */
function changedBirth(identity: ExactProcessIdentity): ExactProcessIdentity {
  return { ...identity, birth: `${identity.birth}-changed` };
}

/**
 * Return one otherwise-identical process identity with a changed PID.
 * @param identity - Original exact process identity
 * @returns Identity with only its PID changed
 */
function changedPid(identity: ExactProcessIdentity): ExactProcessIdentity {
  return { ...identity, pid: identity.pid + 100_000 };
}

/**
 * Build every deterministic replacement attempt for one complete authority.
 * @param authority - Fully published invocation authority
 * @returns Field-by-field overwrite controls
 */
function authorityOverwriteControls(
  authority: ExactCleanupAuthority
): readonly ExactCleanupRunIncrement[] {
  const wrapper = authority.run.wrapper;
  const reaper = authority.run.reaper;
  const root = authority.run.root;
  const rootIdentity = authority.run.rootIdentity;
  if (
    wrapper === undefined ||
    reaper === undefined ||
    root === undefined ||
    rootIdentity === undefined
  ) {
    throw new Error("Complete invocation authority was not published");
  }
  const payload = identityFor(authority, authority.run.payloadPid, "payload");
  const companions = (authority.run.companionPids ?? []).map(pid =>
    identityFor(authority, pid, "companion")
  );
  const companion = companions[0];
  if (companion === undefined) {
    throw new Error("Companion authority was not published");
  }
  return [
    { root: `${root}-changed` },
    {
      rootIdentity: {
        ...rootIdentity,
        canonicalPath: `${rootIdentity.canonicalPath}-changed`,
      },
    },
    { rootIdentity: { ...rootIdentity, dev: rootIdentity.dev + 1 } },
    { rootIdentity: { ...rootIdentity, ino: rootIdentity.ino + 1 } },
    { rootIdentity: { ...rootIdentity, token: "0".repeat(32) } },
    { wrapper: changedPid(wrapper) },
    { wrapper: changedBirth(wrapper) },
    { payload: changedPid(payload) },
    { payload: changedBirth(payload) },
    { companions: [changedPid(companion), ...companions.slice(1)] },
    { companions: [changedBirth(companion), ...companions.slice(1)] },
    ...(companions.length < 2
      ? []
      : [{ companions: companions.slice().reverse() }]),
    { reaper: changedPid(reaper) },
    { reaper: changedBirth(reaper) },
  ];
}

/**
 * Prove a readiness failure settles through published authority before assertions.
 * @param register - Suite-local teardown registry
 * @param fault - Deterministic failure after a known readiness phase
 * @returns After exact cleanup and failure-shape assertions
 */
export async function verifyGatedReadinessFailureCleanup(
  register: (directory: string) => void,
  fault: GatedObservationFault
): Promise<void> {
  const base = temporaryTestRunDirectory("lisa-test-run-ready-fail-", register);
  const namespace = path.join(base, SCRATCH_NAMESPACE);
  const unrelated = captureExactProcessIdentities([process.pid]).identities[0];
  const publish = vi.fn<(authority: ExactCleanupAuthority) => void>();
  const primary = await (async (): Promise<unknown> => {
    try {
      const launch = await createGatedTestRunLaunch(
        base,
        "readiness-failure.json",
        publish,
        undefined,
        fault === EXTRA_OWNED_PROCESS_FAULT ? EXTRA_OWNED_PROCESS_FAULT : "wait"
      );
      await observeGatedTestRun(launch, base, publish, fault);
      throw new Error(`Injected ${fault} readiness failure did not fire`);
    } catch (error) {
      return error;
    }
  })();
  const authority = latestAuthority(publish);
  const initialAuthority = publish.mock.calls[0]?.[0];
  const observed = await settleExactTestRuns(
    [authority],
    primary,
    namespace
  ).then(
    () => undefined,
    (error: unknown) => error
  );
  expect(observed).toBeInstanceOf(Error);
  if (UNPUBLISHED_READINESS_FAULTS.includes(fault)) {
    expect(authority).toBe(initialAuthority);
  }
  if (fault === "forged-pid") {
    expect(unrelated).toBeDefined();
    expect(exactProcessIsAlive(unrelated as ExactProcessIdentity)).toBe(true);
  }
  if (fault === EXTRA_OWNED_PROCESS_FAULT) {
    expect(authority?.capture?.identities).toHaveLength(1);
    expect(authority?.run.root).toBeUndefined();
    expect(authority?.run.payloadPid).toBeUndefined();
    expect(authority?.run.companionPids).toBeUndefined();
    expect(authority?.run.reaper).toBeUndefined();
  }
  expect(fs.existsSync(namespace) ? fs.readdirSync(namespace) : []).toEqual([]);
}

/**
 * Prove every once-bound authority field rejects replacement.
 * @param register - Suite-local teardown registry
 * @returns After all overwrite controls and exact cleanup
 */
export async function verifyGatedAuthorityImmutability(
  register: (directory: string) => void
): Promise<void> {
  const base = temporaryTestRunDirectory("lisa-test-run-immutable-", register);
  const namespace = path.join(base, SCRATCH_NAMESPACE);
  const publish = vi.fn<(authority: ExactCleanupAuthority) => void>();
  try {
    const launch = await createGatedTestRunLaunch(
      base,
      "immutable-authority.json",
      publish
    );
    await observeGatedTestRun(launch, base, publish);
    const authority = latestAuthority(publish);
    if (authority === undefined)
      throw new Error("Invocation authority was not published");
    const controls = authorityOverwriteControls(authority);
    for (const control of controls) {
      expect(() => publishExactCleanupIncrement(authority, control)).toThrow(
        /authority cannot change/iu
      );
    }
  } finally {
    await settleExactTestRuns([latestAuthority(publish)], undefined, namespace);
  }
}

/**
 * Prove teardown resumes the original stopped reaper before any fallback signal.
 * @param register - Suite-local teardown registry
 * @returns After the injected assertion and production recovery both settle
 */
export async function verifyStoppedReaperAssertionCleanup(
  register: (directory: string) => void
): Promise<void> {
  const base = temporaryTestRunDirectory(
    "lisa-test-run-stopped-fail-",
    register
  );
  const namespace = path.join(base, SCRATCH_NAMESPACE);
  const publish = vi.fn<(authority: ExactCleanupAuthority) => void>();
  const primary = await (async (): Promise<unknown> => {
    try {
      const launch = await createGatedTestRunLaunch(
        base,
        "stopped-assertion.json",
        publish,
        "pause-recovery-before-drain"
      );
      const run = await observeGatedTestRun(launch, base, publish);
      const authority = latestAuthority(publish);
      if (authority === undefined) {
        throw new Error("Stopped-run authority was not published");
      }
      const wrapper = authority.run.wrapper as ExactProcessIdentity;
      const reaper = authority.run.reaper as ExactProcessIdentity;
      expect(exactProcessIsAlive(wrapper)).toBe(true);
      expect(exactProcessIsAlive(reaper)).toBe(true);
      expect(signalExactProcess(wrapper, "SIGKILL")).toEqual({ sent: true });
      await run.terminal;
      await waitForExactStoppedReaper(reaper);
      expect(fs.existsSync(run.root)).toBe(true);
      throw new Error("Injected assertion failure after stopped reaper");
    } catch (error) {
      return error;
    }
  })();
  const observed = await settleExactTestRuns(
    [latestAuthority(publish)],
    primary,
    namespace
  ).then(
    () => undefined,
    (error: unknown) => error
  );
  expect(observed).toMatchObject({
    message: "Injected assertion failure after stopped reaper",
  });
  expect(fs.existsSync(namespace) ? fs.readdirSync(namespace) : []).toEqual([]);
}

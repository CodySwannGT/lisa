/** Versioned supervision leases and nested Vitest worker scratch scopes. */
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { removeAuthorizedScratchChild } from "./scratch-authority.js";
import {
  createScratchOwnerRecord,
  readScratchOwnerRecord,
  scratchPathIdentity,
  writeScratchOwnerRecord,
  type ScratchOwnerRecordV1,
  type ScratchPathIdentity,
} from "./scratch-owner.js";
import {
  openOwnedScratchRunRoot,
  type ScratchRunRootIntentV1,
} from "./scratch.js";

/** Private environment variable inherited only by a supervised test payload. */
export const SCRATCH_SUPERVISION_LEASE_ENV = "LISA_TEST_RUN_LEASE";

/** Maximum serialized lease accepted from an inherited environment. */
const MAX_LEASE_BYTES = 16 * 1024;

/** Version-one lease: basenames and identities, never a free-form root path. */
export interface ScratchSupervisionLeaseV1 {
  readonly schema: 1;
  readonly token: string;
  readonly suiteRootBasename: string;
  readonly baseCanonicalPath: string;
  readonly namespace: ScratchPathIdentity;
  readonly suiteRoot: ScratchPathIdentity;
  readonly suiteLabel: string;
  readonly registeredPrefixes: readonly string[];
}

/** Durable handle for one worker scope nested inside the supervised suite root. */
export interface SupervisedWorkerScope {
  readonly path: string;
  readonly basename: string;
  readonly parent: ScratchPathIdentity;
  readonly suiteToken: string;
  readonly owner: ScratchOwnerRecordV1;
}

/**
 * Whether a value contains an ASCII control code.
 * @param value - Candidate string
 * @returns Whether a control code is present
 */
function hasControlCode(value: string): boolean {
  return [...value].some(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

/**
 * Validate one inert direct basename.
 * @param value - Candidate basename
 * @returns Whether the value is a direct basename
 */
function validBasename(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "" &&
    value !== "." &&
    value !== ".." &&
    path.basename(value) === value &&
    !value.includes("/") &&
    !value.includes("\\") &&
    Buffer.byteLength(value, "utf8") <= 1_024 &&
    !hasControlCode(value)
  );
}

/**
 * Validate one serialized filesystem identity.
 * @param value - Candidate identity
 * @returns Whether all identity fields are bounded and typed
 */
function validIdentity(value: unknown): value is ScratchPathIdentity {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["canonicalPath"] === "string" &&
    path.isAbsolute(candidate["canonicalPath"]) &&
    Number.isSafeInteger(candidate["dev"]) &&
    Number.isSafeInteger(candidate["ino"])
  );
}

/**
 * Construct a bounded lease only after the suite root has been independently opened.
 * @param intent - Armed suite-root intent
 * @param configuration - Suite attribution captured before collection
 * @param configuration.suiteLabel - Opaque suite label
 * @param configuration.registeredPrefixes - Pre-collection prefix registry
 * @returns Immutable lease
 */
export function createScratchSupervisionLease(
  intent: ScratchRunRootIntentV1,
  configuration: {
    readonly suiteLabel: string;
    readonly registeredPrefixes: readonly string[];
  }
): ScratchSupervisionLeaseV1 {
  const opened = openOwnedScratchRunRoot(intent);
  if (opened === undefined) throw new Error("Supervised suite root is absent");
  return Object.freeze({
    schema: 1 as const,
    token: intent.token,
    suiteRootBasename: intent.basename,
    baseCanonicalPath: intent.authority.baseCanonicalPath,
    namespace: intent.authority.namespace,
    suiteRoot: opened.owner.root,
    suiteLabel: configuration.suiteLabel,
    registeredPrefixes: [...configuration.registeredPrefixes],
  });
}

/**
 * Parse and validate the private bounded lease contract.
 * @param raw - Serialized lease
 * @returns Validated version-one lease
 */
export function parseScratchSupervisionLease(
  raw: string
): ScratchSupervisionLeaseV1 {
  if (Buffer.byteLength(raw, "utf8") > MAX_LEASE_BYTES) {
    throw new Error("Scratch supervision lease exceeds its byte bound");
  }
  const value: unknown = (() => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new Error("Scratch supervision lease must be valid JSON");
    }
  })();
  if (typeof value !== "object" || value === null) {
    throw new Error("Scratch supervision lease must be an object");
  }
  const lease = value as Record<string, unknown>;
  const prefixes = lease["registeredPrefixes"];
  if (
    lease["schema"] !== 1 ||
    typeof lease["token"] !== "string" ||
    !/^[a-f0-9]{32}$/u.test(lease["token"]) ||
    !validBasename(lease["suiteRootBasename"]) ||
    typeof lease["baseCanonicalPath"] !== "string" ||
    !path.isAbsolute(lease["baseCanonicalPath"]) ||
    !validIdentity(lease["namespace"]) ||
    !validIdentity(lease["suiteRoot"]) ||
    typeof lease["suiteLabel"] !== "string" ||
    lease["suiteLabel"] === "" ||
    !Array.isArray(prefixes) ||
    prefixes.length > 64 ||
    !prefixes.every(validBasename)
  ) {
    throw new Error("Invalid scratch supervision lease schema");
  }
  return value as ScratchSupervisionLeaseV1;
}

/**
 * Resolve and validate the suite root from inert lease fields.
 * @param lease - Validated lease
 * @returns Canonical suite-root path and identity
 */
function validateSuiteRoot(lease: ScratchSupervisionLeaseV1): {
  readonly path: string;
  readonly identity: ScratchPathIdentity;
} {
  const namespace = scratchPathIdentity(lease.namespace.canonicalPath);
  if (
    namespace.dev !== lease.namespace.dev ||
    namespace.ino !== lease.namespace.ino ||
    path.dirname(namespace.canonicalPath) !== lease.baseCanonicalPath
  ) {
    throw new Error("Scratch supervision namespace identity changed");
  }
  const rootPath = path.join(namespace.canonicalPath, lease.suiteRootBasename);
  const identity = scratchPathIdentity(rootPath);
  const owner = readScratchOwnerRecord(rootPath);
  if (
    identity.dev !== lease.suiteRoot.dev ||
    identity.ino !== lease.suiteRoot.ino ||
    owner.token !== lease.token ||
    owner.root.dev !== identity.dev ||
    owner.root.ino !== identity.ino
  ) {
    throw new Error("Scratch supervision suite token or identity changed");
  }
  return { path: rootPath, identity };
}

/**
 * Allocate one random worker scope under a token-validated suite root.
 * @param lease - Validated suite lease
 * @returns Durable worker-scope handle
 */
export function createSupervisedWorkerScope(
  lease: ScratchSupervisionLeaseV1
): SupervisedWorkerScope {
  const suite = validateSuiteRoot(lease);
  const basename = `worker-${String(process.pid)}-${randomBytes(8).toString("hex")}`;
  const workerPath = path.join(suite.path, basename);
  fs.mkdirSync(workerPath, { mode: 0o700 });
  try {
    const owner = createScratchOwnerRecord({
      authority: { namespace: suite.identity },
      root: workerPath,
      suiteLabel: lease.suiteLabel,
      registeredPrefixes: lease.registeredPrefixes,
    });
    writeScratchOwnerRecord(workerPath, owner);
    validateSuiteRoot(lease);
    return {
      path: workerPath,
      basename,
      parent: suite.identity,
      suiteToken: lease.token,
      owner,
    };
  } catch (error) {
    removeAuthorizedScratchChild({ parent: suite.identity, basename });
    throw error;
  }
}

/**
 * Remove one worker scope while revalidating its parent lease around deletion.
 * @param scope - Durable worker handle
 * @param lease - Optional parent lease for pre/post validation
 */
export function removeSupervisedWorkerScope(
  scope: SupervisedWorkerScope,
  lease?: ScratchSupervisionLeaseV1
): void {
  if (lease !== undefined) validateSuiteRoot(lease);
  try {
    const owner = readScratchOwnerRecord(scope.path);
    if (
      owner.token !== scope.owner.token ||
      owner.root.dev !== scope.owner.root.dev ||
      owner.root.ino !== scope.owner.root.ino
    ) {
      throw new Error("Supervised worker token or identity changed");
    }
    removeAuthorizedScratchChild({
      parent: scope.parent,
      basename: scope.basename,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (lease !== undefined) validateSuiteRoot(lease);
}

export { parseScratchProtocolMessage } from "./scratch-supervision-protocol.js";
export { validateScratchRunRootIntent } from "./scratch-supervision-intent.js";
export type { ScratchProtocolMessageV1 } from "./scratch-supervision-protocol.js";

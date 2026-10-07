/** Native pathname sockets use a shallow child of the authenticated, reaper-owned suite. */
import { lstatSync, mkdtempSync } from "node:fs";
import { basename, join } from "node:path";
import {
  assertScratchSupervisionTempRoot,
  parseScratchSupervisionLease,
  type ScratchSupervisionLeaseV1,
} from "../../src/configs/vitest/scratch-supervision.js";
import {
  createScratchOwnerRecord,
  readScratchOwnerRecord,
  writeScratchOwnerRecord,
} from "../../src/configs/vitest/scratch-owner.js";
import { removeAuthorizedScratchChild } from "../../src/configs/vitest/scratch-authority.js";

/**
 * Validate the caller's inherited lease before inspecting or creating a root.
 * @param raw - Serialized lease supplied by the unit-test environment boundary.
 * @returns The authenticated current suite lease.
 */
function fixtureLease(raw: string | undefined): ScratchSupervisionLeaseV1 {
  if (!raw)
    throw new Error(
      "Native Unix fixtures require the lisa-test-run supervision lease"
    );
  const lease = parseScratchSupervisionLease(raw);
  assertScratchSupervisionTempRoot(lease);
  return lease;
}

/**
 * Read the owner only after revalidating the same suite authority.
 * @param root - Fixture root created beneath that suite.
 * @param lease - The previously authenticated lease.
 * @returns The current owner record for subsequent exact identity comparison.
 */
function fixtureOwner(root: string, lease: ScratchSupervisionLeaseV1) {
  assertScratchSupervisionTempRoot(lease);
  return readScratchOwnerRecord(root);
}

/**
 * Create identity-bound scratch; the existing suite reaper covers abrupt death.
 * @param socket - The closed supported socket basename.
 * @param rawLease - Inherited lease explicitly supplied by the unit-test caller.
 * @returns A private fixture path and identity-bound cleanup function.
 */
export function createSupervisedUnixFixture(
  socket: "controller.sock" | "hook-reader.sock",
  rawLease: string | undefined
) {
  const lease = fixtureLease(rawLease);
  const prefix = join(lease.suiteRoot.canonicalPath, "u-");
  if (Buffer.byteLength(join(`${prefix}XXXXXX`, socket)) > 103) {
    throw new Error(
      "Native Unix fixture needs a short system temp base selected before lisa-test-run"
    );
  }
  const root = mkdtempSync(prefix);
  const identity = lstatSync(root);
  const checkIdentity = (candidate: string): void => {
    const stat = lstatSync(candidate);
    if (
      stat.isSymbolicLink() ||
      stat.dev !== identity.dev ||
      stat.ino !== identity.ino
    ) {
      throw new Error("Native Unix fixture identity changed");
    }
  };
  const remove = (): void =>
    removeAuthorizedScratchChild({
      parent: lease.suiteRoot,
      basename: basename(root),
      afterIdentityCheck: checkIdentity,
    });
  const owner = (() => {
    try {
      const marker = createScratchOwnerRecord({
        authority: { namespace: lease.suiteRoot },
        root,
        suiteLabel: lease.suiteLabel,
        registeredPrefixes: lease.registeredPrefixes,
      });
      writeScratchOwnerRecord(root, marker);
      assertScratchSupervisionTempRoot(lease);
      return marker;
    } catch (error) {
      remove();
      throw error;
    }
  })();
  return {
    root,
    close: (): void => {
      const actual = fixtureOwner(root, lease);
      if (
        actual.token !== owner.token ||
        actual.root.dev !== owner.root.dev ||
        actual.root.ino !== owner.root.ino
      ) {
        throw new Error("Native Unix fixture owner changed");
      }
      remove();
    },
  };
}

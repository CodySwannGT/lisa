/**
 * The qualified owned handoff from the one cold scanner acquisition to a suite.
 *
 * {@link ownedPreparedScanner} is the only way an affected suite obtains its
 * scanner. It refuses anything but the executable this invocation's cold
 * acquisition produced (`tests/helpers/history-scanner-preparation.ts`):
 *
 * - no preparation, or a failed one, supplies nothing;
 * - the scope must be a private directory this user owns, never a link;
 * - the record must be a regular file whose nonce and evidence match the value
 *   the project provided, so a scope this invocation did not write is refused
 *   even when it holds genuine official bytes;
 * - the executable must be a regular file, never a link, whose bytes are the
 *   pinned official executable.
 *
 * Only then are those exact verified bytes written into the suite's own lease,
 * and the copy is qualified with the production checksum-and-version check
 * before any control receives it. Nothing is executed before its bytes match
 * the pin, and a refusal leaves no file at the destination.
 * @module tests/helpers/history-scanner-handoff
 */
import { chmodSync, lstatSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { VERSION } from "../../all/copy-overwrite/scripts/lib/history-secret-scanner.mjs";
import {
  PREPARATION_RECORD,
  PROVISIONED,
  platformPin,
  qualificationFailure,
  regularFileBytes,
  sha256,
  type ColdProvisionEvidence,
  type HistoryScannerPreparation,
  type ReadyPreparation,
} from "./history-scanner-preparation.js";

/** The scanner a control receives, and the cold proof it came from. */
export interface OwnedScanner {
  /** The suite-owned qualified copy. */
  readonly path: string;
  /** Its SHA256, equal to the pinned official executable. */
  readonly sha256: string;
  /** The version production qualification confirmed. */
  readonly version: string;
  /** The cold production provision this copy descends from. */
  readonly provision: Pick<ColdProvisionEvidence, "argv" | "status" | "stdout">;
}

/** The record fields that must agree with the provided preparation. */
const BOUND_FIELDS = [
  "status",
  "signal",
  "stdout",
  "executableSha256",
  "version",
] as const;

/**
 * Stop the handoff with a reason that names the refused input.
 * @param why - What was wrong with the preparation
 * @returns Never; always throws
 */
function refuse(why: string): never {
  throw new Error(
    `Refused to supply the prepared history scanner: ${why}. No control received a scanner.`
  );
}

/**
 * Require a successful preparation from this invocation.
 * @param preparation - What the history-scanner project provided
 * @returns The ready preparation
 */
function requireReady(
  preparation: HistoryScannerPreparation | undefined
): ReadyPreparation {
  if (preparation === undefined)
    refuse(
      "no cold scanner preparation ran for this invocation; the history-scanner Vitest project's globalSetup performs it"
    );
  if (!preparation.ok)
    refuse(`the cold scanner preparation failed. ${preparation.reason}`);
  return preparation;
}

/**
 * Require the scope to be a private real directory owned by this user.
 * @param ready - The provided preparation
 * @returns The same preparation, its scope verified
 */
function requirePrivateScope(ready: ReadyPreparation): ReadyPreparation {
  const entry = (() => {
    try {
      return lstatSync(ready.scope);
    } catch {
      return refuse("the preparation scope is missing");
    }
  })();
  if (entry.isSymbolicLink())
    refuse("the preparation scope is a symbolic link");
  if (!entry.isDirectory()) refuse("the preparation scope is not a directory");
  if (entry.uid !== process.getuid?.() || (entry.mode & 0o077) !== 0)
    refuse("the preparation scope is not private to this user");
  return ready;
}

/**
 * Require the on-disk record to be this invocation's cold acquisition.
 * @param ready - The provided preparation
 * @returns The same preparation, its record verified
 */
function requireBoundRecord(ready: ReadyPreparation): ReadyPreparation {
  const read = regularFileBytes(
    join(ready.scope, PREPARATION_RECORD),
    "preparation record"
  );
  if ("refusal" in read) refuse(read.refusal);
  const record: unknown = (() => {
    try {
      return JSON.parse(read.bytes.toString("utf8"));
    } catch {
      return refuse("the preparation record is malformed");
    }
  })();
  if (typeof record !== "object" || record === null)
    refuse("the preparation record is malformed");
  const fields = record as Record<string, unknown>;
  const bound =
    fields.nonce === ready.nonce &&
    BOUND_FIELDS.every(field => fields[field] === ready.evidence[field]);
  if (!bound)
    refuse(
      "the preparation record was not written by this invocation's cold acquisition (unknown provenance)"
    );
  if (ready.evidence.status !== 0 || ready.evidence.stdout !== PROVISIONED)
    refuse("the recorded cold provision did not succeed exactly");
  return ready;
}

/**
 * Read the prepared executable's bytes and require them to be the pin.
 * @param ready - The provided preparation
 * @returns The verified official bytes
 */
function requireOfficialBytes(ready: ReadyPreparation): Buffer {
  const pin = platformPin();
  if (pin === undefined) refuse("this platform has no pinned scanner");
  if (ready.executable !== join(ready.scope, "gitleaks"))
    refuse("the prepared executable is outside its preparation scope");
  const read = regularFileBytes(ready.executable, "prepared executable");
  if ("refusal" in read) refuse(read.refusal);
  if (sha256(read.bytes) !== pin.binary)
    refuse(
      "the prepared executable's bytes are not the pinned official executable"
    );
  return read.bytes;
}

/**
 * Qualify a written copy, removing it again when qualification refuses it.
 * @param destination - The owned copy
 * @returns The qualification failure, or undefined when it passed
 */
function qualifiedOrRemoved(destination: string): string | undefined {
  const failure = qualificationFailure(destination);
  if (failure !== undefined) rmSync(destination, { force: true });
  return failure;
}

/**
 * Write verified bytes into the owned lease, then qualify the copy itself.
 * @param destination - Path inside the suite's own lease; must not exist yet
 * @param bytes - The verified official bytes
 * @returns The qualification failure, or undefined when it passed
 */
function writeQualifiedCopy(
  destination: string,
  bytes: Buffer
): string | undefined {
  writeFileSync(destination, bytes, { mode: 0o700, flag: "wx" });
  chmodSync(destination, 0o700);
  return qualifiedOrRemoved(destination);
}

/**
 * Hand a suite its own qualified copy of this invocation's cold-prepared scanner.
 * @param destination - Path inside the suite's own lease; must not exist yet
 * @param preparation - What the history-scanner project provided, via `inject`
 * @returns The qualified owned copy and the cold proof it descends from
 */
export function ownedPreparedScanner(
  destination: string,
  preparation: HistoryScannerPreparation | undefined
): OwnedScanner {
  const ready = requireBoundRecord(
    requirePrivateScope(requireReady(preparation))
  );
  const bytes = requireOfficialBytes(ready);
  const failure = writeQualifiedCopy(destination, bytes);
  const { argv, status, stdout } = ready.evidence;
  if (failure !== undefined)
    refuse(`production qualification refused the owned copy: ${failure}`);
  return {
    path: destination,
    sha256: sha256(bytes),
    version: VERSION,
    provision: { argv, status, stdout },
  };
}

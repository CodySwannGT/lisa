/** Read trust keys from operator configuration outside the audited checkout. */
import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";

import { isJsonObject } from "../sync/json-path.js";
import { isWithin } from "./carrier-owner.js";

/** Where the operator can identify the trusted issuers for this process. */
export const HOST_PROOF_TRUST_FILE = "LISA_HOST_PROOF_TRUST_FILE";

/** Keep reads bounded, including failures on an invalid path. */
const MAX_TRUST_FILE_BYTES = 16 * 1024;

/** The issuer's identity is fixed by each external trust configuration. */
interface Identity {
  readonly id: string;
  readonly key: KeyObject;
}

/** Trusted roles and the repository they can speak for. */
export interface HostProofTrust {
  readonly repository: string;
  readonly environment: string;
  readonly adjudicator: Identity;
  readonly attestor: Identity;
}

/**
 * Read a small ordinary file whose real path is outside the checkout.
 * @param root - Real path of the checkout under evaluation
 * @param named - Operator-provided absolute path
 * @param privateFile - Whether group or other users must lack access
 * @returns Its bytes as text, or null if the file cannot be used
 */
async function readExternalFile(
  root: string,
  named: string,
  privateFile = false
): Promise<string | null> {
  if (!path.isAbsolute(named)) return null;
  try {
    const file = await realpath(named);
    if (isWithin(root, file)) return null;
    const handle = await open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.size > MAX_TRUST_FILE_BYTES ||
        (privateFile && (stat.mode & 0o077) !== 0)
      )
        return null;
      const bytes = Buffer.alloc(MAX_TRUST_FILE_BYTES + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      return bytesRead <= MAX_TRUST_FILE_BYTES
        ? bytes.toString("utf8", 0, bytesRead)
        : null;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/**
 * Read one externally authorized public signer.
 * @param value - An issuer and its PEM public key
 * @returns The authorized identity and Ed25519 key, or null
 */
function identity(value: unknown): Identity | null {
  if (
    !isJsonObject(value) ||
    Object.keys(value).length !== 2 ||
    typeof value.id !== "string" ||
    value.id.trim() === "" ||
    typeof value.public_key !== "string" ||
    !value.public_key.startsWith("-----BEGIN PUBLIC KEY-----")
  )
    return null;
  const key = createPublicKey(value.public_key);
  return key.asymmetricKeyType === "ed25519" ? { id: value.id, key } : null;
}

/**
 * Load the independent adjudicator and attest issuer for this checkout.
 * @param root - Real path of the checkout under evaluation
 * @param named - Path selected by the operator through the process environment
 * @returns The issuers and scope, or null if no trusted configuration is usable
 */
export async function loadHostProofTrust(
  root: string,
  named: string | undefined
): Promise<HostProofTrust | null> {
  if (named === undefined) return null;
  const text = await readExternalFile(root, named);
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (
      !isJsonObject(value) ||
      Object.keys(value).length !== 5 ||
      value.schema_version !== 1 ||
      typeof value.repository !== "string" ||
      value.repository.trim() === "" ||
      typeof value.environment !== "string" ||
      value.environment.trim() === ""
    )
      return null;
    const adjudicator = identity(value.adjudicator);
    const attestor = identity(value.attestor);
    if (
      adjudicator === null ||
      attestor === null ||
      adjudicator.key.equals(attestor.key)
    )
      return null;
    return {
      repository: value.repository,
      environment: value.environment,
      adjudicator,
      attestor,
    };
  } catch {
    return null;
  }
}

/**
 * Load the protected private key for the attest process only.
 * @param root - Real path of the checkout under evaluation
 * @param named - Explicit private key path supplied to attest
 * @param trust - The public attestor key pinned outside the checkout
 * @returns The matching private key, or null when it cannot be used
 */
export async function loadHostProofSigningKey(
  root: string,
  named: string,
  trust: HostProofTrust
): Promise<KeyObject | null> {
  const text = await readExternalFile(root, named, true);
  if (text === null) return null;
  try {
    const key = createPrivateKey(text);
    return key.asymmetricKeyType === "ed25519" &&
      createPublicKey(key).equals(trust.attestor.key)
      ? key
      : null;
  } catch {
    return null;
  }
}

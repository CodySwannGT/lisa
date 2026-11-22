/** Receipts authenticate what attest recorded for a specific hosted check. */
import type { KeyObject } from "node:crypto";

import { isJsonObject } from "../sync/json-path.js";
import { isCanonicalUtc, isEvidenceFresh } from "./evidence.js";
import { isSha256 } from "./evidence-binding.js";
import type { EvidenceDocument, EvidenceRecord } from "./evidence-types.js";
import {
  isHostProofRunIdentity,
  isHostProofSubject,
  type HostProofInput,
  type HostProofRunIdentity,
  type HostProofSubject,
} from "./host-proof-input.js";
import { signHostProof, verifyHostProof } from "./host-proof-signature.js";
import type { HostProofTrust } from "./host-proof-trust.js";
import { digestOf } from "./verdict-digest.js";
import type { PullRequestExecutor } from "./register-types.js";

/** Where the attest writer places its authenticated receipts. */
export const HOST_PROOF_RECEIPTS_PATH =
  ".lisa/controls/host-proof-receipts.json";

/** Do not let an input signature stand in for this receipt's signature. */
const RECEIPT = "host-proof-receipt";

/** A checked receipt binds the exact records written for both runs. */
interface HostProofReceipt {
  readonly schema_version: 1;
  readonly subject: HostProofSubject;
  readonly adjudicator: string;
  readonly attestor: string;
  readonly issued_at: string;
  readonly input_digest: string;
  readonly records_digest: string;
  readonly runs: Readonly<Record<"clean" | "violation", HostProofRunIdentity>>;
}

/**
 * Hide the raw captured text while retaining the evidence identity.
 * @param run - One authorized run
 * @returns Its host identifier, locator, commit, and artifact hash
 */
function runIdentity(run: HostProofInput["clean"]): HostProofRunIdentity {
  const { run_id, run_url, commit, artifact_sha256 } = run;
  return { run_id, run_url, commit, artifact_sha256 };
}

/**
 * Select the finalized exercised evidence for one entry and moment.
 * @param evidence - The complete evidence document
 * @param entry - The register entry whose records are being sealed or checked
 * @returns The exact records, in evidence order
 */
function recordsFor(
  evidence: EvidenceDocument,
  entry: string
): readonly EvidenceRecord[] {
  return evidence.records.filter(
    record =>
      record.entry_id === entry &&
      record.moment === "pull-request" &&
      record.rung === "exercised"
  );
}

/**
 * Tell whether the paired records both held while the approved binding was current.
 * @param records - All exercised records of the entry
 * @param checksDigest - The digest of the currently bound check definitions
 * @param now - The clock used by attest and register
 * @returns The reason the pair cannot be relied on, or null
 */
function pairProblem(
  records: readonly EvidenceRecord[],
  checksDigest: string,
  now: Date
): string | null {
  const clean = records.filter(record => record.half === "clean");
  const violating = new Set(
    records
      .filter(record => record.half === "violation")
      .map(record => record.criterion)
  );
  if (
    clean.length === 0 ||
    records.length !== 2 * clean.length ||
    violating.size !== clean.length ||
    clean.some(record => !violating.has(record.criterion)) ||
    records.some(
      record =>
        record.result !== "held" || record.checks_digest !== checksDigest
    )
  )
    return "The evidence does not contain both held halves for the current check definitions.";
  return records.every(record => isEvidenceFresh(record, now))
    ? null
    : "At least one half of the recorded proof is outside its evidence lifetime.";
}

/**
 * Sign the passed pair that attest is about to write, using the protected issuer.
 * @param source - The independently adjudicated input
 * @param evidence - The exact evidence text's parsed data
 * @param trust - The external authorization for this repository
 * @param signer - The matching private key, available only to the attestor
 * @param now - When these records are written
 * @returns A signed receipt, or null when the completed pair did not hold
 */
export function sealHostProof(
  source: HostProofInput,
  evidence: EvidenceDocument,
  trust: HostProofTrust,
  signer: KeyObject,
  now: Date
) {
  const { subject, clean, violation } = source;
  const records = recordsFor(evidence, subject.entry_id);
  if (
    subject.checks_digest !== evidence.checks.digest ||
    pairProblem(records, subject.checks_digest, now) !== null
  )
    return null;
  const receipt: HostProofReceipt = {
    schema_version: 1,
    subject,
    adjudicator: trust.adjudicator.id,
    attestor: trust.attestor.id,
    issued_at: now.toISOString(),
    input_digest: digestOf(source),
    records_digest: digestOf(records),
    runs: { clean: runIdentity(clean), violation: runIdentity(violation) },
  };
  return signHostProof(RECEIPT, receipt, signer);
}

/** All information needed to check one receipt against current evidence. */
interface ReceiptCheck {
  readonly evidence: EvidenceDocument;
  readonly checkedDigest: string;
  readonly trust: HostProofTrust;
  readonly entry: string;
  readonly executor: PullRequestExecutor;
  readonly now: Date;
}

/**
 * Check the shape of both immutable run identities recorded by the attestor.
 * @param runs - Run fields in the signed receipt
 * @returns Whether the receipt describes two distinct commits and runs
 */
function receiptRuns(runs: unknown): boolean {
  return (
    isJsonObject(runs) &&
    Object.keys(runs).length === 2 &&
    isHostProofRunIdentity(runs.clean) &&
    isHostProofRunIdentity(runs.violation) &&
    Object.keys(runs.clean).length === 4 &&
    Object.keys(runs.violation).length === 4 &&
    runs.clean.run_id !== runs.violation.run_id &&
    runs.clean.run_url !== runs.violation.run_url &&
    runs.clean.commit !== runs.violation.commit
  );
}

/**
 * Check the attestor, target, written records and evidence age together.
 * @param envelope - A candidate receipt read from the checkout
 * @param check - The actual repository, authority, entry and current evidence
 * @returns Why the receipt cannot clear the mark, or null when it can
 */
export function hostProofReceiptProblem(
  envelope: unknown,
  check: ReceiptCheck
): string | null {
  const { evidence, checkedDigest, trust, entry, executor, now } = check;
  const receipt = verifyHostProof(envelope, RECEIPT, trust.attestor.key);
  if (receipt === null)
    return "The receipt signature could not be verified with the authorized attestor key.";
  if (
    Object.keys(receipt).length !== 8 ||
    receipt.schema_version !== 1 ||
    receipt.adjudicator !== trust.adjudicator.id ||
    receipt.attestor !== trust.attestor.id ||
    !isCanonicalUtc(receipt.issued_at) ||
    Date.parse(receipt.issued_at) > now.getTime() ||
    !isSha256(receipt.input_digest) ||
    !isSha256(receipt.records_digest) ||
    !isHostProofSubject(receipt.subject) ||
    !receiptRuns(receipt.runs)
  )
    return "The signed receipt has an invalid schema, run identity, or issuing authority.";

  const { subject } = receipt;
  if (
    subject.repository !== trust.repository ||
    subject.environment !== trust.environment ||
    subject.entry_id !== entry ||
    subject.platform !== executor.platform ||
    subject.executor_path !== executor.path ||
    subject.checks_digest !== checkedDigest ||
    evidence.checks.digest !== checkedDigest
  )
    return "The receipt targets a different repository, environment, entry, executor, or check definition.";
  const records = recordsFor(evidence, entry);
  return receipt.records_digest === digestOf(records)
    ? pairProblem(records, checkedDigest, now)
    : "The recorded evidence does not match the signed receipt.";
}

/** Resolve which hosted checks have a current receipt from an authorized attestor. */
import type { KeyObject } from "node:crypto";

import { isJsonObject } from "../sync/json-path.js";
import { readEnv } from "../utils/process-environment.js";
import { canonicalFileText } from "./canonical-json.js";
import { bindChecks } from "./checks-binding.js";
import { readControlFile } from "./control-files.js";
import { EVIDENCE_PATH } from "./evidence.js";
import { parseEvidenceDocument } from "./evidence-document.js";
import type { EvidenceDocument } from "./evidence-types.js";
import type { HostProofInput } from "./host-proof-input.js";
import {
  HOST_PROOF_RECEIPTS_PATH,
  hostProofReceiptProblem,
  sealHostProof,
} from "./host-proof-receipt.js";
import {
  HOST_PROOF_TRUST_FILE,
  loadHostProofTrust,
  type HostProofTrust,
} from "./host-proof-trust.js";
import { readOriginUrl } from "./protect-platform.js";
import { unwrittenExecutor } from "./pull-request-executor.js";
import type { ControlRegisterEntry } from "./register-types.js";

/** The verified input and protected issuer of the next receipt. */
export interface PendingHostReceipt {
  readonly source: HostProofInput;
  readonly trust: HostProofTrust;
  readonly signer: KeyObject;
}

/** Current entry ids and fixed diagnostic text for any remaining gaps. */
interface HostProofStatus {
  readonly current: ReadonlySet<string>;
  readonly notes: readonly string[];
}

/**
 * Read the receipt list without assuming any row is trustworthy.
 * @param root - Real checkout path
 * @returns The proposed receipts, or null when the file cannot be used
 */
async function readHostProofReceipts(
  root: string
): Promise<readonly unknown[] | null> {
  const file = await readControlFile(root, HOST_PROOF_RECEIPTS_PATH);
  if (file.kind === "missing") return [];
  if (file.kind !== "text") return null;
  try {
    const value: unknown = JSON.parse(file.text);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Find the reason this entry's signed record cannot be used.
 * @param entry - A hosted register entry
 * @param evidence - The exact stored evidence, bound to the current files
 * @param receipts - Candidate receipts from the checkout
 * @param trust - The authorized parties for the checkout
 * @param now - The same clock used to check the evidence lifetime
 * @returns A fixed diagnostic, or null when the receipt is current
 */
function entryProofProblem(
  entry: ControlRegisterEntry,
  evidence: EvidenceDocument,
  receipts: readonly unknown[],
  trust: HostProofTrust,
  now: Date
): string | null {
  const executor = unwrittenExecutor(entry);
  if (
    executor === null ||
    !evidence.checks.covered.some(file => file.path === executor.path)
  )
    return "The evidence does not cover the declared executor file.";
  const candidates = receipts.filter(
    receipt => receiptEntry(receipt) === entry.id
  );
  const problems = candidates.map(receipt =>
    hostProofReceiptProblem(receipt, {
      evidence,
      checkedDigest: evidence.checks.digest,
      trust,
      entry: entry.id,
      executor,
      now,
    })
  );
  if (problems.includes(null)) return null;
  return problems[0] ?? "There is no signed receipt for this entry.";
}

/**
 * Read the entry name out of an existing list slot so attest can replace it.
 * @param value - A receipt candidate that may have been edited
 * @returns The claimed entry, or undefined when there is none
 */
function receiptEntry(value: unknown): unknown {
  return isJsonObject(value) &&
    isJsonObject(value.body) &&
    isJsonObject(value.body.subject)
    ? value.body.subject.entry_id
    : undefined;
}

/**
 * Seal only the records the next attest write will actually store.
 * @param root - Real checkout path
 * @param evidence - The finalized evidence to be written with the receipt
 * @param pending - The approved input and private attestor identity
 * @param now - When the proof was recorded
 * @returns The receipt file text, or null if the update could not be produced
 */
export async function hostReceiptText(
  root: string,
  evidence: EvidenceDocument,
  pending: PendingHostReceipt,
  now: Date
): Promise<string | null> {
  const receipt = sealHostProof(
    pending.source,
    evidence,
    pending.trust,
    pending.signer,
    now
  );
  if (receipt === null) return null;
  const earlier = await readHostProofReceipts(root);
  if (earlier === null) return null;
  return canonicalFileText([
    ...earlier.filter(
      row => receiptEntry(row) !== pending.source.subject.entry_id
    ),
    receipt,
  ]);
}

/**
 * Read the evidence and candidate receipts with a current binding.
 * @param root - Real checkout path
 * @returns The current evidence and candidate receipts, or why they cannot be used
 */
async function currentReceiptInputs(root: string) {
  const [evidenceFile, receipts] = await Promise.all([
    readControlFile(root, EVIDENCE_PATH),
    readHostProofReceipts(root),
  ]);
  if (receipts === null)
    return "The host proof receipt file is unreadable or invalid.";
  if (receipts.length === 0)
    return "No signed host proof receipt is on record.";
  if (evidenceFile.kind !== "text")
    return "The signed receipts have no readable evidence file.";
  const parsed = parseEvidenceDocument(
    JSON.parse(evidenceFile.text) as unknown
  );
  if (parsed.problems !== null)
    return "The evidence file does not match the required schema.";
  const evidence = parsed.document;
  const covered = evidence.checks.covered.map(file => file.path);
  const binding = await bindChecks({ repository: root, also: covered });
  return binding.digest === evidence.checks.digest
    ? { evidence, receipts }
    : "The check definitions changed after the host proof was recorded.";
}

/**
 * Recompute the current binding and check the attest signature for each entry.
 * @param root - Real checkout path
 * @param entries - Register entries marked unproved before checking receipts
 * @param now - The same clock used to assess the evidence's expiry
 * @param trustPath - Externally selected trust configuration for this process
 * @returns Entries whose exact stored proof is current and notes for the other entries
 */
export async function evaluateHostReceipts(
  root: string,
  entries: readonly ControlRegisterEntry[],
  now: Date,
  trustPath = readEnv(HOST_PROOF_TRUST_FILE)
): Promise<HostProofStatus> {
  const wanted = entries.filter(entry => entry.status === "unproved");
  const unresolved = (message: string): HostProofStatus => ({
    current: new Set(),
    notes: [message],
  });
  if (wanted.length === 0 || trustPath === undefined)
    return { current: new Set(), notes: [] };
  try {
    const trust = await loadHostProofTrust(root, trustPath);
    if (trust === null || (await readOriginUrl(root)) !== trust.repository)
      return unresolved(
        "The external host proof trust file is invalid or does not match this repository's origin."
      );
    const inputs = await currentReceiptInputs(root);
    if (typeof inputs === "string") return unresolved(inputs);
    const { evidence, receipts } = inputs;
    const outcomes = wanted.map(entry => ({
      id: entry.id,
      problem: entryProofProblem(entry, evidence, receipts, trust, now),
    }));
    return {
      current: new Set(
        outcomes.flatMap(({ id, problem }) => (problem === null ? [id] : []))
      ),
      notes: outcomes.flatMap(({ id, problem }) =>
        problem === null ? [] : [`${id}: ${problem}`]
      ),
    };
  } catch {
    return unresolved(
      "The host proof receipt or evidence could not be checked."
    );
  }
}

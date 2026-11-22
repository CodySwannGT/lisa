/**
 * The independent adjudicator's account of two pull-request runs.
 * @module
 */
import { isJsonObject } from "../sync/json-path.js";
import { isCanonicalUtc } from "./evidence.js";
import { isSha256 } from "./evidence-binding.js";

/** What both halves of the check were tied to in the host. */
export interface HostProofSubject {
  readonly repository: string;
  readonly environment: string;
  readonly work_item: string;
  readonly entry_id: string;
  readonly platform: string;
  readonly executor_path: string;
  readonly checks_digest: string;
}

/** The identity retained when a run's output is kept separately. */
export interface HostProofRunIdentity {
  readonly run_id: string;
  readonly run_url: string;
  readonly commit: string;
  readonly artifact_sha256: string;
}

/** One immutable platform run and the end of its check output. */
interface HostProofRun extends HostProofRunIdentity {
  readonly started_at: string;
  readonly completed_at: string;
  readonly exit_status: number;
  readonly output_excerpt: string;
}

/** A signed input stays distinct from the receipt that attest writes. */
export interface HostProofInput {
  readonly schema_version: 1;
  readonly subject: HostProofSubject;
  readonly producer: string;
  readonly adjudicator: string;
  readonly clean: HostProofRun;
  readonly violation: HostProofRun;
}

/** Fields describing which declared check the proof ran. */
const SUBJECT_LABELS = [
  "repository",
  "environment",
  "work_item",
  "entry_id",
  "platform",
  "executor_path",
] as const;

/** Git object ids may be SHA-1 or SHA-256, according to the host repository. */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/** Limit prose to the evidence document's role as a short record. */
const EXCERPT_LIMIT = 16_384;

/**
 * Tell whether a name or identifier fits on one line.
 * @param value - A name supplied by the adjudicator
 * @returns Whether it can be used as a label
 */
function label(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 512 &&
    value.trim() === value &&
    value !== "" &&
    !/[\r\n\t]/u.test(value)
  );
}

/**
 * A proof refers to a hosted run without including authentication material.
 * @param value - The recorded run locator
 * @returns Whether it is an HTTPS resource with a path and no credentials
 */
function runLocator(value: unknown): boolean {
  if (!label(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.pathname !== "/" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

/**
 * Validate the target of a paired proof.
 * @param value - The signed subject
 * @returns Whether it names the specific repository, entry and check files
 */
export function isHostProofSubject(value: unknown): value is HostProofSubject {
  return (
    isJsonObject(value) &&
    Object.keys(value).length === SUBJECT_LABELS.length + 1 &&
    SUBJECT_LABELS.every(key => label(value[key])) &&
    isSha256(value.checks_digest)
  );
}

/**
 * Validate the provenance fields shared between an input run and its receipt.
 * @param value - A run record supplied by either authorized role
 * @returns Whether it identifies one hosted run and its artifact
 */
export function isHostProofRunIdentity(
  value: unknown
): value is HostProofRunIdentity {
  return (
    isJsonObject(value) &&
    label(value.run_id) &&
    runLocator(value.run_url) &&
    typeof value.commit === "string" &&
    OBJECT_ID.test(value.commit) &&
    isSha256(value.artifact_sha256)
  );
}

/**
 * Validate the result of one platform run.
 * @param value - The signed account of the run
 * @returns Whether the run carries all data needed to record what it measured
 */
function hostRun(value: unknown): value is HostProofRun {
  return (
    isJsonObject(value) &&
    Object.keys(value).length === 8 &&
    isCanonicalUtc(value.started_at) &&
    isCanonicalUtc(value.completed_at) &&
    value.started_at <= value.completed_at &&
    typeof value.exit_status === "number" &&
    Number.isInteger(value.exit_status) &&
    value.exit_status >= 0 &&
    value.exit_status <= 255 &&
    typeof value.output_excerpt === "string" &&
    value.output_excerpt.length <= EXCERPT_LIMIT &&
    isHostProofRunIdentity(value)
  );
}

/**
 * Read the two halves and their common binding from an authenticated input.
 * @param value - The body of an authorized signed envelope
 * @returns The well-formed pair, or null when the declaration cannot be used
 */
export function hostProofInput(value: unknown): HostProofInput | null {
  if (
    !isJsonObject(value) ||
    Object.keys(value).length !== 6 ||
    value.schema_version !== 1 ||
    !isHostProofSubject(value.subject) ||
    !label(value.producer) ||
    !label(value.adjudicator) ||
    !hostRun(value.clean) ||
    !hostRun(value.violation)
  )
    return null;

  const { subject, producer, adjudicator, clean, violation } = value;
  if (
    producer === adjudicator ||
    clean.run_id === violation.run_id ||
    clean.run_url === violation.run_url ||
    clean.commit === violation.commit ||
    clean.exit_status !== 0 ||
    violation.exit_status === 0
  )
    return null;

  return {
    schema_version: 1,
    subject,
    producer,
    adjudicator,
    clean,
    violation,
  };
}

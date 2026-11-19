/**
 * Putting together the evidence file an attest run leaves behind.
 *
 * Three things go into it: what the file held before, what this run found
 * out about the controls in the register, and what the audit report says.
 * This module reads the first and the last from the repository and hands
 * all three to `./evidence-write.ts`, which decides what stands.
 *
 * Nothing is written here. A file that is in the way (a link where the
 * evidence file or its folder should be) stops the run; an evidence file
 * that is not what the attest step writes, and an audit report that is
 * missing or does not pass its check, do not: the run goes on without them
 * and says so, because a requirement with nothing on record reads
 * `unknown`, which is the truth.
 *
 * ## What an earlier run recorded about other checks
 *
 * Every record carries the digest of what defined the checks when it was
 * made, and the file carries this run's (`./checks-binding.ts`). An earlier
 * record is kept only when the two are the same. The only records a run
 * keeps at all are an earlier run's canary results at the pull-request
 * moment, so those are the ones that can be lost this way: when any is, one
 * line says how many and how to produce them again. A file written before
 * records carried a digest holds none that can be kept, and is counted the
 * same way.
 * @module controls/evidence-gather
 */
import path from "node:path";

import { isJsonObject } from "../sync/json-path.js";
import { readInlineAnswers } from "./audit-inline-answers-file.js";
import { pathKind, type AuditReportLoad } from "./audit-report-file.js";
import { AUDIT_REPORT_JSON_PATH } from "./audit-report-types.js";
import { readControlFile } from "./control-files.js";
import { EVIDENCE_PATH } from "./evidence.js";
import { evidencePredatesBinding } from "./evidence-binding.js";
import {
  evidenceDocumentOf,
  parseEvidenceDocument,
} from "./evidence-document.js";
import { findingRecords } from "./evidence-findings.js";
import { echoedCredentialNote } from "./evidence-redact.js";
import type {
  ChecksBinding,
  EvidenceBatch,
  EvidenceDocument,
  EvidenceRecord,
} from "./evidence-types.js";
import {
  batchRecords,
  droppedForOtherChecks,
  droppedForOtherChecksLine,
  mergedEvidence,
  type EvidenceStamp,
} from "./evidence-write.js";
import { PULL_REQUEST_MOMENT } from "./pull-request-executor.js";
import type { ControlRegister } from "./register-types.js";
import { createRepositoryReader } from "./repository-reader.js";

/** What putting the evidence together needs. */
export interface EvidenceToGather {
  /** Real path of the repository. */
  readonly root: string;
  /** The control register the results are about. */
  readonly register: ControlRegister;
  /** What each step of this run found out. */
  readonly batches: readonly EvidenceBatch[];
  /** The commit and the freshness lifetime of the run. */
  readonly stamp: Pick<EvidenceStamp, "commit" | "freshnessSeconds">;
  /** What defined the checks at this run; every record carries its digest. */
  readonly checks: ChecksBinding;
  /** The current time, which dates the reading of the audit report. */
  readonly now: Date;
  /** Reads the audit report and holds it to every rule. */
  readonly loadReport: (root: string, now: Date) => Promise<AuditReportLoad>;
}

/** The evidence file to write, or one line per reason there is none. */
export type GatheredEvidence =
  | {
      readonly problems: null;
      readonly evidence: EvidenceDocument;
      /** What to tell the operator about what was left out. */
      readonly notes: readonly string[];
      /**
       * What the operator must be told whatever the output mode: an earlier
       * run's results that were dropped, and how to produce them again.
       */
      readonly warnings: readonly string[];
    }
  | { readonly problems: readonly string[] };

/** Some records, and what to tell the operator when a source gave none. */
interface RecordsRead {
  readonly records: readonly EvidenceRecord[];
  readonly note: string | null;
}

/** What the evidence file held before this run. */
interface EarlierEvidence extends RecordsRead {
  /**
   * How many canary results a file written before records carried a digest
   * held. None of them can be kept.
   */
  readonly unbound: number;
}

/** What is said when the evidence file held something else. */
const REPLACED = `${EVIDENCE_PATH} did not hold what the attest step writes, so nothing in it was kept and it was written again from this run.`;

/** What is said when the evidence file was written before the binding. */
const PREDATED = `${EVIDENCE_PATH} was written before evidence was bound to what defines the checks, so nothing in it was kept and it was written again from this run.`;

/**
 * Count the canary results in a file written before records carried a
 * digest. The file is not read as evidence; this only says what is lost.
 * @param document - The parsed file, a JSON object with no `checks`
 * @returns How many of its records are exercised at the pull-request moment
 */
function unboundCanaryResults(document: unknown): number {
  const records =
    isJsonObject(document) && Array.isArray(document.records)
      ? (document.records as readonly unknown[])
      : [];
  return records.filter(
    record =>
      isJsonObject(record) &&
      record.moment === PULL_REQUEST_MOMENT &&
      record.rung === "exercised"
  ).length;
}

/**
 * Read the records the evidence file held before this run.
 * @param root - Real path of the repository
 * @returns The records, or the reason the file cannot be touched
 */
async function earlierEvidence(
  root: string
): Promise<EarlierEvidence | { readonly problem: string }> {
  const read = await readControlFile(root, EVIDENCE_PATH);
  if (read.kind === "blocked") return { problem: read.problem };
  if (read.kind === "missing") return { records: [], note: null, unbound: 0 };
  try {
    const document = JSON.parse(read.text) as unknown;
    if (evidencePredatesBinding(document)) {
      return {
        records: [],
        note: PREDATED,
        unbound: unboundCanaryResults(document),
      };
    }
    const parsed = parseEvidenceDocument(document);
    return parsed.problems === null
      ? { records: parsed.document.records, note: null, unbound: 0 }
      : { records: [], note: REPLACED, unbound: 0 };
  } catch {
    return { records: [], note: REPLACED, unbound: 0 };
  }
}

/**
 * Turn the audit report's findings into records, when there is a report
 * that passes its check.
 * @param request - The repository, the time, the stamp and the report reader
 * @param stamp - What every record of this run carries
 * @returns The records, and what to tell the operator when there are none
 */
async function auditFindings(
  request: EvidenceToGather,
  stamp: EvidenceStamp
): Promise<RecordsRead> {
  const { root, now } = request;
  const reads = `so nothing is on record for a requirement that no control serves, and each one reads unknown`;
  if ((await pathKind(path.join(root, AUDIT_REPORT_JSON_PATH))) === "missing") {
    return {
      records: [],
      note: `No audit report is at ${AUDIT_REPORT_JSON_PATH}, ${reads}. Run the audit, then run this again.`,
    };
  }
  const loaded = await request.loadReport(root, now);
  if (loaded.problems === null) {
    return {
      // The repository is read again here, at gather time: what a finding
      // points at is looked for now, whatever the report's own check found.
      // The same goes for what people typed on the answer lines: an answer
      // counts as a person's only while its line still holds it.
      records: findingRecords({
        report: loaded.report,
        inlineAnswers: await readInlineAnswers(root),
        criteria: loaded.criteria,
        repository: createRepositoryReader(root),
        stamp,
        readAt: now,
      }),
      note: null,
    };
  }
  const count = loaded.problems.length;
  return {
    records: [],
    note: `The audit report at ${AUDIT_REPORT_JSON_PATH} does not pass its check (${count} ${count === 1 ? "problem" : "problems"}), ${reads}. Run "lisa controls report-check" to see why.`,
  };
}

/**
 * Put together the evidence file a run leaves behind.
 * @param request - What the run found out, and where to read the rest
 * @returns The file to write, or one line per reason there is none
 */
export async function gatherEvidence(
  request: EvidenceToGather
): Promise<GatheredEvidence> {
  const { root, register, batches, checks } = request;
  const stamp: EvidenceStamp = {
    ...request.stamp,
    checksDigest: checks.digest,
  };
  const earlier = await earlierEvidence(root);
  if ("problem" in earlier) return { problems: [earlier.problem] };
  const built = batchRecords(batches, register, stamp);
  if (built.problems !== null) return { problems: built.problems };
  const findings = await auditFindings(request, stamp);
  const parts = {
    earlier: earlier.records,
    register,
    batches,
    records: [...built.records, ...findings.records],
    checksDigest: checks.digest,
  };
  const evidence = evidenceDocumentOf(mergedEvidence(parts), checks);
  // Held to the same reading the verdict's check uses, so nothing is written
  // that would later be refused.
  const checked = parseEvidenceDocument(evidence);
  if (checked.problems !== null) return { problems: checked.problems };
  const dropped = droppedForOtherChecksLine(
    droppedForOtherChecks(parts) + earlier.unbound
  );
  return {
    problems: null,
    evidence,
    notes: [earlier.note, findings.note, echoedCredentialNote(batches)].flatMap(
      note => (note === null ? [] : [note])
    ),
    warnings: dropped === null ? [] : [dropped],
  };
}

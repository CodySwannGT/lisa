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
 * @module controls/evidence-gather
 */
import path from "node:path";

import { pathKind, type AuditReportLoad } from "./audit-report-file.js";
import { AUDIT_REPORT_JSON_PATH } from "./audit-report-types.js";
import { readControlFile } from "./control-files.js";
import { EVIDENCE_PATH } from "./evidence.js";
import {
  evidenceDocumentOf,
  parseEvidenceDocument,
} from "./evidence-document.js";
import { findingRecords } from "./evidence-findings.js";
import { echoedCredentialNote } from "./evidence-redact.js";
import type {
  EvidenceBatch,
  EvidenceDocument,
  EvidenceRecord,
} from "./evidence-types.js";
import {
  batchRecords,
  mergedEvidence,
  type EvidenceStamp,
} from "./evidence-write.js";
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
  readonly stamp: EvidenceStamp;
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
    }
  | { readonly problems: readonly string[] };

/** Some records, and what to tell the operator when a source gave none. */
interface RecordsRead {
  readonly records: readonly EvidenceRecord[];
  readonly note: string | null;
}

/** What is said when the evidence file held something else. */
const REPLACED = `${EVIDENCE_PATH} did not hold what the attest step writes, so nothing in it was kept and it was written again from this run.`;

/**
 * Read the records the evidence file held before this run.
 * @param root - Real path of the repository
 * @returns The records, or the reason the file cannot be touched
 */
async function earlierEvidence(
  root: string
): Promise<RecordsRead | { readonly problem: string }> {
  const read = await readControlFile(root, EVIDENCE_PATH);
  if (read.kind === "blocked") return { problem: read.problem };
  if (read.kind === "missing") return { records: [], note: null };
  try {
    const parsed = parseEvidenceDocument(JSON.parse(read.text) as unknown);
    return parsed.problems === null
      ? { records: parsed.document.records, note: null }
      : { records: [], note: REPLACED };
  } catch {
    return { records: [], note: REPLACED };
  }
}

/**
 * Turn the audit report's findings into records, when there is a report
 * that passes its check.
 * @param request - The repository, the time, the stamp and the report reader
 * @returns The records, and what to tell the operator when there are none
 */
async function auditFindings(request: EvidenceToGather): Promise<RecordsRead> {
  const { root, now, stamp } = request;
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
      records: findingRecords({
        report: loaded.report,
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
  const { root, register, batches, stamp } = request;
  const earlier = await earlierEvidence(root);
  if ("problem" in earlier) return { problems: [earlier.problem] };
  const built = batchRecords(batches, register, stamp);
  if (built.problems !== null) return { problems: built.problems };
  const findings = await auditFindings(request);
  const evidence = evidenceDocumentOf(
    mergedEvidence({
      earlier: earlier.records,
      register,
      batches,
      records: [...built.records, ...findings.records],
    })
  );
  // Held to the same reading the verdict's check uses, so nothing is written
  // that would later be refused.
  const checked = parseEvidenceDocument(evidence);
  return checked.problems === null
    ? {
        problems: null,
        evidence,
        notes: [
          earlier.note,
          findings.note,
          echoedCredentialNote(batches),
        ].flatMap(note => (note === null ? [] : [note])),
      }
    : { problems: checked.problems };
}

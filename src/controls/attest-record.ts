/**
 * Writing down what an attest run found: the evidence, then the register,
 * then the verdict.
 *
 * The order is the point of this module.
 *
 * 1. **Evidence.** The run's results, and the findings of the audit report
 *    when one passes its check, become records in
 *    `.lisa/controls/evidence.json` (`./evidence-gather.ts`).
 * 2. **Register.** The control register is generated from the gates
 *    declaration *and* the evidence file: an entry reads `unproved` until
 *    both halves of its proof are on record and held. So new evidence can
 *    change the register, and it is written again here, after the evidence
 *    and before anything is computed from it.
 * 3. **Verdict.** Computed from that register and that evidence, with a
 *    digest of both (`./verdict.ts`), and written to
 *    `.lisa/controls/verdict.json`.
 *
 * Done in any other order, the digest would cover a register that the next
 * `lisa controls register --check` calls out of date.
 *
 * Nothing here asks a model anything, and nothing is written outside the
 * three files. A file is left alone when it already holds what would be
 * written.
 * @module controls/attest-record
 */
import {
  loadAuditReport,
  resolveRepositoryRoot,
  type AuditReportLoad,
} from "./audit-report-file.js";
import {
  loadCriterionCatalogue,
  type CriterionCatalogue,
} from "./catalogue.js";
import { writeControlFile, type ControlFileWrite } from "./control-files.js";
import { EVIDENCE_PATH } from "./evidence.js";
import { serializeEvidence } from "./evidence-document.js";
import { gatherEvidence } from "./evidence-gather.js";
import {
  DEFAULT_FRESHNESS_SECONDS,
  MAX_FRESHNESS_SECONDS,
  type EvidenceBatch,
  type EvidenceDocument,
  type EvidenceRecord,
} from "./evidence-types.js";
import { proofRunBatch } from "./evidence-write.js";
import { readHeadCommit } from "./head-commit.js";
import type { ProofRun } from "./proof-types.js";
import {
  generateControlRegister,
  type ControlRegisterGeneration,
} from "./register.js";
import { CONTROL_REGISTER_PATH } from "./register-types.js";
import { computeVerdict, serializeVerdict } from "./verdict.js";
import { levelSummary } from "./verdict-summary.js";
import { VERDICT_PATH, type Verdict } from "./verdict-types.js";

/** What an attest run hands over to be written down. */
export interface AttestationToRecord {
  /** Absolute path of the repository the operator named. */
  readonly named: string;
  /** The paired-proof runner's results. */
  readonly run: ProofRun;
  /**
   * The current time: when the audit report is read, and what freshness is
   * judged against.
   */
  readonly now: Date;
  /**
   * What other steps found out about register entries in the same run, for
   * example at the pull-request moment. Each batch replaces the earlier
   * records of the entries and moments it names.
   */
  readonly batches?: readonly EvidenceBatch[];
  /**
   * How long each record written now may be relied on, in whole seconds.
   * {@link DEFAULT_FRESHNESS_SECONDS} when left out.
   */
  readonly freshnessSeconds?: number;
  /**
   * The commit the proofs were run against: the one the run's disposable
   * copy was made from. Every record written now names it. A run takes
   * time and the repository can move meanwhile, so this is not read again
   * when the results are written. Left out when nothing was cloned (a
   * register with no entries), and the records then name the commit the
   * repository is at.
   */
  readonly commit?: string;
}

/** What writing down needs from outside, each replaceable in a test. */
export interface RecordAttestationDependencies {
  /** Generates the register of a repository. */
  readonly generate?: (root: string) => Promise<ControlRegisterGeneration>;
  /** Reads the commit the repository is at. */
  readonly readHead?: (root: string) => Promise<string | null>;
  /** Reads the audit report and holds it to every rule. */
  readonly loadReport?: (root: string, now: Date) => Promise<AuditReportLoad>;
  /** Loads the requirements catalogue. */
  readonly loadCatalogue?: () => CriterionCatalogue;
  /** Writes one of the files under `.lisa/controls/`. */
  readonly writeFile?: (
    root: string,
    file: string,
    text: string
  ) => Promise<ControlFileWrite>;
}

/** What was written down, or one line per reason nothing more was. */
export type RecordedAttestation =
  | {
      readonly problems: null;
      /** What to tell the operator, one line each. */
      readonly lines: readonly string[];
      readonly evidence: EvidenceDocument;
      readonly verdict: Verdict;
    }
  | { readonly problems: readonly string[] };

/**
 * Say why a freshness lifetime cannot be used, when it cannot.
 * @param seconds - The lifetime
 * @returns The problem, or `null`
 */
function lifetimeProblem(seconds: number): string | null {
  return Number.isInteger(seconds) &&
    seconds >= 1 &&
    seconds <= MAX_FRESHNESS_SECONDS
    ? null
    : `The freshness lifetime must be a whole number of seconds from 1 to ${MAX_FRESHNESS_SECONDS} (twelve months); it was ${String(seconds)}.`;
}

/**
 * Say how many records the evidence file holds and where they came from.
 * @param records - The records
 * @returns The line
 */
function recordedLine(records: readonly EvidenceRecord[]): string {
  const fromAudit = records.filter(record => record.entry_id === null).length;
  const noun = records.length === 1 ? "record" : "records";
  return `Recorded ${records.length} evidence ${noun} in ${EVIDENCE_PATH}: ${records.length - fromAudit} about controls, ${fromAudit} from the audit report.`;
}

/**
 * Write the three files of one repository, in order.
 * @param root - Real path of the repository
 * @param evidence - The evidence file to write
 * @param now - The current time
 * @param dependencies - Replaceable collaborators
 * @returns The verdict, or one line per reason a file was not written
 */
async function writeInOrder(
  root: string,
  evidence: EvidenceDocument,
  now: Date,
  dependencies: RecordAttestationDependencies
): Promise<
  | { readonly problems: null; readonly verdict: Verdict }
  | { readonly problems: readonly string[] }
> {
  const generate = dependencies.generate ?? generateControlRegister;
  const write = dependencies.writeFile ?? writeControlFile;
  // 1. The evidence.
  const first = await write(root, EVIDENCE_PATH, serializeEvidence(evidence));
  if (first.problem !== null) return { problems: [first.problem] };
  // 2. The register, generated from the declaration and that evidence: the
  //    same content `lisa controls register` writes.
  const register = await generate(root);
  if (register.problems !== null) return { problems: register.problems };
  const second = await write(root, CONTROL_REGISTER_PATH, register.text);
  if (second.problem !== null) return { problems: [second.problem] };
  // 3. The verdict, from that register and that evidence.
  const verdict = computeVerdict({
    catalogue: (dependencies.loadCatalogue ?? loadCriterionCatalogue)(),
    register: register.register,
    evidence,
    now,
  });
  const last = await write(root, VERDICT_PATH, serializeVerdict(verdict));
  return last.problem === null
    ? { problems: null, verdict }
    : { problems: [last.problem] };
}

/**
 * Write down what an attest run found, letting anything unexpected throw.
 * @param attestation - The run's results and when they were gathered
 * @param dependencies - Replaceable collaborators
 * @returns What was written, or one line per reason it was not
 */
async function recorded(
  attestation: AttestationToRecord,
  dependencies: RecordAttestationDependencies
): Promise<RecordedAttestation> {
  const { now, run } = attestation;
  const freshnessSeconds =
    attestation.freshnessSeconds ?? DEFAULT_FRESHNESS_SECONDS;
  const lifetime = lifetimeProblem(freshnessSeconds);
  if (lifetime !== null) return { problems: [lifetime] };
  const root = await resolveRepositoryRoot(attestation.named);
  if (root === null) {
    return { problems: [`${attestation.named} is not a folder.`] };
  }
  const before = await (dependencies.generate ?? generateControlRegister)(root);
  if (before.problems !== null) return { problems: before.problems };
  const gathered = await gatherEvidence({
    root,
    register: before.register,
    batches: [proofRunBatch(run), ...(attestation.batches ?? [])],
    stamp: {
      commit:
        attestation.commit ??
        (await (dependencies.readHead ?? readHeadCommit)(root)),
      freshnessSeconds,
    },
    now,
    loadReport: dependencies.loadReport ?? loadAuditReport,
  });
  if (gathered.problems !== null) return { problems: gathered.problems };
  const { evidence } = gathered;
  const written = await writeInOrder(root, evidence, now, dependencies);
  if (written.problems !== null) return { problems: written.problems };
  return {
    problems: null,
    lines: [
      recordedLine(evidence.records),
      ...gathered.notes,
      `Wrote ${CONTROL_REGISTER_PATH} again from the gates declaration and the evidence, then the verdict in ${VERDICT_PATH}.`,
      levelSummary(written.verdict),
    ],
    evidence,
    verdict: written.verdict,
  };
}

/**
 * Write down what an attest run found, in the one order that keeps the
 * three files in step.
 *
 * It never throws: a file that cannot be written, or anything else that goes
 * wrong, comes back as a problem, so the command can say what happened in
 * plain words.
 * @param attestation - The run's results and when they were gathered
 * @param dependencies - Replaceable collaborators
 * @returns What was written, or one line per reason it was not
 */
export async function recordAttestation(
  attestation: AttestationToRecord,
  dependencies: RecordAttestationDependencies = {}
): Promise<RecordedAttestation> {
  try {
    return await recorded(attestation, dependencies);
  } catch (error) {
    return {
      problems: [error instanceof Error ? error.message : String(error)],
    };
  }
}

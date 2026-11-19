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
 * ## What the evidence is bound to
 *
 * The evidence file also says what defined the checks when the proofs ran:
 * one digest, and the list of what it covers (`./checks-binding.ts`). The
 * run hands it over, taken in the copy the proofs ran in. A caller that
 * hands none over ran no proof in a copy, and the digest is then taken from
 * the repository itself. `lisa controls attest --check` takes it again later
 * and compares.
 *
 * A file that is not the same in the repository as it was in that copy
 * would make that check fail straight away, so it is said here, when the
 * results are written: which files, and what puts each right.
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
import {
  bindChecks,
  bindingDifferences,
  hostHookFiles,
} from "./checks-binding.js";
import { writeControlFile, type ControlFileWrite } from "./control-files.js";
import { EVIDENCE_PATH } from "./evidence.js";
import { serializeEvidence } from "./evidence-document.js";
import { gatherEvidence } from "./evidence-gather.js";
import {
  DEFAULT_FRESHNESS_SECONDS,
  type ChecksBinding,
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
   * How long each record written now may be relied on, in whole seconds:
   * {@link DEFAULT_FRESHNESS_SECONDS} when left out, and never more. A
   * caller can only make it shorter.
   */
  readonly freshnessSeconds?: number;
  /**
   * The commit the run's disposable copy was cloned from. Every record
   * written now names it, for a reader's information; nothing is decided by
   * it. Left out when nothing was cloned (a register with no entries), and
   * the records then name the commit the repository is at.
   */
  readonly commit?: string;
  /**
   * What defined the checks in the copy the proofs ran in. Every record
   * written now carries its digest. Left out when no proof ran in a copy,
   * and it is then taken from the repository itself.
   */
  readonly checks?: ChecksBinding;
}

/** What writing down needs from outside, each replaceable in a test. */
export interface RecordAttestationDependencies {
  /** Generates the register of a repository. */
  readonly generate?: (root: string) => Promise<ControlRegisterGeneration>;
  /** Reads the commit the repository is at. */
  readonly readHead?: (root: string) => Promise<string | null>;
  /**
   * Takes the digest of what defines the checks in the repository as it
   * is: over the paths a recorded binding covers when one is given, and
   * with the repository's own hook files looked for when none is.
   */
  readonly bindChecks?: (
    root: string,
    recorded?: ChecksBinding
  ) => Promise<ChecksBinding>;
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
      /**
       * What the operator must be told whatever the output mode, one line
       * each: results an earlier run recorded that were dropped, and files
       * that are not the same here as where the proofs ran.
       */
      readonly warnings: readonly string[];
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
    seconds <= DEFAULT_FRESHNESS_SECONDS
    ? null
    : `The freshness lifetime must be a whole number of seconds from 1 to ${DEFAULT_FRESHNESS_SECONDS} (thirty days, the longest a record is relied on); it was ${String(seconds)}.`;
}

/**
 * Take the digest of what defines the checks in a repository as it is.
 * @param root - Real path of the repository
 * @param recorded - A binding whose paths are read again; left out, the
 *   repository's own hook files are looked for instead
 * @returns The digest, and what it covers
 */
function boundHere(
  root: string,
  recorded?: ChecksBinding
): Promise<ChecksBinding> {
  return recorded === undefined
    ? bindChecks({ repository: root, hostHooks: hostHookFiles })
    : bindChecks({
        repository: root,
        also: recorded.covered.map(file => file.path),
      });
}

/**
 * Say which files that define the checks are not the same in the
 * repository as in the copy the proofs ran in.
 * @param recorded - What defined the checks where the proofs ran
 * @param here - The same paths as the repository holds them
 * @returns One line, or none when the two agree
 */
function notAsProved(
  recorded: ChecksBinding,
  here: ChecksBinding
): readonly string[] {
  const { changed, gone, added } = bindingDifferences(recorded, here);
  const files = [...changed, ...gone, ...added];
  return files.length === 0
    ? []
    : [
        `What defines the checks in this repository is not what the proofs ran against, so "lisa controls attest --check" will not pass yet: ${files.join(", ")}. The proofs ran in a copy of the last commit with the carriers freshly installed. Where the file is a hook script or the gate runner, run "lisa controls install-carriers" to bring this repository's copy up to date. Any other was changed since the last commit: commit it, or undo the change. Then run this again.`,
      ];
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
  const bind = dependencies.bindChecks ?? boundHere;
  const checks = attestation.checks ?? (await bind(root));
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
    checks,
    now,
    loadReport: dependencies.loadReport ?? loadAuditReport,
  });
  if (gathered.problems !== null) return { problems: gathered.problems };
  const { evidence } = gathered;
  const written = await writeInOrder(root, evidence, now, dependencies);
  if (written.problems !== null) return { problems: written.problems };
  return {
    problems: null,
    warnings: [
      ...gathered.warnings,
      ...notAsProved(checks, await bind(root, checks)),
    ],
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

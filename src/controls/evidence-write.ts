/**
 * Turning what the attest step found out into evidence records.
 *
 * Three kinds of thing become records, and each comes in through a plain
 * shape so that this module never reaches into the step that produced it:
 *
 * - the paired-proof runner's results, a `ProofRun`, through
 *   {@link proofRunBatch};
 * - any other step's results about register entries — a setting read from
 *   the hosting platform, a canary on a pull request — as an
 *   `EvidenceBatch` of `EvidenceResultInput` (`./pull-request-evidence.ts`
 *   builds the one for the pull-request moment);
 * - the audit's findings, through `./evidence-findings.ts`.
 *
 * ## One record per result per requirement
 *
 * A result is about a register entry; evidence is looked up by requirement.
 * So each result is written once for every requirement its entry serves,
 * and an entry that serves none gets no record: there is no requirement for
 * it to be evidence of.
 *
 * ## The latest run replaces, it does not add
 *
 * A batch speaks for every entry and every moment it names, so every earlier
 * record of those entries at those moments goes, whether or not the batch
 * has a result to put in its place. An entry whose proof could not be run
 * this time is left with no record, and its requirement reads `unknown`,
 * rather than with last month's pass. Earlier records are also dropped when
 * the register no longer holds their entry, or the entry no longer serves
 * their requirement. Records of audit findings are replaced as one set on
 * every run.
 *
 * ## What is kept from before was written by a run
 *
 * The file is on disk between runs, and anyone can type into it. So an
 * earlier record is kept only when a run could have written it: its moment
 * is one a run writes records for, and its entry is enforced at that moment.
 * A record that is kept is relied on for the default lifetime at most,
 * whatever the file says. Without both, a pair typed in at a moment no run
 * speaks for, with a year's lifetime, would outlive every real run.
 *
 * ## Where a secret could get in
 *
 * A record keeps the end of what a check printed, and a check can print
 * anything. {@link prepareEvidenceExcerpt} is the one place that text is
 * made ready for the file, and it takes credential-shaped values out before
 * it cuts. The rest of a record's captured text (the arguments the check
 * was started with, and the sentence and reason, which can quote why it
 * could not be started) has its values taken out as each record is made,
 * and again over every record that stands, old or new
 * (`./evidence-redact.ts`). Nothing is refused: a run keeps its result, and
 * a placeholder marks where a value was.
 * @module controls/evidence-write
 */
import {
  outputWithoutSecretValues,
  recordWithoutSecretValues,
} from "./evidence-redact.js";
import {
  DEFAULT_FRESHNESS_SECONDS,
  EVIDENCE_EXCERPT_LIMIT,
  evidenceRecordId,
  type EntryEvidenceResult,
  type EvidenceBatch,
  type EvidenceRecord,
  type EvidenceResultInput,
} from "./evidence-types.js";
import {
  PROOF_MOMENTS,
  type ProofHalf,
  type ProofHalfOutcome,
  type ProofHalfResult,
  type ProofRun,
} from "./proof-types.js";
import { PULL_REQUEST_MOMENT } from "./pull-request-executor.js";
import type {
  ControlRegister,
  ControlRegisterEntry,
} from "./register-types.js";

/**
 * The moments an attest run can write a record about a control for: the two
 * the paired-proof runner exercises, and the one the hosting platform
 * answers for. No step writes a record at any other moment, so a record that
 * names another one was not written by a run.
 */
export const EVIDENCE_MOMENTS: readonly string[] = [
  ...PROOF_MOMENTS,
  PULL_REQUEST_MOMENT,
];

/** What every record of one run carries beyond its own result. */
export interface EvidenceStamp {
  /**
   * The commit the run's results are about: the one its disposable copy
   * was made from, or the repository's HEAD when nothing was cloned; `null`
   * when the repository has none.
   */
  readonly commit: string | null;
  /** How long each record may be relied on, in whole seconds. */
  readonly freshnessSeconds: number;
}

/** Records, or one line per result that could not be written as one. */
export type EvidenceRecordsBuild =
  | { readonly problems: null; readonly records: readonly EvidenceRecord[] }
  | { readonly problems: readonly string[] };

/** What each half shows when its check gives each answer. */
const HALF_RESULTS: Readonly<
  Record<ProofHalf, Readonly<Record<ProofHalfOutcome, EntryEvidenceResult>>>
> = {
  violation: { rejected: "held", accepted: "failed", unknown: "unknown" },
  clean: { accepted: "held", rejected: "failed", unknown: "unknown" },
};

/**
 * Make what a check printed ready to be kept in the evidence file.
 *
 * This is the only place output text enters a record. Every value shaped
 * like a credential is taken out first, leaving a placeholder that says
 * what was there. Then it keeps the end of the text, cut at the start of a
 * line, up to {@link EVIDENCE_EXCERPT_LIMIT} characters. The values go
 * before the cut so that a cut can never leave half of one behind.
 * @param captured - What was kept of the check's output
 * @param alreadyTruncated - Whether that already leaves out earlier output
 * @returns The excerpt, and whether it leaves anything out
 */
export function prepareEvidenceExcerpt(
  captured: string,
  alreadyTruncated: boolean
): Pick<EvidenceRecord, "output_excerpt" | "output_truncated"> {
  const output = outputWithoutSecretValues(captured);
  if (output.length <= EVIDENCE_EXCERPT_LIMIT) {
    return { output_excerpt: output, output_truncated: alreadyTruncated };
  }
  const tail = output.slice(-EVIDENCE_EXCERPT_LIMIT);
  const firstBreak = tail.indexOf("\n");
  return {
    output_excerpt:
      firstBreak >= 0 && firstBreak < tail.length - 1
        ? tail.slice(firstBreak + 1)
        : tail,
    output_truncated: true,
  };
}

/**
 * One half of a paired proof, as a result the writer takes.
 *
 * Every step that plants a change reports its halves in the same shape, so
 * this is the one place a half's answer becomes `held`, `failed` or
 * `unknown`, whichever moment it was run at.
 * @param half - The half, as the step that ran it reports it
 * @returns The result
 */
export function proofHalfResult(half: ProofHalfResult): EvidenceResultInput {
  return {
    entry_id: half.entry_id,
    moment: half.moment,
    rung: "exercised",
    half: half.half,
    result: HALF_RESULTS[half.half][half.outcome],
    reason: half.reason,
    detail: half.detail,
    command: half.command,
    exit_status: half.exit_status,
    started_at: half.started_at,
    completed_at: half.completed_at,
    output_excerpt: half.output_excerpt,
    output_truncated: half.output_truncated,
  };
}

/**
 * Everything a paired-proof run found out, as one batch.
 *
 * The run speaks for every entry it lists at the moments the runner
 * exercises, including the entries it could not prove.
 *
 * A run whose pull-request moment was settled also carries the halves of
 * the canaries the hosting platform answered. Those are not the runner's:
 * the step that settled that moment hands them over in its own batch
 * (`./pull-request-evidence.ts`), so they are left out here and each half is
 * written from one place only.
 * @param run - The runner's results
 * @returns The batch
 */
export function proofRunBatch(run: ProofRun): EvidenceBatch {
  const moments: readonly string[] = PROOF_MOMENTS;
  return {
    entries: run.entries.map(entry => entry.entry_id),
    moments,
    results: run.entries.flatMap(entry =>
      entry.halves
        .filter(half => moments.includes(half.moment))
        .map(half => proofHalfResult(half))
    ),
  };
}

/**
 * Name a result in a problem line.
 * @param result - The result
 * @returns For example `the violation result for code-style@api at commit`
 */
function named(result: EvidenceResultInput): string {
  return `the ${result.half ?? result.rung} result for ${result.entry_id} at ${result.moment}`;
}

/**
 * Say why a result cannot be written as a record, when it cannot.
 * @param result - The result
 * @param entry - The register entry it names, when there is one
 * @param batch - The batch it came in
 * @returns The problem, or `null`
 */
function refusal(
  result: EvidenceResultInput,
  entry: ControlRegisterEntry | undefined,
  batch: EvidenceBatch
): string | null {
  if (entry === undefined) {
    return `There is ${named(result)}, and the control register holds no entry with that id.`;
  }
  if (
    !batch.entries.includes(result.entry_id) ||
    !batch.moments.includes(result.moment)
  ) {
    return `There is ${named(result)}, and the run it came from does not say it spoke for that entry at that moment.`;
  }
  if ((result.rung === "exercised") !== (result.half !== undefined)) {
    return `There is ${named(result)}: an exercised result names its half, and no other result does.`;
  }
  return null;
}

/**
 * The records one result becomes: one per requirement its entry serves.
 * @param result - The result
 * @param entry - The register entry it is about
 * @param stamp - The commit and the freshness lifetime of the run
 * @returns The records
 */
function recordsOf(
  result: EvidenceResultInput,
  entry: ControlRegisterEntry,
  stamp: EvidenceStamp
): readonly EvidenceRecord[] {
  const half = result.half === undefined ? {} : { half: result.half };
  return entry.criteria.map(criterion =>
    recordWithoutSecretValues({
      id: evidenceRecordId({
        entry_id: entry.id,
        moment: result.moment,
        rung: result.rung,
        criterion,
        ...half,
      }),
      criterion,
      entry_id: entry.id,
      scope: entry.scope,
      rung: result.rung,
      ...half,
      moment: result.moment,
      result: result.result,
      reason: result.reason,
      detail: result.detail,
      commit: stamp.commit,
      command: result.command === null ? null : [...result.command],
      exit_status: result.exit_status,
      started_at: result.started_at,
      completed_at: result.completed_at,
      freshness_seconds: stamp.freshnessSeconds,
      ...prepareEvidenceExcerpt(result.output_excerpt, result.output_truncated),
    })
  );
}

/**
 * Turn the results of some runs into evidence records.
 * @param batches - What each run found out
 * @param register - The control register the results are about
 * @param stamp - The commit and the freshness lifetime of the run
 * @returns The records, or one line per result that cannot be written
 */
export function batchRecords(
  batches: readonly EvidenceBatch[],
  register: ControlRegister,
  stamp: EvidenceStamp
): EvidenceRecordsBuild {
  const built = batches.flatMap(batch =>
    batch.results.map(result => {
      const entry = register.entries.find(each => each.id === result.entry_id);
      const problem = refusal(result, entry, batch);
      return problem === null && entry !== undefined
        ? { problem: null, records: recordsOf(result, entry, stamp) }
        : { problem: problem ?? "", records: [] };
    })
  );
  const problems = built.flatMap(each =>
    each.problem === null ? [] : [each.problem]
  );
  return problems.length > 0
    ? { problems }
    : { problems: null, records: built.flatMap(each => each.records) };
}

/**
 * Tell whether an earlier record still stands after this run.
 *
 * A record is kept only when a run could have written it: it names a moment
 * a run writes records for ({@link EVIDENCE_MOMENTS}), and its entry is
 * enforced at that moment. Anything else was put in the file by hand. Kept
 * without that test, a pair typed in at a moment no run ever speaks for
 * would survive every later run and be read as a proof.
 * @param record - A record the evidence file held before this run
 * @param register - The control register now
 * @param batches - What this run spoke for
 * @returns Whether it is kept
 */
function stillStands(
  record: EvidenceRecord,
  register: ControlRegister,
  batches: readonly EvidenceBatch[]
): boolean {
  const { entry_id: entryId, moment } = record;
  // Records of audit findings are replaced as one set on every run.
  if (entryId === null || moment === null) return false;
  const entry = register.entries.find(each => each.id === entryId);
  return (
    entry !== undefined &&
    entry.criteria.includes(record.criterion) &&
    EVIDENCE_MOMENTS.includes(moment) &&
    entry.enforcement_points.some(point => point.moment === moment) &&
    !batches.some(
      batch => batch.entries.includes(entryId) && batch.moments.includes(moment)
    )
  );
}

/**
 * Hold an earlier record to the default lifetime.
 *
 * A run stamps its own records with the lifetime it was given. A record it
 * only keeps was stamped by something else, and what the file says about its
 * lifetime is taken as an upper bound and never as more than the default: a
 * record kept from an earlier run is not relied on for longer than one this
 * run could have written.
 * @param record - A record that is kept
 * @returns The record, relied on for the default lifetime at most
 */
function withinDefaultLifetime(record: EvidenceRecord): EvidenceRecord {
  return record.freshness_seconds > DEFAULT_FRESHNESS_SECONDS
    ? { ...record, freshness_seconds: DEFAULT_FRESHNESS_SECONDS }
    : record;
}

/**
 * The records the evidence file holds after a run.
 * @param parts - What goes into it
 * @param parts.earlier - The records the file held before
 * @param parts.register - The control register now
 * @param parts.batches - What this run spoke for
 * @param parts.records - The records this run wrote
 * @returns Every record that stands, in no particular order, each with any
 *   credential-shaped value taken out of its captured text
 */
export function mergedEvidence(parts: {
  readonly earlier: readonly EvidenceRecord[];
  readonly register: ControlRegister;
  readonly batches: readonly EvidenceBatch[];
  readonly records: readonly EvidenceRecord[];
}): readonly EvidenceRecord[] {
  const written = new Set(parts.records.map(record => record.id));
  return [
    ...parts.earlier
      .filter(
        record =>
          !written.has(record.id) &&
          stillStands(record, parts.register, parts.batches)
      )
      .map(record => withinDefaultLifetime(record)),
    ...parts.records,
  ].map(record => recordWithoutSecretValues(record));
}

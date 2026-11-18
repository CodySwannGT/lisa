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
 *   `EvidenceBatch` of `EvidenceResultInput`;
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
 * ## Where a secret could get in
 *
 * A record keeps the end of what a check printed, and a check can print
 * anything. {@link prepareEvidenceExcerpt} is the one place that text is
 * made ready for the file; whatever takes secret values out belongs there.
 * @module controls/evidence-write
 */
import {
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
import type {
  ControlRegister,
  ControlRegisterEntry,
} from "./register-types.js";

/** What every record of one run carries beyond its own result. */
export interface EvidenceStamp {
  /** The repository's HEAD commit, or `null` when it has none. */
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
 * This is the only place output text enters a record. It keeps the end of
 * the text, cut at the start of a line, up to {@link EVIDENCE_EXCERPT_LIMIT}
 * characters. It does not look for secret values: the step that does must
 * do it here, before the cut, so nothing reaches the file unexamined.
 * @param output - What was kept of the check's output
 * @param alreadyTruncated - Whether that already leaves out earlier output
 * @returns The excerpt, and whether it leaves anything out
 */
export function prepareEvidenceExcerpt(
  output: string,
  alreadyTruncated: boolean
): Pick<EvidenceRecord, "output_excerpt" | "output_truncated"> {
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
 * @param half - The half, as the runner reports it
 * @returns The result
 */
function halfResult(half: ProofHalfResult): EvidenceResultInput {
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
 * @param run - The runner's results
 * @returns The batch
 */
export function proofRunBatch(run: ProofRun): EvidenceBatch {
  return {
    entries: run.entries.map(entry => entry.entry_id),
    moments: PROOF_MOMENTS,
    results: run.entries.flatMap(entry =>
      entry.halves.map(half => halfResult(half))
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
  return entry.criteria.map(criterion => ({
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
  }));
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
 * @param record - A record an earlier run wrote
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
    !batches.some(
      batch => batch.entries.includes(entryId) && batch.moments.includes(moment)
    )
  );
}

/**
 * The records the evidence file holds after a run.
 * @param parts - What goes into it
 * @param parts.earlier - The records the file held before
 * @param parts.register - The control register now
 * @param parts.batches - What this run spoke for
 * @param parts.records - The records this run wrote
 * @returns Every record that stands, in no particular order
 */
export function mergedEvidence(parts: {
  readonly earlier: readonly EvidenceRecord[];
  readonly register: ControlRegister;
  readonly batches: readonly EvidenceBatch[];
  readonly records: readonly EvidenceRecord[];
}): readonly EvidenceRecord[] {
  const written = new Set(parts.records.map(record => record.id));
  return [
    ...parts.earlier.filter(
      record =>
        !written.has(record.id) &&
        stillStands(record, parts.register, parts.batches)
    ),
    ...parts.records,
  ];
}

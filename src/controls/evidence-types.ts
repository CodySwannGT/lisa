/**
 * The shape of the evidence file the attest step writes.
 *
 * Evidence is what the verdict is computed from, so every record is plain
 * data that says one thing about one requirement: which control or which
 * audit finding it is about, how strongly it is known, what it showed, when,
 * and for how long it may be relied on. Nothing in a record is a judgement
 * about the requirement as a whole; that is the verdict's to make, in
 * `./verdict.ts`.
 *
 * ## One record per result per requirement
 *
 * A register entry can serve several requirements, and everything that reads
 * evidence looks a record up by its `criterion`. So a result about an entry
 * is written once for each requirement the entry serves. A paired proof of
 * an entry that serves two requirements is four records: two halves, twice.
 *
 * ## The three rungs
 *
 * `rung` is how strongly a record is known, weakest first:
 *
 * - `asserted` — someone or something said so and nothing checked it: a
 *   person's answer to the audit's question, or an audit finding nothing
 *   confirmed.
 * - `observed` — something was looked at where it is and nothing was
 *   planted: a setting read from the system that holds it, or a file and
 *   line the audit pointed at and the attest step found there.
 * - `exercised` — a change was planted and the control's answer recorded. An
 *   exercised record is one half of a pair, so it always carries `half`; a
 *   record at any other rung never does.
 *
 * ## The identifier
 *
 * See {@link evidenceRecordId}. It is made of the names of what the record
 * is about and nothing else, so the same proof of the same control writes
 * the same identifier on every run, and a later run replaces the record
 * instead of adding one beside it.
 *
 * ## What the records are bound to
 *
 * A verdict is about the checks as they were proved. So the file says what
 * defined them: `checks` holds one digest, taken over the `gates` block of
 * the declaration, the proofs' patch files, the carrier and hook files and
 * the gate runner, and lists each thing the digest covers with its own
 * digest (`./checks-binding.ts`). Every record carries that digest as
 * `checks_digest`, the digest it was recorded under. A record that carries
 * another one was not written by the run that wrote the file, and counts
 * for nothing.
 *
 * `commit` on a record is information: the commit the run's copy was cloned
 * from. Nothing is decided by it. A squash or rebase merge replaces that
 * commit and a shallow clone never has it, and neither changes what defines
 * the checks.
 *
 * The published contract is the JSON Schema at
 * {@link EVIDENCE_SCHEMA_PACKAGE_PATH}; `tests/unit/controls/
 * evidence-schema.test.ts` holds this file and that one to each other.
 * @module controls/evidence-types
 */
import type { ProofHalf } from "./proof-halves.js";

/** Where the evidence file's JSON Schema is, from the Lisa package root. */
export const EVIDENCE_SCHEMA_PACKAGE_PATH =
  "schemas/control-evidence.schema.json";

/** The format version the attest step writes. */
export const EVIDENCE_SCHEMA_VERSION = 1;

/** How strongly a record is known, weakest first. */
export const EVIDENCE_RUNGS = ["asserted", "observed", "exercised"] as const;

/** One of the three rungs. */
export type EvidenceRung = (typeof EVIDENCE_RUNGS)[number];

/**
 * What a record shows about its requirement.
 *
 * - `held` — what was looked at did what the requirement asks: the violating
 *   change was turned away as declared, the clean change was let through,
 *   the platform requires the check, the audit found the thing written down.
 * - `failed` — it did not: the violating change was let through, the clean
 *   change was turned away, the audit found nothing that does this.
 * - `unknown` — there is no answer that can be relied on.
 * - `not-applicable` — the requirement does not apply here, and `detail`
 *   states the fact that makes it so. Only a record of an audit finding can
 *   say this.
 */
export const EVIDENCE_RESULTS = [
  "held",
  "failed",
  "unknown",
  "not-applicable",
] as const;

/** One of the four results. */
export type EvidenceResult = (typeof EVIDENCE_RESULTS)[number];

/** The results a record about a register entry can carry. */
export type EntryEvidenceResult = Exclude<EvidenceResult, "not-applicable">;

/**
 * How long a record may be relied on: 30 days, and never longer.
 *
 * The specification asks for a lifetime that is finite and no longer than
 * twelve months, and reasonable for the kind of control. A check wired into a
 * repository changes whenever its configuration does, so a month is long
 * enough that an attest run on a monthly schedule keeps a verdict current,
 * and short enough that a control nobody has run since last quarter stops
 * counting. The gates declaration cannot change it. The attest step's caller
 * can make it shorter, through `freshnessSeconds`, and nothing makes it
 * longer: a record that claims more is relied on for this long
 * (`evidenceExpiry` in `./evidence.ts`), so a lifetime typed into the file
 * buys nothing.
 */
export const DEFAULT_FRESHNESS_SECONDS = 30 * 24 * 60 * 60;

/**
 * The longest lifetime a record's `freshness_seconds` may state and still be
 * a well-formed record: twelve months, the specification's own bound. It is
 * a bound on the format. How long a record is relied on is
 * {@link DEFAULT_FRESHNESS_SECONDS} at most.
 */
export const MAX_FRESHNESS_SECONDS = 365 * 24 * 60 * 60;

/** The most of a check's output a record keeps, in characters. */
export const EVIDENCE_EXCERPT_LIMIT = 1000;

/** The kind of a requirement answered by a record that exists. */
export const ARTIFACT_KIND = "artifact";

/** The kind of a requirement only a person can vouch for. */
export const HUMAN_ATTESTED_KIND = "human-attested";

/**
 * Why a record written from an audit finding shows what it does, where the
 * finding's own state does not say it all.
 */
export const FINDING_REASONS = {
  /** `held`, observed: every line the audit pointed at is there. */
  located: "artifact-located",
  /** `unknown`: the audit pointed nowhere, or at a line that is not there. */
  notFound: "artifact-not-found",
  /** `held`, asserted: a person's answer is on record. */
  attested: "person-attested",
  /** `unknown`: no person's answer is on record. */
  noAttestation: "no-attestation",
} as const;

/** What a record's id uses between its parts. */
const EVIDENCE_ID_SEPARATOR = "/";

/** What starts the id of a record written from an audit finding. */
const FINDING_RECORD_PREFIX = "audit-finding";

/** One thing the attest step recorded about one requirement. */
export interface EvidenceRecord {
  /** See {@link evidenceRecordId}. Unique in the file. */
  readonly id: string;
  /** The requirement the record is evidence for. */
  readonly criterion: string;
  /**
   * The register entry the record is about, or `null` when it was written
   * from an audit finding and no entry is involved.
   */
  readonly entry_id: string | null;
  /** The folder it is about; `.` is the whole repository. */
  readonly scope: string;
  readonly rung: EvidenceRung;
  /** Which half of a paired proof. Present exactly when `rung` is `exercised`. */
  readonly half?: ProofHalf;
  /** The moment it speaks for; `null` on a record of an audit finding. */
  readonly moment: string | null;
  readonly result: EvidenceResult;
  /** Why it shows that: the proof's reason, or the audit finding's state. */
  readonly reason: string;
  /** The same as a sentence; on a `not-applicable` record, the fact. */
  readonly detail: string;
  /**
   * The commit the run's disposable copy was cloned from. A record written
   * when nothing was cloned names the commit the repository was at; `null`
   * when it has none. It is information for a reader: nothing is decided by
   * it, and it need not exist in the clone the file is read in.
   */
  readonly commit: string | null;
  /**
   * The digest of what defined the checks when the record was made: the
   * `digest` of the file's `checks` at the run that wrote it.
   */
  readonly checks_digest: string;
  /** What was started, one item per argument, or `null` when nothing was. */
  readonly command: readonly string[] | null;
  /** Its exit status, or `null` when nothing ran to an end. */
  readonly exit_status: number | null;
  /** When it began, in UTC. */
  readonly started_at: string;
  /** When its answer was in, in UTC. Freshness is counted from here. */
  readonly completed_at: string;
  /** How long after `completed_at` it may be relied on, in whole seconds. */
  readonly freshness_seconds: number;
  /** The end of what the check printed; empty when nothing ran. */
  readonly output_excerpt: string;
  /** Whether the excerpt leaves out earlier output. */
  readonly output_truncated: boolean;
}

/** One thing that defines the checks, and the digest of its content. */
export interface CoveredCheckFile {
  /**
   * The file, from the repository root. For `.lisa.config.json` the digest
   * is of its `gates` block in canonical form, not of the whole file.
   */
  readonly path: string;
  /** The SHA-256 digest, in lower-case hexadecimal. */
  readonly sha256: string;
}

/** What defined the checks when a run recorded its results. */
export interface ChecksBinding {
  /**
   * The SHA-256 digest of `covered` in canonical form, in lower-case
   * hexadecimal.
   */
  readonly digest: string;
  /** Everything the digest covers, ordered by `path`. */
  readonly covered: readonly CoveredCheckFile[];
}

/** The evidence file. */
export interface EvidenceDocument {
  readonly schema_version: typeof EVIDENCE_SCHEMA_VERSION;
  /** What defined the checks at the run that wrote the file. */
  readonly checks: ChecksBinding;
  /** Every record, ordered by `id`. */
  readonly records: readonly EvidenceRecord[];
}

/**
 * One result about one register entry at one moment, as the step that
 * produced it hands it to the evidence writer.
 *
 * This is the whole contract between a step that judges controls and the
 * writer: the paired-proof runner's halves are turned into it, and a step
 * that judges the pull-request moment produces it directly. The writer adds
 * everything else a record carries — the requirement, the folder, the
 * commit, the digest of what defined the checks and the freshness lifetime
 * — from the register and the run.
 */
export interface EvidenceResultInput {
  /** The register entry the result is about. */
  readonly entry_id: string;
  /** The moment it speaks for: `commit`, `push`, `pull-request`. */
  readonly moment: string;
  /** `observed` when nothing was planted, `exercised` when a change was. */
  readonly rung: Exclude<EvidenceRung, "asserted">;
  /** Which half. Required when `rung` is `exercised`, refused otherwise. */
  readonly half?: ProofHalf;
  readonly result: EntryEvidenceResult;
  /** A short, fixed word for why, for example `rejected-as-declared`. */
  readonly reason: string;
  /** The same as a sentence for the operator. */
  readonly detail: string;
  /** What was started, or `null` when nothing was. */
  readonly command: readonly string[] | null;
  /** Its exit status, or `null` when nothing ran to an end. */
  readonly exit_status: number | null;
  /** When it began: canonical UTC, `YYYY-MM-DDTHH:mm:ss.sssZ`. */
  readonly started_at: string;
  /** When its answer was in: canonical UTC. */
  readonly completed_at: string;
  /** What the check printed, or as much of the end of it as was kept. */
  readonly output_excerpt: string;
  /** Whether that already leaves out earlier output. */
  readonly output_truncated: boolean;
}

/**
 * Everything one step found out in one run, and what it replaces.
 *
 * A run speaks for every entry it names at every moment it names, whether or
 * not it has a result for each: an entry whose proof could not be run this
 * time has no result, and the records an earlier run wrote for it are removed
 * all the same. Evidence says what the latest run showed, never what an
 * earlier one did.
 */
export interface EvidenceBatch {
  /** The register entries the run spoke for. */
  readonly entries: readonly string[];
  /** The moments the run spoke for. */
  readonly moments: readonly string[];
  /** What it found, in any order. */
  readonly results: readonly EvidenceResultInput[];
}

/**
 * Tell whether one rung is at least as strong as another.
 * @param rung - The rung evidence has
 * @param minimum - The rung a requirement needs
 * @returns Whether the evidence is strong enough
 */
export function rungAtLeast(
  rung: EvidenceRung,
  minimum: EvidenceRung
): boolean {
  return EVIDENCE_RUNGS.indexOf(rung) >= EVIDENCE_RUNGS.indexOf(minimum);
}

/**
 * The identifier of a record about a register entry.
 *
 * `<entry id>/<moment>/<half or rung>/<criterion>`: for example
 * `code-style@api/commit/violation/SI7` for one half of a paired proof, and
 * `code-style@api/pull-request/observed/SI7` for a setting read from the
 * hosting platform. The last three parts never contain the separator, so two
 * different records cannot share an identifier. No time and no counter goes
 * into it.
 * @param parts - What the record is about
 * @param parts.entry_id - The register entry
 * @param parts.moment - The moment the record speaks for
 * @param parts.rung - How strongly it is known
 * @param parts.half - Which half, on an exercised record
 * @param parts.criterion - The requirement
 * @returns The identifier
 */
export function evidenceRecordId(parts: {
  readonly entry_id: string;
  readonly moment: string;
  readonly rung: EvidenceRung;
  readonly half?: ProofHalf;
  readonly criterion: string;
}): string {
  return [
    parts.entry_id,
    parts.moment,
    parts.half ?? parts.rung,
    parts.criterion,
  ].join(EVIDENCE_ID_SEPARATOR);
}

/**
 * The identifier of a record written from an audit finding:
 * `audit-finding/<criterion>@<scope>`, for example `audit-finding/AC1.4@.`.
 * @param criterion - The requirement
 * @param scope - The folder the finding is about
 * @returns The identifier
 */
export function findingRecordId(criterion: string, scope: string): string {
  return `${FINDING_RECORD_PREFIX}${EVIDENCE_ID_SEPARATOR}${criterion}@${scope}`;
}

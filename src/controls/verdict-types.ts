/**
 * The shape of the verdict file.
 *
 * The verdict is what an operator shows to someone else: for every Level 1
 * requirement one of four words, and one overall result. It is computed, by
 * code that asks no model anything, from two committed files — the control
 * register and the evidence file — and it carries a digest of both, so anyone
 * can compute it again and see whether the file still says what its inputs
 * do. `lisa controls attest --check` is that recomputation.
 *
 * Nothing in the file depends on when it was written. The two times it
 * carries are read from the evidence, so the same register and the same
 * evidence give the same bytes for as long as no record's lifetime runs out.
 *
 * The published contract is the JSON Schema at
 * {@link VERDICT_SCHEMA_PACKAGE_PATH}.
 * @module controls/verdict-types
 */
import type { EvidenceRung } from "./evidence-types.js";

/** Where the verdict is written, from the repository root. */
export const VERDICT_PATH = ".lisa/controls/verdict.json";

/** Where the verdict's JSON Schema is, from the Lisa package root. */
export const VERDICT_SCHEMA_PACKAGE_PATH =
  "schemas/control-verdict.schema.json";

/** The format version the attest step writes. */
export const VERDICT_SCHEMA_VERSION = 1;

/** The digest algorithm, as the file names it. */
export const VERDICT_DIGEST_ALGORITHM = "sha256";

/** The word for a requirement that does not apply, and for why. */
export const NOT_APPLICABLE = "not-applicable";

/**
 * What a requirement can come out as, worst first: a requirement judged on
 * several controls or folders takes the first of these any of them gives.
 */
export const CRITERION_VERDICTS = [
  "non-conforming",
  "unknown",
  "conforming",
  NOT_APPLICABLE,
] as const;

/** One of the four words. */
export type CriterionVerdictWord = (typeof CRITERION_VERDICTS)[number];

/** What the Level 1 result can be. Unknown is never conforming. */
export const LEVEL_RESULTS = ["conforming", "non-conforming"] as const;

/** One of the two results. */
type LevelResult = (typeof LEVEL_RESULTS)[number];

/** Why a requirement came out as it did. */
export const VERDICT_REASONS = [
  /** `conforming`: every control that serves it held, at a rung it accepts. */
  "control-proved",
  /**
   * `conforming`: the audit pointed at the record and the attest step found
   * it there. A located file, not a proof.
   */
  "artifact-located",
  /** `conforming`: a person's answer to the audit's question is on record. */
  "person-attested",
  /** `not-applicable`: the audit gave the fact that makes it so. */
  NOT_APPLICABLE,
  /** `non-conforming`: a control that serves it did not work. */
  "control-failed",
  /** `non-conforming`: the audit found nothing that does it. */
  "nothing-found",
  /** `unknown`: nothing is on record about it. */
  "no-evidence",
  /** `unknown`: a record it rests on is past its freshness lifetime. */
  "stale-evidence",
  /** `unknown`: a record it rests on is dated later than the current time. */
  "evidence-dated-later",
  /** `unknown`: a control's proof gave no pair of answers to rely on. */
  "proof-incomplete",
  /** `unknown`: the evidence held, at a weaker rung than it needs. */
  "rung-too-low",
  /** `unknown`: the audit could not establish it. */
  "audit-unknown",
  /** `unknown`: the record is not where the audit pointed. */
  "artifact-not-found",
  /** `unknown`: only a person can vouch for it, and nobody has. */
  "no-attestation",
] as const;

/** One of the reasons. */
export type VerdictReason = (typeof VERDICT_REASONS)[number];

/** One requirement's verdict. */
export interface CriterionVerdict {
  /** The requirement's id. */
  readonly criterion: string;
  readonly verdict: CriterionVerdictWord;
  readonly reason: VerdictReason;
  /** The same as a sentence for the operator. */
  readonly detail: string;
  /** What sort of thing answers it, from the catalogue. */
  readonly kind: string;
  /** The weakest evidence it accepts, from the catalogue. */
  readonly minimum_rung: EvidenceRung;
  /**
   * The weakest rung a `conforming` verdict rests on; `null` on any other
   * verdict.
   */
  readonly rung: EvidenceRung | null;
  /** The register entries that serve it, in register order. */
  readonly entries: readonly string[];
  /** The evidence records it was read from, ordered by id. */
  readonly evidence: readonly string[];
  /** The fact that makes it `not-applicable`; `null` on any other verdict. */
  readonly fact: string | null;
}

/** Which requirements a verdict was computed against. */
interface VerdictRequirements {
  /** The specification the catalogue was taken from. */
  readonly specification: string;
  readonly specification_version: string;
  /** The conformance level the verdict is for. */
  readonly level: number;
  /** The digest of the catalogue itself. */
  readonly sha256: string;
}

/** What binds a verdict to the files it was computed from. */
export interface VerdictDigest {
  readonly algorithm: typeof VERDICT_DIGEST_ALGORITHM;
  /** The digest of the control register alone. */
  readonly register: string;
  /** The digest of the evidence file alone. */
  readonly evidence: string;
  /** The digest of the two together. */
  readonly value: string;
}

/** How many requirements came out as each word. */
export type VerdictCounts = Readonly<Record<CriterionVerdictWord, number>>;

/** The verdict file. */
export interface Verdict {
  readonly schema_version: typeof VERDICT_SCHEMA_VERSION;
  readonly requirements: VerdictRequirements;
  /** Conforming only when every requirement is conforming or not applicable. */
  readonly result: LevelResult;
  /** The requirements that prevent a conforming result, in catalogue order. */
  readonly prevented_by: readonly string[];
  readonly counts: VerdictCounts;
  /** One verdict per in-scope requirement, in catalogue order. */
  readonly criteria: readonly CriterionVerdict[];
  /** When the newest evidence record was completed, or `null` with none. */
  readonly evidence_as_of: string | null;
  /**
   * The first instant a record this verdict rests on stops being current, or
   * `null` when it rests on none. From then on the verdict is out of date.
   */
  readonly current_until: string | null;
  readonly digest: VerdictDigest;
}

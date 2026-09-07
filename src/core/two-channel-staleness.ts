/**
 * The staleness dimension: can a two-channel coupling tell an OLD artifact
 * from a current one (CodySwannGT/lisa#3687)?
 *
 * `core/two-channel-delivery` answers whether the artifact ARRIVES. Absence is
 * the benign half of the defect — an absent artifact makes a step skip or fail,
 * and neither outcome is a wrong answer. The harmful half is present-and-old: a
 * gate posting a red required check derived from superseded logic, which every
 * reader believes. CodySwannGT/lisa#3477 measured that on one coupling, where
 * the only age probe was a single hardcoded capability floor and could not
 * answer "how old".
 *
 * So this is a SECOND dimension hung off the same entry rather than an extra
 * member of the delivery verdict. A coupling can be apply-lagged and carry a
 * version handshake; it can be package-backed and carry none.
 *
 * ## Derived, never declared
 *
 * The detection is read off the tree on every run. What a person is allowed to
 * record by hand is the DECISION — whether closing the gap here is worth it —
 * and even that is checked in both directions against what was measured. A
 * handshake nobody can find is refused; so is an exemption on a coupling that
 * already has one.
 *
 * ## The one thing this may never mean
 *
 * Silence. A coupling whose delivered artifact cannot be read at all is
 * `unchecked`, said out loud, rather than defaulted to current. "There was no
 * artifact to ask" and "the artifact carries no version tokens" produce the
 * same empty token list and are not the same fact.
 *
 * Structural inputs rather than the coupling types themselves, so this module
 * imports nothing from `core/two-channel-delivery` and the two can be read in
 * either order.
 * @module core/two-channel-staleness
 */
/** Every staleness detection value, named once so no two mentions can drift. */
const VERSION_HANDSHAKE = "version-handshake";
const CAPABILITY_PROBE = "capability-probe";
const EXISTENCE_ONLY = "existence-only";
const NO_PROBE = "no-probe";
const UNCHECKED = "unchecked";

/** Every staleness decision value, named once for the same reason. */
const DECISION_HANDSHAKE = "handshake";
const DECISION_NOT_NEEDED = "not-needed";
const DECISION_WARRANTED = "warranted";

/** How a workflow asks an artifact how old it is. */
const VERSION_REQUEST = "contract-version";

/**
 * How a delivered artifact declares the contract version it speaks.
 *
 * A literal rather than a pattern. Both existing handshakes spell it the same
 * way — `NIGHTLY_E2E_CONTRACT_VERSION`, `WORK_ITEM_CONTRACT_VERSION` — and a
 * looser matcher would let `expected_workflow_contract_major`, which is the
 * FAST channel's own handshake about the workflow body rather than the
 * artifact it reads, answer a question it has nothing to do with.
 */
const VERSION_CONSTANT = "_CONTRACT_VERSION";

/** Every staleness-probe token, named once so no two mentions can drift. */
const ARTIFACT_DECLARES = "artifact-declares-version";
const ARTIFACT_ANSWERS = "artifact-answers-version";
const STEP_REQUESTS = "step-requests-version";
const WORKFLOW_REQUESTS = "workflow-requests-version";

/**
 * Every staleness-probe token this scan can see, in report order.
 *
 * The same discipline the handling signals are held to: each name means those
 * characters were found where the name says to look, and nothing more. Two of
 * them are read off the DELIVERED ARTIFACT and are exact for this coupling's
 * path; two are read off the workflow and say which SCOPE they came from,
 * because the scopes are not equally tight and pretending otherwise is how a
 * derived field starts asserting.
 */
export const STALENESS_SIGNALS = [
  /** The delivered file declares a `*_CONTRACT_VERSION` constant. Per-path. */
  ARTIFACT_DECLARES,
  /** The delivered file's text carries the `contract-version` request. Per-path. */
  ARTIFACT_ANSWERS,
  /** The step that reads this path asks something for a `contract-version`. */
  STEP_REQUESTS,
  /** Some step of this workflow does — the read may arrive via an input default. */
  WORKFLOW_REQUESTS,
] as const;

/** One staleness-probe token name. */
export type StalenessSignal = (typeof STALENESS_SIGNALS)[number];

/**
 * What this coupling can tell about the AGE of the artifact it reads.
 *
 * Derived from the signals above and from `guarded`, never declared. The
 * ordering is deliberate: each member says strictly less than the one before
 * it, and the last says the question could not be answered at all.
 */
export const STALENESS_DETECTIONS = [
  /** The artifact answers a version and the workflow asks for one. */
  VERSION_HANDSHAKE,
  /**
   * The step asks the artifact for a subcommand the artifact does not answer.
   *
   * That is #3477's defect exactly: age inferred from whether one call
   * succeeds, which detects staleness at one floor and is blind above it.
   */
  CAPABILITY_PROBE,
  /** An existence test and no version probe — sees absence, never age. */
  EXISTENCE_ONLY,
  /** Neither. Nothing about this read bears on absence or on age. */
  NO_PROBE,
  /**
   * No delivered artifact could be read, so the artifact half is UNKNOWN.
   *
   * Not "current" and not "no probe". Lisa ships nothing at this path, so
   * whether a consumer's copy could answer a version is undecidable from this
   * tree — said out loud, because silence reading as success is the family of
   * defect this whole module exists to stop.
   */
  UNCHECKED,
] as const;

/** What this coupling can tell about the AGE of the artifact it reads. */
export type StalenessDetection = (typeof STALENESS_DETECTIONS)[number];

/**
 * The hand-authored half: whether the staleness gap here is worth closing.
 *
 * This is the field a new coupling cannot be added without. The detection is
 * derived and therefore free; the decision costs somebody a sentence, which is
 * the whole point — a sweep decays the moment entry 24 appears, a required
 * decision does not.
 */
export const STALENESS_DECISIONS = [
  /** It already has a handshake. Only valid where the tree shows one. */
  DECISION_HANDSHAKE,
  /** Reasoned exemption: closing this gap is cost without cover. */
  DECISION_NOT_NEEDED,
  /** Worth closing, and not closed yet. Counted as an open obligation. */
  DECISION_WARRANTED,
] as const;

/** The hand-authored half: whether the staleness gap here is worth closing. */
export type StalenessDecision = (typeof STALENESS_DECISIONS)[number];

/** One recorded decision about one coupling's staleness half. */
export interface StalenessRecord {
  /** What was decided. */
  readonly decision: StalenessDecision;
  /** Why. Required for every decision that is not `handshake`. */
  readonly reason?: string;
}

/** What the scan found about one coupling, as the staleness rules see it. */
export interface StalenessInput {
  /** Literal staleness-probe tokens found for this coupling. */
  readonly staleness: readonly StalenessSignal[];
  /** Whether any delivered artifact was available at this path to inspect. */
  readonly artifactRead: boolean;
  /** Whether the read sits behind a file-existence test. */
  readonly guarded: boolean;
}

/** One classified coupling and the decision recorded about it. */
export interface DecidedCoupling {
  /** Stable `<workflow>::<path>` identity. */
  readonly key: string;
  /** Workflow file name. */
  readonly workflow: string;
  /** The caller-tree path. */
  readonly path: string;
  /** What the tree says this coupling can detect about age. */
  readonly detection: StalenessDetection;
  /** What was recorded by hand, or null when nobody has. */
  readonly decision: StalenessDecision | null;
  /** The reason recorded beside that decision, or null. */
  readonly reason: string | null;
}

/**
 * The staleness tokens one delivered artifact's own text carries.
 *
 * Pure: the caller reads the file, this decides what the bytes say. Lives
 * beside the vocabulary so both halves of it are derived in one place and
 * cannot drift apart.
 * @param text - The delivered artifact's text
 * @returns Signal names in the vocabulary's declared order
 */
export function artifactStalenessSignals(
  text: string
): readonly StalenessSignal[] {
  const found: readonly StalenessSignal[] = [
    ...(text.includes(VERSION_CONSTANT) ? ([ARTIFACT_DECLARES] as const) : []),
    ...(text.includes(VERSION_REQUEST) ? ([ARTIFACT_ANSWERS] as const) : []),
  ];
  return STALENESS_SIGNALS.filter(name => found.includes(name));
}

/**
 * Whether a chunk of workflow text asks something for its contract version.
 * @param text - Step or workflow text, already stripped of full-line comments
 * @returns Whether the request token appears
 */
export function requestsVersion(text: string): boolean {
  return text.includes(VERSION_REQUEST);
}
/**
 * What this coupling can tell about the artifact's AGE.
 *
 * Derived, in the order the members are declared, so each answer says strictly
 * less than the one above it:
 *
 *   - no artifact to read at all — `unchecked`, the honest non-answer;
 *   - the artifact answers a version AND something asks for one — a handshake;
 *   - the STEP asks for a version the artifact cannot answer — a capability
 *     probe, which is #3477's defect: one floor, blind above it;
 *   - an existence test and no version probe — absence, never age;
 *   - neither — nothing here bears on either question.
 *
 * The handshake arm accepts the workflow-scoped signal as well as the
 * step-scoped one, and that is a deliberate, stated looseness. A read can
 * reach the step through a `workflow_call` input default — `guard_script`
 * defaults to `scripts/check-nightly-e2e-health.mjs`, and the step that
 * compares versions names `$GUARD`, never the path — so a step-scoped-only
 * rule would refute a handshake that exists. Over-crediting here is bounded by
 * the ARTIFACT half, which is exact for this path: a workflow that asks for a
 * version cannot manufacture a handshake for a file that answers none.
 * @param input - What the scan found for one coupling
 * @returns What it can detect about age
 */
export function detectStaleness(input: StalenessInput): StalenessDetection {
  if (!input.artifactRead) return UNCHECKED;
  const has = (signal: StalenessSignal): boolean =>
    input.staleness.includes(signal);
  const asked = has(STEP_REQUESTS) || has(WORKFLOW_REQUESTS);
  if (has(ARTIFACT_ANSWERS) && asked) return VERSION_HANDSHAKE;
  if (has(STEP_REQUESTS)) return CAPABILITY_PROBE;
  return input.guarded ? EXISTENCE_ONLY : NO_PROBE;
}

/** One sentence per detection value, stating what it does and does not prove. */
const DETECTION_SHAPES: Readonly<Record<StalenessDetection, string>> = {
  [VERSION_HANDSHAKE]:
    "The delivered artifact answers a contract version and the workflow asks for one, so a copy too old to speak the same contract is NAMED rather than silently run.",
  [CAPABILITY_PROBE]:
    "The step asks this artifact for a subcommand it does not answer, so age is inferred from whether one call succeeds. That detects staleness at exactly one floor and is blind above it — the defect CodySwannGT/lisa#3477 measured.",
  [EXISTENCE_ONLY]:
    "An existence test and no version probe: this coupling can see that the artifact is MISSING and cannot see that it is OLD. A present copy of any vintage runs, and its verdict is believed.",
  [NO_PROBE]:
    "Neither an existence test nor a version probe bears on this read, so nothing here distinguishes a current artifact from an absent or a superseded one.",
  [UNCHECKED]:
    "Lisa delivers nothing at this path, so there is no artifact to ask whether it could answer a version. The staleness half is UNKNOWN here — not current, and not probe-less.",
};

/**
 * How the age question was answered, and on what evidence.
 * @param input - What the scan found for one coupling
 * @param detection - What it can detect about age
 * @returns One clause naming the verdict and the tokens behind it
 */
export function stalenessShape(
  input: StalenessInput,
  detection: StalenessDetection
): string {
  const quoted = (names: readonly string[]): string =>
    names.map(name => `\`${name}\``).join(", ");
  const evidence =
    input.staleness.length === 0
      ? `None of the staleness tokens this scan can see (${quoted(STALENESS_SIGNALS)}) were found.`
      : `Tokens found: ${quoted(input.staleness)}. \`workflow-requests-version\` is workflow-scoped — it does not say THIS step asks.`;
  return `STALENESS (a separate dimension from the delivery verdict above): \`${detection}\`. ${DETECTION_SHAPES[detection]} ${evidence}`;
}

/**
 * Which recorded decisions the tree refuses to support, and why.
 *
 * One rule in each direction, because a hand-authored field that only ever
 * over-claims is half a check:
 *
 *   - a `handshake` decision on a coupling whose derived detection is not
 *     `version-handshake` claims cover the tree does not show;
 *   - any other decision on a coupling that DOES carry one records a gap that
 *     has already been closed, which decays into a stale exemption.
 *
 * Neither is a judgement about whether the decision was wise. Both are the
 * cheap, checkable half: the declaration must agree with what was measured.
 * @param entry - The classified entry
 * @returns One sentence, or null when the decision and the tree agree
 */
export function contradictionIn(entry: DecidedCoupling): string | null {
  if (entry.decision === null) return null;
  const claimed = entry.decision === DECISION_HANDSHAKE;
  const derived = entry.detection === VERSION_HANDSHAKE;
  if (claimed === derived) return null;
  return claimed
    ? `${entry.key}: recorded as \`handshake\`, but the tree derives \`${entry.detection}\` — no delivered artifact at \`${entry.path}\` answers a contract version, or no step of \`${entry.workflow}\` asks for one. A handshake nobody can find is the staleness half of this defect wearing the fix's clothes.`
    : `${entry.key}: recorded as \`${entry.decision}\`, but the tree derives \`version-handshake\` — this coupling already detects staleness, so an exemption here records a gap that is closed and would outlive its subject.`;
}

/**
 * Which recorded decisions are unusable as written.
 * @param entry - The classified entry
 * @returns One sentence, or null when the record is well-formed
 */
export function malformedIn(entry: DecidedCoupling): string | null {
  if (entry.decision === null) return null;
  if (!STALENESS_DECISIONS.includes(entry.decision)) {
    return `${entry.key}: \`${String(entry.decision)}\` is not one of ${STALENESS_DECISIONS.join(", ")}.`;
  }
  if (entry.decision === DECISION_HANDSHAKE) return null;
  return (entry.reason ?? "").trim().length === 0
    ? `${entry.key}: recorded as \`${entry.decision}\` with no reason. A decision without its reason is indistinguishable from nobody having looked, which is the state this field exists to end.`
    : null;
}

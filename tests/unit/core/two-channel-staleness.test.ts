/**
 * Regression tests for CodySwannGT/lisa#3687 — the staleness dimension.
 *
 * `two-channel-delivery` answers whether an artifact ARRIVES, and every entry
 * in its ledger reasoned about the read path being absent. Absence is the
 * benign half: an absent artifact skips or fails, and neither is a wrong
 * answer. The harmful half is present-and-old — a gate posting a red required
 * check derived from superseded logic, which every reader believes.
 *
 * These pin the second dimension: that it is DERIVED from what the delivered
 * artifact and the workflow actually show rather than declared, that the
 * hand-authored decision beside it is checked against that derivation in both
 * directions, and — the one that matters most — that a coupling whose artifact
 * could not be read says so instead of defaulting to current.
 */
import { describe, expect, it } from "vitest";
import {
  classifyTwoChannelDelivery,
  type CouplingInput,
} from "../../../src/core/two-channel-delivery.js";
import { scanWorkflow } from "../../../src/core/two-channel-delivery-scan.js";
import {
  artifactStalenessSignals,
  detectStaleness,
  type StalenessRecord,
  type StalenessSignal,
} from "../../../src/core/two-channel-staleness.js";

/** The workflow every fixture belongs to. */
const WORKFLOW = "quality.yml";

/** The caller-tree path every fixture reads. */
const PROVER = "scripts/prover.mjs";

/** That fixture's stable ledger key. */
const PROVER_KEY = `${WORKFLOW}::${PROVER}`;

/** A refreshing lane, so the fixture resolves to the apply channel. */
const APPLY_LANE = "all/copy-overwrite";

/** The token an artifact carrying its own version emits. */
const ANSWERS = "artifact-answers-version";

/** The token an artifact declaring a version constant emits. */
const DECLARES = "artifact-declares-version";

/** The decision recorded for a coupling nobody needs a handshake on. */
const NOT_NEEDED = "not-needed";

/** The detection a guarded read with no version probe carries. */
const GUARD_ONLY = "existence-only";

/** The token a step asking for a version emits. */
const STEP_ASKS = "step-requests-version";

/** The token a workflow asking for a version somewhere emits. */
const WORKFLOW_ASKS = "workflow-requests-version";

/** The detection a coupling that can see age carries. */
const HANDSHAKE = "version-handshake";

/** The detection a coupling that can see neither absence nor age carries. */
const BLIND = "no-probe";

/** A reason good enough to satisfy the "state why" rule. */
const REASON = "advisory read; a superseded copy cannot reach a wrong verdict";

/** An exemption a test can reuse wherever the reason is not the subject. */
const EXEMPT: StalenessRecord = { decision: NOT_NEEDED, reason: REASON };

/**
 * Order two names the way a reader would.
 * @param left - One name
 * @param right - The other
 * @returns Sort order
 */
const alphabetically = (left: string, right: string): number =>
  left.localeCompare(right);

/** Inspection counts that describe a run which genuinely looked at something. */
const MEASURED = {
  workflows: 23,
  steps: 633,
  couplings: 25,
  inventory: 55,
} as const;

/**
 * A coupling with everything the tests do not care about filled in.
 * @param overrides - Fields this test cares about
 * @returns The coupling
 */
function coupling(overrides: Partial<CouplingInput> = {}): CouplingInput {
  return {
    workflow: WORKFLOW,
    step: "🧪 Run a gate",
    path: PROVER,
    lanes: [APPLY_LANE],
    packageBacked: false,
    guarded: false,
    handling: [],
    staleness: [],
    artifactRead: true,
    ...overrides,
  };
}

/** The step header the scan fixtures use. */
const STEP = "      - name: 🧪 Prove it\n";

/** Running the prover from the caller's own tree. */
const RUN_PROVER = `        run: node ${PROVER}\n`;

/**
 * Everything is shipped by copy-overwrite.
 * @returns One refreshing lane
 */
const APPLY_LANES = (): readonly string[] => [APPLY_LANE];

/**
 * No lane ships anything.
 * @returns No lanes
 */
const NO_LANES = (): readonly string[] => [];

/**
 * An artifact that can say how old it is.
 * @returns Both artifact-side tokens
 */
const ANSWERING = (): readonly StalenessSignal[] => [DECLARES, ANSWERS];

/**
 * An artifact that is delivered but carries no version tokens.
 * @returns No tokens
 */
const SILENT = (): readonly StalenessSignal[] => [];

/**
 * Nothing is delivered at any path, so the artifact half is unknowable.
 *
 * `null` rather than `[]`: "no artifact to ask" and "an artifact carrying no
 * version tokens" are different measurements, and collapsing them is what this
 * dimension exists to refuse.
 * @returns No artifact
 */
const NO_ARTIFACT = (): readonly StalenessSignal[] | null => null;

describe("detectStaleness — the second dimension", () => {
  // CodySwannGT/lisa#3687. Absence is the benign half: an absent artifact
  // skips or fails, and neither is a wrong answer. Present-and-old is the
  // harmful half — a red required check derived from superseded logic, which
  // every reader believes. These pin that the answer is DERIVED from what the
  // artifact and the workflow show, and that "I could not tell" never renders
  // as "it is current".

  it("reads a handshake when the artifact answers and the step asks", () => {
    expect(
      detectStaleness(
        coupling({
          staleness: [ANSWERS, STEP_ASKS],
        })
      )
    ).toBe(HANDSHAKE);
  });

  it("accepts the workflow-scoped ask, because a read can arrive via an input default", () => {
    // `nightly-e2e-health.yml` defaults `guard_script` to the caller path and
    // the comparing step names `$GUARD`, never the path. A step-scoped-only
    // rule would refute a handshake that exists.
    expect(
      detectStaleness(
        coupling({
          staleness: [ANSWERS, WORKFLOW_ASKS],
        })
      )
    ).toBe(HANDSHAKE);
  });

  it("refuses to call a workflow-wide ask a handshake for an artifact that answers nothing", () => {
    // The bound on that looseness. `quality.yml` asks ONE artifact for its
    // version; the other seven reads in it must not inherit the answer.
    expect(detectStaleness(coupling({ staleness: [WORKFLOW_ASKS] }))).toBe(
      BLIND
    );
  });

  it("calls a step asking an artifact that cannot answer a capability probe", () => {
    // #3477's defect exactly: age inferred from whether one call succeeds.
    expect(detectStaleness(coupling({ staleness: [STEP_ASKS] }))).toBe(
      "capability-probe"
    );
  });

  it("calls a guarded read with no version probe existence-only", () => {
    expect(detectStaleness(coupling({ guarded: true }))).toBe(GUARD_ONLY);
  });

  it("calls an unguarded read with no version probe no-probe", () => {
    expect(detectStaleness(coupling())).toBe(BLIND);
  });

  it("says unchecked when there was no artifact to ask, rather than defaulting to current", () => {
    // The load-bearing one. `artifactRead: false` means Lisa delivers nothing
    // at the path, so whether a consumer's copy could answer is UNKNOWN. If
    // that rendered as `no-probe` the ledger would report a measurement it
    // never made — the family of defect this module is named after.
    expect(detectStaleness(coupling({ artifactRead: false }))).not.toBe(BLIND);
    expect(detectStaleness(coupling({ artifactRead: false }))).toBe(
      "unchecked"
    );
  });

  it("keeps staleness independent of the delivery verdict", () => {
    // Two dimensions, not two values of one: an apply-lagged coupling can
    // carry a handshake, and folding them together would force a choice
    // between the questions instead of answering both.
    const report = classifyTwoChannelDelivery({
      couplings: [
        coupling({
          staleness: [ANSWERS, STEP_ASKS],
        }),
      ],
      inspected: MEASURED,
      ratified: {},
      classified: { [PROVER_KEY]: { decision: "handshake" } },
    });
    expect(report.entries[0]?.verdict).toBe("apply-lagged");
    expect(report.entries[0]?.detection).toBe(HANDSHAKE);
  });

  it("names the detection and the tokens behind it in the detail", () => {
    const report = classifyTwoChannelDelivery({
      couplings: [coupling({ guarded: true })],
      inspected: MEASURED,
      ratified: {},
      classified: { [PROVER_KEY]: EXEMPT },
    });
    const detail = report.entries[0]?.detail ?? "";
    expect(detail).toContain("STALENESS");
    expect(detail).toContain("existence-only");
  });
});

describe("classifyTwoChannelDelivery — the recorded staleness decision", () => {
  /**
   * Classify one apply-lagged fixture against one recorded decision.
   * @param classified - The decisions to judge it against
   * @param overrides - Coupling fields the test cares about
   * @returns The measurement
   */
  function judged(
    classified: Readonly<Record<string, StalenessRecord>>,
    overrides: Partial<CouplingInput> = {}
  ): ReturnType<typeof classifyTwoChannelDelivery> {
    return classifyTwoChannelDelivery({
      couplings: [coupling(overrides)],
      inspected: MEASURED,
      ratified: {},
      classified,
    });
  }

  it("names a ledgered coupling nobody decided about", () => {
    // The forcing function. The detection is derived and therefore free; the
    // decision costs a sentence, which is what stops entry 24 inheriting
    // "nobody looked".
    expect(judged({}).unclassified).toEqual([PROVER_KEY]);
  });

  it("does not demand a decision for a package-backed coupling", () => {
    // Package-backed couplings are not written to the ledger, so requiring a
    // sentence about one would demand prose no reader can see.
    expect(judged({}, { packageBacked: true }).unclassified).toEqual([]);
  });

  it("refuses a handshake the tree cannot show", () => {
    const report = judged({ [PROVER_KEY]: { decision: "handshake" } });
    expect(report.contradictions).toHaveLength(1);
    expect(report.contradictions[0]).toContain(PROVER_KEY);
  });

  it("refuses an exemption on a coupling that already has a handshake", () => {
    // The other direction. An exemption recording a gap that is closed decays
    // into a permission nobody re-examines.
    const report = judged(
      { [PROVER_KEY]: EXEMPT },
      { staleness: [ANSWERS, STEP_ASKS] }
    );
    expect(report.contradictions).toHaveLength(1);
  });

  it("accepts a handshake the tree does show", () => {
    const report = judged(
      { [PROVER_KEY]: { decision: "handshake" } },
      {
        staleness: [ANSWERS, STEP_ASKS],
      }
    );
    expect(report.contradictions).toEqual([]);
    expect(report.malformed).toEqual([]);
  });

  it("refuses an exemption with no reason", () => {
    const report = judged({
      [PROVER_KEY]: { decision: NOT_NEEDED, reason: "   " },
    });
    expect(report.malformed).toHaveLength(1);
  });

  it("refuses a reason that is a label rather than a decision", () => {
    // A floor, not a proof. "advisory" reads as an answer while carrying none
    // of the argument a later reader needs to re-examine the exemption.
    const report = judged({ [PROVER_KEY]: { ...EXEMPT, reason: "advisory" } });
    expect(report.malformed).toHaveLength(1);
    expect(report.malformed[0]).toContain("A label is not a decision");
  });

  it("refuses a decision whose coupling no longer exists", () => {
    const report = judged({
      [PROVER_KEY]: EXEMPT,
      [`${WORKFLOW}::scripts/gone.mjs`]: {
        decision: NOT_NEEDED,
        reason: "advisory read; nothing downstream believes its result",
      },
    });
    expect(report.staleClassifications).toEqual([
      `${WORKFLOW}::scripts/gone.mjs`,
    ]);
  });

  it("counts an unbuilt-but-warranted handshake without failing on it", () => {
    // A reasoned "worth closing, not closed yet" is a recorded decision, and
    // the tally is what keeps it in front of a reader every run. Turning it
    // into a red would make the cheapest way out of the obligation an
    // exemption, which is the wrong incentive.
    const report = judged({
      [PROVER_KEY]: { decision: "warranted", reason: REASON },
    });
    expect(report.decisionCounts.warranted).toBe(1);
    expect(report.contradictions).toEqual([]);
    expect(report.malformed).toEqual([]);
    expect(report.unclassified).toEqual([]);
  });

  it("reports every detection and decision key, so a zero is a stated zero", () => {
    const report = judged({
      [PROVER_KEY]: EXEMPT,
    });
    expect(Object.keys(report.detectionCounts).sort(alphabetically)).toEqual([
      "capability-probe",
      GUARD_ONLY,
      BLIND,
      "unchecked",
      HANDSHAKE,
    ]);
    expect(Object.keys(report.decisionCounts).sort(alphabetically)).toEqual([
      "handshake",
      NOT_NEEDED,
      "warranted",
    ]);
  });

  it("publishes the denominator the coverage figure is out of", () => {
    // "4 can detect staleness" is believable at any scale; a coverage number
    // nobody can size is the report shape this repository has been burned by.
    expect(judged({ [PROVER_KEY]: EXEMPT }).classifiable).toBe(1);
  });
});

describe("artifactStalenessSignals", () => {
  // CodySwannGT/lisa#3687, the half that is exact for a path. A workflow can
  // ask anything it likes; whether the artifact it reads can ANSWER is a fact
  // about the delivered file, and it is what bounds the workflow-scoped signal
  // from crediting a handshake to a file that has none.

  it("sees a contract-version constant an artifact declares", () => {
    expect(
      artifactStalenessSignals(
        "export const WORK_ITEM_CONTRACT_VERSION = '2.1.0';"
      )
    ).toContain(DECLARES);
  });

  it("sees an artifact that answers a contract-version request", () => {
    expect(
      artifactStalenessSignals("if (argv[0] === 'contract-version') print();")
    ).toContain(ANSWERS);
  });

  it("reports nothing for an artifact carrying neither", () => {
    expect(artifactStalenessSignals("console.log('hello');")).toEqual([]);
  });

  it("does not credit a workflow-contract input, which is the other channel's handshake", () => {
    // `expected_workflow_contract_major` is the FAST channel's own handshake,
    // about the workflow body rather than the artifact it reads. A looser
    // pattern would let it answer a question it has nothing to do with.
    expect(
      artifactStalenessSignals("expected_workflow_contract_major: 3")
    ).toEqual([]);
  });
});

describe("scanWorkflow — staleness scopes", () => {
  it("marks the step that asks, exactly", () => {
    const couplings = scanWorkflow({
      workflow: WORKFLOW,
      text: `${STEP}        run: node ${PROVER} contract-version\n`,
      lanesFor: APPLY_LANES,
      artifactSignalsFor: ANSWERING,
    });
    expect(couplings[0]?.staleness).toContain(STEP_ASKS);
  });

  it("marks a workflow-scoped ask under a name that says it is workflow-scoped", () => {
    // The read arrives through an input default and the asking step never
    // names the path — so the signal exists, and its NAME is what stops it
    // being read as "this step asks".
    const couplings = scanWorkflow({
      workflow: WORKFLOW,
      text: `on:\n  workflow_call:\n    inputs:\n      guard:\n        default: ${PROVER}\n${STEP}        run: node "$GUARD" --contract-version\n`,
      lanesFor: APPLY_LANES,
      artifactSignalsFor: ANSWERING,
    });
    expect(couplings[0]?.staleness).toContain(WORKFLOW_ASKS);
    expect(couplings[0]?.staleness).not.toContain(STEP_ASKS);
  });

  it("carries the artifact's own tokens through", () => {
    const couplings = scanWorkflow({
      workflow: WORKFLOW,
      text: STEP + RUN_PROVER,
      lanesFor: APPLY_LANES,
      artifactSignalsFor: ANSWERING,
    });
    expect(couplings[0]?.staleness).toContain(ANSWERS);
    expect(couplings[0]?.artifactRead).toBe(true);
  });

  it("tells a delivered artifact that says nothing from no artifact at all", () => {
    // Both produce an empty token list, and they are not the same fact: one is
    // a measured negative, the other is the absence of a measurement.
    const silent = scanWorkflow({
      workflow: WORKFLOW,
      text: STEP + RUN_PROVER,
      lanesFor: APPLY_LANES,
      artifactSignalsFor: SILENT,
    });
    const absent = scanWorkflow({
      workflow: WORKFLOW,
      text: STEP + RUN_PROVER,
      lanesFor: NO_LANES,
      artifactSignalsFor: NO_ARTIFACT,
    });
    expect(silent[0]?.staleness).toEqual(absent[0]?.staleness);
    expect(silent[0]?.artifactRead).toBe(true);
    expect(absent[0]?.artifactRead).toBe(false);
  });

  it("emits the tokens in the vocabulary's order, so two runs render the same bytes", () => {
    const couplings = scanWorkflow({
      workflow: WORKFLOW,
      text: `${STEP}        run: node ${PROVER} contract-version\n`,
      lanesFor: APPLY_LANES,
      artifactSignalsFor: ANSWERING,
    });
    expect(couplings[0]?.staleness).toEqual([
      DECLARES,
      "artifact-answers-version",
      "step-requests-version",
      "workflow-requests-version",
    ]);
  });
});

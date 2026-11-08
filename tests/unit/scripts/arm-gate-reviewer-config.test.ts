/**
 * The arm gate engages on every stack that declares a reviewer gate
 * (CodySwannGT/lisa#4653).
 *
 * The defect: `lisa-drive-pr-to-merge` keyed its arm gate to
 * `.github/required-checks.json`, which Lisa seeds only on TypeScript-family
 * hosts. A Rails host that declares `evidence.reviewer: true` in
 * `.lisa.config.json` therefore passed the gate immediately, and an armed
 * latch merged on a rate-limited reviewer's `neutral` check run.
 *
 * These cases drive the arm decision for a Rails-shaped host — a reviewer gate
 * in config, and NO vacuity report because no `required-checks.json` and no
 * `check-skipped-required-checks.mjs` exist there — through the all-stack
 * prover with stubbed GitHub reads. Arming turns a verdict into a merge, so
 * the controls below also pin every way the decision must NOT arm: a marker a
 * non-writer typed, a quoted marker, an objecting review, and a classifier
 * report that is stale, untrusted, or missing.
 * @module tests/unit/scripts/arm-gate-reviewer-config
 */
import { describe, expect, it } from "vitest";

import {
  ARM_ACTIONS,
  armDecision,
  COMPLETED_REVIEW_RESULT,
  EVIDENCE_OUTCOMES,
  main,
  standingObjections,
  substituteMarker,
  writerSubstitutes,
} from "../../../all/copy-overwrite/scripts/check-third-party-review-evidence.mjs";

const REPO_ARG = "--repo=acme/rails-host";
const CONTEXT = "CodeRabbit";
const APP = 347564;
const HEAD = "e".repeat(40);
const OTHER_HEAD = "f".repeat(40);
const CHANGES_REQUESTED = "Changes requested";
const WRITER = "maintainer";
const STRANGER = "drive-by";

/** The reviewer gate exactly as the issue's Rails host declares it. */
const RAILS_GATES = {
  "code-review": {
    "pull-request": {
      level: "required",
      await: CONTEXT,
      posted_by: APP,
      evidence: {
        reviewer: true,
        proof: ["Review completed", CHANGES_REQUESTED],
      },
    },
  },
};

/**
 * A reviewer check run at the head.
 * @param overrides - Fields to replace
 * @returns The run
 */
const run = (overrides: Record<string, unknown> = {}) => ({
  id: 11,
  name: CONTEXT,
  head_sha: HEAD,
  status: "completed",
  conclusion: "success",
  app: { id: APP, slug: "coderabbitai" },
  output: {
    title: "Finished",
    summary: `${COMPLETED_REVIEW_RESULT}\nRun ID: x`,
  },
  ...overrides,
});

/** A rate-limited review: GitHub counts `neutral` as passing a required check. */
const RATE_LIMITED_RUN = run({
  conclusion: "neutral",
  output: { title: "Review rate limited", summary: "Review rate limited" },
});

/**
 * A pull request comment as the comments API returns it.
 * @param body - The comment body
 * @param login - Its author
 * @returns The comment
 */
const comment = (body: string, login = WRITER) => ({
  body,
  user: { login },
});

/** A writer's first-line substitute for this head. */
const WRITER_SUBSTITUTE = comment(
  `${substituteMarker({ context: CONTEXT, sha: HEAD })}\nRead the diff.`
);

/** The parsed `--arm --json` report. */
interface ArmReport {
  readonly arm: boolean;
  readonly action: string;
  readonly reason: string;
  readonly engaged: { readonly reviewer: boolean; readonly vacuity: boolean };
  readonly evidence: { readonly outcome: string };
}

/** Optional reads a case may replace. */
interface Reads {
  readonly runs?: readonly object[];
  readonly comments?: readonly object[];
  readonly reviews?: readonly object[] | null;
  readonly gates?: object;
  readonly pulls?: () => number[] | null;
  readonly requiredChecks?: boolean;
  readonly report?: () => string;
}

/**
 * Run the arm decision on a Rails-shaped host with stubbed reads.
 * @param reads - What GitHub and disk return
 * @returns The exit code and parsed report
 */
const decide = (reads: Reads = {}): { code: number; report: ArmReport } => {
  const chunks: string[] = [];
  const argv = [`--sha=${HEAD}`, REPO_ARG, "--arm", "--json"];
  if (reads.report) argv.push("--vacuity-report=vacuity.json");
  const code = main(argv, {
    gates: reads.gates ?? RAILS_GATES,
    pulls: reads.pulls ?? (() => [7]),
    statuses: () => [],
    checkRuns: () => reads.runs ?? [],
    comments: () => reads.comments ?? [],
    reviews: () => (reads.reviews === undefined ? [] : reads.reviews),
    canWrite: (login: string) => login === WRITER,
    requiredChecks: () => reads.requiredChecks ?? false,
    readFile: reads.report ?? (() => "{}"),
    out: {
      write: (text: string) => {
        chunks.push(text);
      },
    },
  });
  return { code, report: JSON.parse(chunks.join("")) };
};

describe("the arm gate on a Rails host with a reviewer gate (#4653)", () => {
  it("does not arm on a rate-limited review, and asks for the substitute first", () => {
    const { code, report } = decide({ runs: [RATE_LIMITED_RUN] });

    expect(report.evidence.outcome).toBe(EVIDENCE_OUTCOMES.unsatisfied);
    expect(report.arm).toBe(false);
    expect(report.action).toBe(ARM_ACTIONS.substitute);
    expect(code).toBe(1);
  });

  it("does not arm when the reviewer has posted nothing at all", () => {
    const { report } = decide();

    expect(report.arm).toBe(false);
    expect(report.action).toBe(ARM_ACTIONS.substitute);
  });

  it("arms a head the pinned app reviewed", () => {
    const { code, report } = decide({ runs: [run()] });

    expect(report.evidence.outcome).toBe(EVIDENCE_OUTCOMES.satisfied);
    expect(report.arm).toBe(true);
    expect(report.action).toBe(ARM_ACTIONS.arm);
    expect(code).toBe(0);
  });

  it("arms a rate-limited head once a writer's substitute for that head is posted", () => {
    const { code, report } = decide({
      runs: [RATE_LIMITED_RUN],
      comments: [WRITER_SUBSTITUTE],
    });

    expect(report.evidence.outcome).toBe(EVIDENCE_OUTCOMES.substituted);
    expect(report.arm).toBe(true);
    expect(code).toBe(0);
  });

  it("does not arm on a substitute marker a non-writer posted", () => {
    const { report } = decide({
      runs: [RATE_LIMITED_RUN],
      comments: [
        comment(substituteMarker({ context: CONTEXT, sha: HEAD }), STRANGER),
      ],
    });

    expect(report.evidence.outcome).toBe(EVIDENCE_OUTCOMES.substituted);
    expect(report.arm).toBe(false);
    expect(report.action).toBe(ARM_ACTIONS.substitute);
  });

  it("does not arm on a writer's comment that only quotes the marker", () => {
    const { report } = decide({
      runs: [RATE_LIMITED_RUN],
      comments: [
        comment(
          `Paste this:\n${substituteMarker({ context: CONTEXT, sha: HEAD })}`
        ),
      ],
    });

    expect(report.arm).toBe(false);
  });

  it("does not let a substitute for another head arm this one", () => {
    const { report } = decide({
      runs: [RATE_LIMITED_RUN],
      comments: [
        comment(substituteMarker({ context: CONTEXT, sha: OTHER_HEAD })),
      ],
    });

    expect(report.arm).toBe(false);
  });

  it("treats a reviewer that requested changes as a blocker, not as review proof", () => {
    const { report } = decide({
      runs: [
        run({
          output: {
            title: CHANGES_REQUESTED,
            summary: CHANGES_REQUESTED,
          },
        }),
      ],
    });

    expect(report.arm).toBe(false);
    expect(report.action).toBe(ARM_ACTIONS.blocker);
  });

  it("does not arm a reviewed head that carries a standing CHANGES_REQUESTED", () => {
    const { report } = decide({
      runs: [run()],
      reviews: [
        {
          commit_id: HEAD,
          state: "CHANGES_REQUESTED",
          user: { login: STRANGER },
        },
      ],
    });

    expect(report.arm).toBe(false);
    expect(report.action).toBe(ARM_ACTIONS.blocker);
  });

  it("stops rather than arms when the reviews cannot be read", () => {
    const { report } = decide({ runs: [run()], reviews: null });

    expect(report.arm).toBe(false);
    expect(report.action).toBe(ARM_ACTIONS.stop);
  });

  it("does not arm while the reviewer is still running", () => {
    const { report } = decide({
      runs: [run({ status: "in_progress", conclusion: null })],
    });

    expect(report.evidence.outcome).toBe(EVIDENCE_OUTCOMES.pending);
    expect(report.arm).toBe(false);
    expect(report.action).toBe(ARM_ACTIONS.watch);
  });

  it("stops rather than arms when the pull requests cannot be read", () => {
    const { report } = decide({ pulls: () => null });

    expect(report.arm).toBe(false);
    expect(report.action).toBe(ARM_ACTIONS.stop);
  });

  it("arms a host that declares no reviewer anywhere — out of scope", () => {
    const { code, report } = decide({ gates: {} });

    expect(report.evidence.outcome).toBe(
      EVIDENCE_OUTCOMES.noReviewerConfigured
    );
    expect(report.arm).toBe(true);
    expect(code).toBe(0);
  });

  it("holds a host whose required-checks.json declares a check when no report is passed", () => {
    const { report } = decide({ gates: {}, requiredChecks: true });

    expect(report.arm).toBe(false);
    expect(report.action).toBe(ARM_ACTIONS.watch);
    expect(report.reason).toContain("no --vacuity-report was passed");
  });
});

describe("--vacuity-report on a host that ships the classifier", () => {
  it("arms a reviewed head the classifier inspected cleanly at this head", () => {
    const { report } = decide({
      runs: [run()],
      requiredChecks: true,
      report: () =>
        JSON.stringify({
          inspected: true,
          vacuity: { headSha: HEAD, violations: [] },
        }),
    });

    expect(report.arm).toBe(true);
    expect(report.engaged).toEqual({ reviewer: true, vacuity: true });
  });

  it("holds a reviewed head the classifier still finds vacuous", () => {
    const { report } = decide({
      runs: [run()],
      report: () =>
        JSON.stringify({
          inspected: true,
          vacuity: {
            headSha: HEAD,
            violations: [
              { kind: "unproven_required_check", contexts: [CONTEXT] },
            ],
          },
        }),
    });

    expect(report.arm).toBe(false);
    expect(report.engaged).toEqual({ reviewer: true, vacuity: true });
  });

  it("does not arm when the named report cannot be read", () => {
    const { report } = decide({
      runs: [run()],
      report: () => {
        throw new Error("ENOENT");
      },
    });

    expect(report.arm).toBe(false);
    expect(report.reason).toContain("vacuity_report_unreadable");
  });
});

describe("armDecision keeps the vacuity classifier where it exists", () => {
  const satisfied = {
    outcome: EVIDENCE_OUTCOMES.satisfied,
    sha: HEAD,
    readings: [{ context: CONTEXT, reviewed: true, observed: "x" }],
  };
  const unconfigured = {
    outcome: EVIDENCE_OUTCOMES.noReviewerConfigured,
    sha: HEAD,
  };
  /**
   * A classifier report at this head.
   * @param violations - Its violations
   * @param extra - Other top-level fields
   * @returns The report
   */
  const report = (violations: object[], extra: object = {}) => ({
    inspected: true,
    vacuity: { headSha: HEAD, violations },
    ...extra,
  });
  const vacuous = report([
    { kind: "vacuous_required_check", contexts: [CONTEXT] },
  ]);

  it("arms when both signals prove work", () => {
    expect(armDecision({ evidence: satisfied, vacuity: report([]) }).arm).toBe(
      true
    );
  });

  it("asks for a substitute when only the classifier engages and finds it vacuous", () => {
    const decision = armDecision({ evidence: unconfigured, vacuity: vacuous });

    expect(decision.arm).toBe(false);
    expect(decision.action).toBe(ARM_ACTIONS.substitute);
  });

  it("arms a vacuous context once a writer's substitute stands for it", () => {
    const decision = armDecision({
      evidence: unconfigured,
      vacuity: vacuous,
      substitutes: new Set([CONTEXT]),
    });

    expect(decision.arm).toBe(true);
  });

  it.each([
    ["review_evidence_objected", undefined, ARM_ACTIONS.blocker],
    ["review_evidence_objection_unread", undefined, ARM_ACTIONS.stop],
    ["review_evidence_unsatisfied", "objected", ARM_ACTIONS.blocker],
    ["review_evidence_unsatisfied", "pending", ARM_ACTIONS.watch],
    ["review_evidence_unsatisfied", "absent", ARM_ACTIONS.substitute],
    ["review_evidence_carried_unreviewed", undefined, ARM_ACTIONS.substitute],
    ["absent_required_check", undefined, ARM_ACTIONS.substitute],
  ])("does not arm on %s (%s)", (kind, condition, action) => {
    const decision = armDecision({
      evidence: satisfied,
      vacuity: report([{ kind, condition, contexts: [CONTEXT] }]),
    });

    expect(decision.arm).toBe(false);
    expect(decision.action).toBe(action);
  });

  it("does not arm on a report the classifier did not trust", () => {
    const decision = armDecision({
      evidence: satisfied,
      vacuity: report([], { answered: false }),
    });

    expect(decision.arm).toBe(false);
  });

  it("does not arm on a report from another head", () => {
    const decision = armDecision({
      evidence: unconfigured,
      vacuity: {
        inspected: true,
        vacuity: { headSha: OTHER_HEAD, violations: [] },
      },
    });

    expect(decision.arm).toBe(false);
    expect(decision.reason).toContain(OTHER_HEAD);
  });

  it("arms when the classifier says nothing is declared and the prover agrees", () => {
    const decision = armDecision({
      evidence: unconfigured,
      vacuity: {
        inspected: false,
        vacuity: { refusal: { kind: "vacuity_none_declared" } },
      },
    });

    expect(decision.arm).toBe(true);
  });

  it("still engages on the config reviewer when the classifier declares none", () => {
    const decision = armDecision({
      evidence: {
        outcome: EVIDENCE_OUTCOMES.unsatisfied,
        sha: HEAD,
        readings: [{ context: CONTEXT, reviewed: false }],
      },
      vacuity: {
        inspected: false,
        vacuity: { refusal: { kind: "vacuity_none_declared" } },
      },
    });

    expect(decision.arm).toBe(false);
    expect(decision.action).toBe(ARM_ACTIONS.substitute);
  });

  it("does not arm on an inspection that read nothing", () => {
    const decision = armDecision({
      evidence: satisfied,
      vacuity: {
        inspected: false,
        vacuity: { refusal: { kind: "vacuity_checks_unreadable" } },
      },
    });

    expect(decision.arm).toBe(false);
  });
});

describe("the substitute and objection readers", () => {
  it("counts only a writer's first-line marker at this head", () => {
    const found = writerSubstitutes(
      [
        WRITER_SUBSTITUTE,
        comment(substituteMarker({ context: "Other", sha: HEAD }), STRANGER),
        comment(substituteMarker({ context: "Third", sha: OTHER_HEAD })),
      ],
      HEAD,
      (login: string) => login === WRITER
    );

    expect([...found]).toEqual([CONTEXT]);
  });

  it("lets a later approval by the same author clear their objection", () => {
    expect(
      standingObjections(
        [
          { commit_id: HEAD, state: "CHANGES_REQUESTED", user: { login: "a" } },
          { commit_id: HEAD, state: "APPROVED", user: { login: "a" } },
          { commit_id: OTHER_HEAD, state: "CHANGES_REQUESTED" },
        ],
        HEAD
      )
    ).toBe(0);
  });

  it("reports unreadable reviews as unknown, not as none", () => {
    expect(standingObjections(null, HEAD)).toBeNull();
  });
});
